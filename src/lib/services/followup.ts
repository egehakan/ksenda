/**
 * Follow-up engine. Generates and sends Day-3 / Day-7 / Day-14 follow-up
 * emails for companies whose initial cold email is still unanswered. Reply
 * detection is manual — the user clicks "Mark as replied" in the Clients
 * tab and that pauses the sequence for that company.
 *
 * Cadence is driven by FollowUpPrompt.dayOffset (editable per user).
 * Step 1 = quick bump, step 2 = value-add, step 3 = break-up.
 */
import prisma from '@/lib/prisma';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_MODEL } from '@/lib/constants';
import { sendEmailViaSmtp, type UserSmtpConfig } from './email-sender';
import { getGroundingTools, extractGroundingTrace } from './gemini-tools';
// NOTE: automation imports from this module, so we lazy-import the
// auto-progression hook to avoid a circular module-load order.

interface GeneratedFollowUp {
  subject: string;
  email_body: string;
}

interface GeneratedLinkedInFollowUp {
  message: string;
}

function parseFollowUpResponse(text: string): GeneratedFollowUp | null {
  try {
    const match = text.match(/\{[\s\S]*"subject"[\s\S]*"email_body"[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as GeneratedFollowUp;
    if (!parsed.subject || !parsed.email_body) return null;
    if (typeof parsed.subject !== 'string' || typeof parsed.email_body !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseLinkedInFollowUpResponse(text: string): GeneratedLinkedInFollowUp | null {
  try {
    const match = text.match(/\{[\s\S]*"message"[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as GeneratedLinkedInFollowUp;
    if (!parsed.message || typeof parsed.message !== 'string') return null;
    if (parsed.message.trim() === '') return null;
    return parsed;
  } catch {
    return null;
  }
}

function applyPlaceholders(prompt: string, ctx: Record<string, string>): string {
  let out = prompt;
  for (const [k, v] of Object.entries(ctx)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
  }
  return out;
}

export interface ProcessResult {
  candidates: number;
  generated: number;
  failed: number;
  skipped: number;
  details: Array<{
    companyId: string;
    companyName: string;
    step: number;
    status: 'generated' | 'failed' | 'skipped';
    reason?: string;
  }>;
}

/**
 * For one company, generate the next follow-up step using the user's
 * FollowUpPrompt and the original email content. Returns the FollowUpEmail
 * row id on success.
 */
export async function generateNextFollowUp(
  userId: string,
  companyId: string
): Promise<{ success: boolean; followUpEmailId?: string; step?: number; error?: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { success: false, error: 'User not found' };
  if (!user.geminiApiKey) return { success: false, error: 'Gemini API key not configured' };

  const company = await prisma.company.findFirst({
    where: { id: companyId, userId },
    include: { email: true },
  });
  if (!company) return { success: false, error: 'Company not found' };

  if (company.clientStatus !== 'contacted') {
    return {
      success: false,
      error: `Company status is "${company.clientStatus}", not "contacted". Skipping.`,
    };
  }

  const nextStep = (company.followUpStep ?? 0) + 1;
  if (nextStep > 3) {
    return { success: false, error: 'Already on step 3 (break-up). No further follow-ups.' };
  }

  if (!company.email) {
    return { success: false, error: 'Company has no initial email to follow up on.' };
  }
  // The channel of the initial determines the channel of every follow-up in
  // this sequence. Same Apollo contact, same outreach style.
  const channel = (company.email.channel || 'email') as 'email' | 'linkedin';

  const promptRow = await prisma.followUpPrompt.findFirst({
    where: { userId, step: nextStep, platform: channel },
  });
  if (!promptRow) {
    return {
      success: false,
      error: `No ${channel} follow-up prompt for step ${nextStep}`,
    };
  }

  if (!company.targetContactFirstName) {
    return { success: false, error: 'Company has no target contact first name on file.' };
  }
  if (channel === 'email' && !company.targetContactEmail) {
    return { success: false, error: 'Company has no target contact email on file.' };
  }
  if (channel === 'linkedin' && !company.targetContactLinkedinUrl) {
    return { success: false, error: 'Company has no target contact LinkedIn URL on file.' };
  }

  // Resolve the most authoritative subject + body of the original (final >
  // edited > generated). The follow-up references this in the prompt.
  const originalSubject =
    company.email.finalSubject || company.email.editedSubject || company.email.subject || '';
  const originalBody =
    company.email.finalBody || company.email.editedBody || company.email.body;

  const senderCompany = user.companyName || 'our company';
  const senderWebsite = user.companyWebsite || '';
  const senderName = user.senderName || '';

  const filledPrompt = applyPlaceholders(promptRow.content, {
    SENDER_COMPANY_NAME: senderCompany,
    SENDER_COMPANY_WEBSITE: senderWebsite,
    SENDER_NAME: senderName,
    CONTACT_FIRST_NAME: company.targetContactFirstName,
    CONTACT_LAST_NAME: company.targetContactLastName || '',
    CONTACT_TITLE: company.targetContactTitle || '',
    COMPANY_NAME: company.name,
    COMPANY_WEBSITE_URL: company.website || `https://${company.domain}`,
    ORIGINAL_SUBJECT: originalSubject,
    ORIGINAL_BODY: originalBody,
  });

  const genAI = new GoogleGenerativeAI(user.geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    // Same grounding as the initial email — the follow-up benefits from
    // fresh signals too (e.g. spotting they just launched a feature and
    // weaving that into the value-add step).
    tools: getGroundingTools(),
  });

  // Append research instructions to the prompt that the follow-up template
  // shares but doesn't restate. Identical motivation to the initial flow.
  const groundedPrompt = `${filledPrompt}

TOOLS AVAILABLE FOR THIS FOLLOW-UP
You have url-context and google-search. Before writing:
1. Fetch ${company.website || `https://${company.domain}`} again — look for
   anything they shipped or announced since the initial message went out.
2. For step 2 (Day 7 value-add), run one search for "${company.name}" + a
   relevant keyword (product, funding, hiring) so the value-add references
   something current, not generic.
3. Never invent facts. If the tool returned nothing useful, default to a
   purely structural follow-up rather than fake-specific.`;

  // ---- LinkedIn follow-up branch ------------------------------------------
  if (channel === 'linkedin') {
    let liParsed: GeneratedLinkedInFollowUp | null = null;
    let rawText = '';
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const result = await model.generateContent(groundedPrompt);
        rawText = (await result.response).text();
        liParsed = parseLinkedInFollowUpResponse(rawText);

        const trace = extractGroundingTrace(result.response);
        if (trace.fetchedUrls.length || trace.searchQueries.length) {
          console.log(
            `[Gemini/linkedin-followup step ${nextStep}] Grounding · fetched ${trace.fetchedUrls.length} URL(s), ` +
              `ran ${trace.searchQueries.length} search(es).`
          );
        }
        if (liParsed) break;
      } catch (e) {
        if (attempt === 2) {
          return {
            success: false,
            error: e instanceof Error ? e.message : 'Gemini error',
          };
        }
        await new Promise((res) => setTimeout(res, 1000 * Math.pow(2, attempt)));
      }
    }
    if (!liParsed) {
      return {
        success: false,
        error: 'Failed to parse LinkedIn follow-up from Gemini response',
      };
    }

    const finalBody = liParsed.message
      .replace(/\{\{CONTACT_FIRST_NAME\}\}/g, company.targetContactFirstName)
      .replace(/\{\{CONTACT_LAST_NAME\}\}/g, company.targetContactLastName || '')
      .replace(/\{\{SENDER_NAME\}\}/g, senderName);

    const followUpEmail = await prisma.followUpEmail.create({
      data: {
        companyId: company.id,
        step: nextStep,
        channel: 'linkedin',
        promptUsed: filledPrompt,
        subject: null,
        body: finalBody,
        geminiModelUsed: GEMINI_MODEL,
        threadMessageId: null,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId,
        entityType: 'followup_email',
        entityId: followUpEmail.id,
        action: 'followup_generated',
        metadata: {
          step: nextStep,
          channel: 'linkedin',
          companyId: company.id,
        },
      },
    });

    const { onFollowUpGenerated } = await import('./automation');
    await onFollowUpGenerated(userId, followUpEmail.id);

    return { success: true, followUpEmailId: followUpEmail.id, step: nextStep };
  }

  // ---- Email follow-up (default, unchanged) -------------------------------
  let parsed: GeneratedFollowUp | null = null;
  let rawText = '';
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const result = await model.generateContent(groundedPrompt);
      rawText = (await result.response).text();
      parsed = parseFollowUpResponse(rawText);

      const trace = extractGroundingTrace(result.response);
      if (trace.fetchedUrls.length || trace.searchQueries.length) {
        console.log(
          `[Gemini/followup step ${nextStep}] Grounding · fetched ${trace.fetchedUrls.length} URL(s), ` +
            `ran ${trace.searchQueries.length} search(es). ` +
            `Fetched: ${trace.fetchedUrls.join(', ') || '(none)'}. ` +
            `Searches: ${trace.searchQueries.join(' | ') || '(none)'}`
        );
      }

      if (parsed) break;
    } catch (e) {
      if (attempt === 2) {
        return {
          success: false,
          error: e instanceof Error ? e.message : 'Gemini error',
        };
      }
      await new Promise((res) => setTimeout(res, 1000 * Math.pow(2, attempt)));
    }
  }
  if (!parsed) {
    return { success: false, error: 'Failed to parse follow-up from Gemini response' };
  }

  // Apply final placeholder substitutions to the generated body (the prompt
  // may have left some interpolated by the model literally).
  const finalBody = parsed.email_body
    .replace(/\{\{CONTACT_FIRST_NAME\}\}/g, company.targetContactFirstName)
    .replace(/\{\{CONTACT_LAST_NAME\}\}/g, company.targetContactLastName || '')
    .replace(/\{\{SENDER_NAME\}\}/g, senderName);

  let finalSubject = parsed.subject.replace(
    /\{\{ORIGINAL_SUBJECT\}\}/g,
    originalSubject
  );
  // Defensive: Gmail threads only when subject starts with "Re:". Apply it
  // here in case the model forgot.
  if (!/^re:\s*/i.test(finalSubject)) {
    finalSubject = `Re: ${finalSubject.replace(/^re:\s*/i, '')}`;
  }

  const followUpEmail = await prisma.followUpEmail.create({
    data: {
      companyId: company.id,
      step: nextStep,
      channel: 'email',
      promptUsed: filledPrompt,
      subject: finalSubject,
      body: finalBody,
      geminiModelUsed: GEMINI_MODEL,
      threadMessageId: company.email.messageId || null,
    },
  });

  // We do NOT advance Company.followUpStep here — that happens on send.
  // The follow-up is in "pending review" until the user approves and sends it.

  await prisma.auditLog.create({
    data: {
      userId,
      entityType: 'followup_email',
      entityId: followUpEmail.id,
      action: 'followup_generated',
      metadata: {
        step: nextStep,
        subject: finalSubject,
        companyId: company.id,
      },
    },
  });

  // Auto-progression hook. No-op unless autoApproveFollowUps is on.
  // If on, approves + sends inside this call (respecting send window + cap).
  const { onFollowUpGenerated } = await import('./automation');
  await onFollowUpGenerated(userId, followUpEmail.id);

  return { success: true, followUpEmailId: followUpEmail.id, step: nextStep };
}

/**
 * Find every company belonging to `userId` whose follow-up is due and try to
 * generate the next step for each. Idempotent over a single run: a company
 * with an already-pending unsent follow-up will be skipped to avoid stacking
 * duplicates.
 */
export async function processDueFollowUps(userId: string): Promise<ProcessResult> {
  const result: ProcessResult = {
    candidates: 0,
    generated: 0,
    failed: 0,
    skipped: 0,
    details: [],
  };

  const now = new Date();
  const candidates = await prisma.company.findMany({
    where: {
      userId,
      clientStatus: 'contacted',
      nextFollowUpAt: { lte: now },
      followUpStep: { lt: 3 },
    },
    orderBy: { nextFollowUpAt: 'asc' },
    take: 100,
  });
  result.candidates = candidates.length;

  // Track progress visibly so the UI doesn't sit on a silent spinner.
  const { createJob, updateJob, completeJob, failJob } = await import('./jobs');
  const jobId = await createJob({
    userId,
    kind: 'followup_process',
    totalItems: candidates.length,
    currentLabel:
      candidates.length > 0
        ? `Generating follow-ups for ${candidates.length} client${candidates.length === 1 ? '' : 's'}…`
        : 'Checking for due follow-ups…',
  });

  try {
    let i = 0;
    for (const c of candidates) {
      i++;
      await updateJob(jobId, {
        processedItems: i - 1,
        currentLabel: `Follow-up ${i}/${candidates.length} · ${c.name}`,
      });

      // Skip if there's already an unsent follow-up at the NEXT step waiting
      // for review (we don't want to stack drafts for the same step).
      const nextStep = (c.followUpStep ?? 0) + 1;
      const existingDraft = await prisma.followUpEmail.findFirst({
        where: { companyId: c.id, step: nextStep, sentAt: null },
      });
      if (existingDraft) {
        result.skipped++;
        result.details.push({
          companyId: c.id,
          companyName: c.name,
          step: nextStep,
          status: 'skipped',
          reason: 'Already a pending unsent draft at this step',
        });
        continue;
      }

      const gen = await generateNextFollowUp(userId, c.id);
      if (gen.success) {
        result.generated++;
        result.details.push({
          companyId: c.id,
          companyName: c.name,
          step: gen.step!,
          status: 'generated',
        });
      } else {
        result.failed++;
        result.details.push({
          companyId: c.id,
          companyName: c.name,
          step: nextStep,
          status: 'failed',
          reason: gen.error,
        });
      }
    }

    await completeJob(jobId, {
      processedItems: candidates.length,
      metadata: {
        generated: result.generated,
        skipped: result.skipped,
        failed: result.failed,
      },
    });
  } catch (e) {
    await failJob(jobId, e instanceof Error ? e.message : 'unknown');
    throw e;
  }

  return result;
}

/**
 * Send an approved follow-up. Same SMTP path as the initial cold email, but
 * adds the In-Reply-To / References headers so Gmail threads it under the
 * original conversation. On success, advances Company.followUpStep and sets
 * the next-due timestamp (or transitions to `no_reply` after step 3).
 */
export async function sendApprovedFollowUp(
  userId: string,
  followUpEmailId: string,
  recipientEmail: string,
  performedBy?: string,
  customSenderEmail?: string
): Promise<{ success: boolean; error?: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { success: false, error: 'User not found' };

  const followUp = await prisma.followUpEmail.findUnique({
    where: { id: followUpEmailId },
    include: { company: true },
  });
  if (!followUp || followUp.company.userId !== userId) {
    return { success: false, error: 'Follow-up not found' };
  }
  if (followUp.sentAt) {
    return { success: false, error: 'Follow-up already sent' };
  }
  if (!followUp.approvedAt) {
    return { success: false, error: 'Follow-up must be approved before sending' };
  }
  if ((followUp.channel || 'email') === 'linkedin') {
    return {
      success: false,
      error: 'LinkedIn follow-ups are sent manually. Use markFollowUpAsSent / the LinkedIn modal instead.',
    };
  }

  // The follow-up sequence stops once the recipient replies. The Clients
  // page is responsible for marking replied; the engine just respects it.
  if (followUp.company.clientStatus !== 'contacted') {
    return {
      success: false,
      error: `Cannot send: company status is "${followUp.company.clientStatus}".`,
    };
  }

  const subject =
    followUp.finalSubject || followUp.editedSubject || followUp.subject || '';
  const body = followUp.finalBody || followUp.editedBody || followUp.body;

  const smtpConfig: UserSmtpConfig = {
    smtpProvider: user.smtpProvider,
    smtpHost: user.smtpHost,
    smtpPort: user.smtpPort,
    smtpSecure: user.smtpSecure,
    smtpUser: user.smtpUser,
    smtpPassword: user.smtpPassword,
    senderEmail: user.senderEmail,
    senderName: user.senderName,
    signature: user.signature,
  };

  const threading = followUp.threadMessageId
    ? {
        inReplyTo: followUp.threadMessageId,
        references: [followUp.threadMessageId],
      }
    : undefined;

  const result = await sendEmailViaSmtp(
    smtpConfig,
    recipientEmail,
    subject,
    body,
    customSenderEmail,
    threading
  );

  if (!result.success) {
    await prisma.followUpEmail.update({
      where: { id: followUp.id },
      data: { sendError: result.error, sendAttempts: { increment: 1 } },
    });
    return { success: false, error: result.error };
  }

  await prisma.followUpEmail.update({
    where: { id: followUp.id },
    data: {
      sentAt: result.sentAt,
      sentTo: recipientEmail,
      sendAttempts: { increment: 1 },
      sendError: null,
    },
  });

  // Advance the company. After step 3 (break-up) sends, move to no_reply.
  const newStep = followUp.step;
  const fuPlatform = (followUp.channel || 'email') as 'email' | 'linkedin';
  let nextFollowUpAt: Date | null = null;
  let newClientStatus: string = 'contacted';
  if (newStep < 3) {
    const nextPrompt = await prisma.followUpPrompt.findFirst({
      where: { userId, step: (newStep + 1) as number, platform: fuPlatform },
    });
    const offsetDays = nextPrompt?.dayOffset ?? (newStep === 1 ? 4 : 7);
    nextFollowUpAt = new Date(
      (result.sentAt || new Date()).getTime() + offsetDays * 24 * 60 * 60 * 1000
    );
  } else {
    newClientStatus = 'no_reply';
  }

  await prisma.company.update({
    where: { id: followUp.companyId },
    data: {
      followUpStep: newStep,
      nextFollowUpAt,
      clientStatus: newClientStatus,
      clientStatusUpdatedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      entityType: 'followup_email',
      entityId: followUp.id,
      action: 'followup_sent',
      metadata: {
        step: newStep,
        recipientEmail,
        performedBy,
        threaded: !!threading,
      },
    },
  });

  return { success: true };
}

/**
 * LinkedIn manual-send path. The user has copy-pasted the LinkedIn DM body
 * into their own LinkedIn account; we just mark the row sent and advance the
 * company. Mirrors the success branch of sendApprovedFollowUp but skips SMTP.
 */
export async function markFollowUpAsSent(
  userId: string,
  followUpEmailId: string,
  performedBy?: string
): Promise<{ success: boolean; error?: string }> {
  const followUp = await prisma.followUpEmail.findUnique({
    where: { id: followUpEmailId },
    include: { company: true },
  });
  if (!followUp || followUp.company.userId !== userId) {
    return { success: false, error: 'Follow-up not found' };
  }
  if (followUp.sentAt) {
    return { success: false, error: 'Follow-up already sent' };
  }
  if ((followUp.channel || 'email') !== 'linkedin') {
    return {
      success: false,
      error: 'markFollowUpAsSent is only valid for LinkedIn channel rows. Use sendApprovedFollowUp for email.',
    };
  }
  if (followUp.company.clientStatus !== 'contacted') {
    return {
      success: false,
      error: `Cannot mark sent: company status is "${followUp.company.clientStatus}".`,
    };
  }

  const sentAt = new Date();

  await prisma.followUpEmail.update({
    where: { id: followUp.id },
    data: {
      sentAt,
      sentTo: followUp.company.targetContactLinkedinUrl,
      sendAttempts: { increment: 1 },
      sendError: null,
      approvedAt: followUp.approvedAt || sentAt,
      approvedBy: followUp.approvedBy || performedBy || 'user',
    },
  });

  const newStep = followUp.step;
  let nextFollowUpAt: Date | null = null;
  let newClientStatus: string = 'contacted';
  if (newStep < 3) {
    const nextPrompt = await prisma.followUpPrompt.findFirst({
      where: { userId, step: (newStep + 1) as number, platform: 'linkedin' },
    });
    const offsetDays = nextPrompt?.dayOffset ?? (newStep === 1 ? 4 : 7);
    nextFollowUpAt = new Date(sentAt.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  } else {
    newClientStatus = 'no_reply';
  }

  await prisma.company.update({
    where: { id: followUp.companyId },
    data: {
      followUpStep: newStep,
      nextFollowUpAt,
      clientStatus: newClientStatus,
      clientStatusUpdatedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      entityType: 'followup_email',
      entityId: followUp.id,
      action: 'followup_sent',
      metadata: {
        step: newStep,
        channel: 'linkedin',
        manualSend: true,
        performedBy,
      },
    },
  });

  return { success: true };
}
