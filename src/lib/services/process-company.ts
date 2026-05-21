/**
 * Per-company "process one" helpers extracted so Inngest functions can
 * checkpoint via step.run() per item. Both the bulk process-all flow and
 * the batch-retry flow share these — the difference is just whether they
 * start from PENDING_GENERATION (need contact discovery) or
 * EMAIL_NOT_GENERATED (contact already on the row, just regenerate).
 */
import prisma from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { findBestContact } from "@/lib/services/apollo";
import {
  generateEmailWithRetry,
  generateLinkedInMessageWithRetry,
} from "@/lib/services/gemini";
import { transitionState, markEmailNotGenerated } from "@/lib/services/pipeline";
import { PIPELINE_STATES, GEMINI_MODEL } from "@/lib/constants";
import type { AiDetectionResult } from "@/lib/services/ai-detector";

export type Channel = "email" | "linkedin";

export type ProcessOneOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "no_contact"; reason: string }
  | { kind: "generated"; subject: string | null; bodyLength: number }
  | { kind: "error"; error: string };

interface ProcessOneInput {
  userId: string;
  companyId: string;
  /** Custom prompt override; if undefined the helper resolves the user's active_prompt for the given channel. */
  customPrompt?: string;
  /** Outreach channel; defaults to "email" for back-compat. */
  channel?: Channel;
}

function formatAiSummary(aiStatusJson: string | null | undefined): string | undefined {
  if (!aiStatusJson) return undefined;
  try {
    const r = JSON.parse(aiStatusJson) as AiDetectionResult;
    const verdict =
      r.confidence === "confirmed_has_ai"
        ? "CONFIRMED: company already deploys AI."
        : r.confidence === "definitely_no_ai"
          ? "NO AI: no observable AI deployment."
          : r.confidence === "probably_no_ai"
            ? "PROBABLY NO AI: ambiguous signal."
            : "UNKNOWN.";
    const signalLine =
      r.operationalSignals && r.operationalSignals.length > 0
        ? `Operational signals: ${r.operationalSignals.slice(0, 4).join("; ")}`
        : "";
    return [verdict, r.summary, signalLine].filter(Boolean).join("\n");
  } catch {
    return undefined;
  }
}

async function resolvePrompt(
  userId: string,
  override?: string,
  platform: Channel = "email"
): Promise<string | undefined> {
  if (override) return override;
  const active = await prisma.prompt.findFirst({
    where: { userId, name: "active_prompt", platform },
  });
  return active?.content;
}

/**
 * From PENDING_GENERATION: discover contact (Apollo) → generate email
 * (Gemini) → transition to PENDING_REVIEW. Mirrors the inline logic that
 * used to live in /api/pipeline/process-all and the per-row branch of
 * importCompaniesForUser.
 */
export async function processOneCompanyForGeneration(
  input: ProcessOneInput
): Promise<ProcessOneOutcome> {
  const { userId, companyId } = input;
  const channel: Channel = input.channel ?? "email";

  const [user, company] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.company.findFirst({
      where: { id: companyId, userId },
      include: { email: true },
    }),
  ]);
  if (!user) return { kind: "error", error: "User not found" };
  if (!company) return { kind: "error", error: "Company not found" };
  if (company.email) return { kind: "skipped", reason: "Email already exists" };
  if (!user.apolloApiKey || !user.geminiApiKey) {
    return { kind: "error", error: "Apollo/Gemini API keys not configured" };
  }
  if (!company.apolloId) {
    await markEmailNotGenerated(userId, companyId, "no_apollo_id");
    return { kind: "no_contact", reason: "no_apollo_id" };
  }

  const bestContact = await findBestContact(
    user.apolloApiKey,
    company.name,
    company.apolloId,
    userId,
    channel
  );

  if (!bestContact.person) {
    await markEmailNotGenerated(userId, companyId, "no_valid_contact_found");
    return { kind: "no_contact", reason: "no_valid_contact_found" };
  }

  await prisma.company.update({
    where: { id: companyId },
    data: {
      targetContactFirstName: bestContact.person.first_name || null,
      targetContactLastName: bestContact.person.last_name || null,
      targetContactEmail: bestContact.enrichedEmail || null,
      targetContactTitle: bestContact.title || bestContact.person.title || null,
      targetContactLinkedinUrl: bestContact.person.linkedin_url || null,
      contactFoundAt: new Date(),
    },
  });

  // Channel-specific gating: email needs targetContactEmail; LinkedIn needs
  // targetContactLinkedinUrl. Apollo returns both as best-effort.
  if (channel === "email" && !bestContact.enrichedEmail) {
    await markEmailNotGenerated(userId, companyId, "contact_found_no_email");
    return { kind: "no_contact", reason: "contact_found_no_email" };
  }
  if (channel === "linkedin" && !bestContact.person.linkedin_url) {
    await markEmailNotGenerated(userId, companyId, "contact_found_no_linkedin");
    return { kind: "no_contact", reason: "contact_found_no_linkedin" };
  }

  const promptToUse = await resolvePrompt(userId, input.customPrompt, channel);

  const generationOpts = {
    apiKey: user.geminiApiKey,
    companyName: company.name,
    companyDomain: company.domain,
    customPrompt: promptToUse,
    companyWebsite: company.website || undefined,
    contact: {
      firstName: bestContact.person.first_name || "",
      lastName: bestContact.person.last_name || undefined,
      title: bestContact.title || bestContact.person.title || undefined,
    },
    sender: {
      companyName: user.companyName,
      companyWebsite: user.companyWebsite,
      senderName: user.senderName,
    },
    aiDetectionSummary: formatAiSummary(company.aiStatusJson),
  };

  if (channel === "linkedin") {
    const liResult = await generateLinkedInMessageWithRetry(generationOpts);
    if (!liResult.success) {
      await markEmailNotGenerated(
        userId,
        companyId,
        `linkedin_generation_failed: ${liResult.error}`
      );
      return {
        kind: "error",
        error: liResult.error || "linkedin_generation_failed",
      };
    }

    await prisma.email.create({
      data: {
        companyId,
        channel: "linkedin",
        subject: null,
        body: liResult.body!,
        promptUsed: promptToUse || "",
        geminiModelUsed: GEMINI_MODEL,
      },
    });

    await transitionState(userId, companyId, PIPELINE_STATES.PENDING_REVIEW);

    await prisma.auditLog.create({
      data: {
        userId,
        entityType: "email",
        entityId: companyId,
        action: "linkedin_generated",
        metadata: {
          bodyLength: liResult.body?.length,
          targetContact: `${bestContact.person.first_name} ${
            bestContact.person.last_name || ""
          }`.trim(),
          channel: "linkedin",
          autoProcessed: true,
        },
      },
    });

    return {
      kind: "generated",
      subject: null,
      bodyLength: liResult.body?.length ?? 0,
    };
  }

  // Default: email channel
  const emailResult = await generateEmailWithRetry(generationOpts);

  if (!emailResult.success) {
    await markEmailNotGenerated(
      userId,
      companyId,
      `email_generation_failed: ${emailResult.error}`
    );
    return {
      kind: "error",
      error: emailResult.error || "email_generation_failed",
    };
  }

  await prisma.email.create({
    data: {
      companyId,
      channel: "email",
      subject: emailResult.subject!,
      body: emailResult.body!,
      promptUsed: promptToUse || "",
      geminiModelUsed: GEMINI_MODEL,
    },
  });

  await transitionState(userId, companyId, PIPELINE_STATES.PENDING_REVIEW);

  await prisma.auditLog.create({
    data: {
      userId,
      entityType: "email",
      entityId: companyId,
      action: "email_generated",
      metadata: {
        subject: emailResult.subject,
        bodyLength: emailResult.body?.length,
        targetContact: `${bestContact.person.first_name} ${
          bestContact.person.last_name || ""
        }`.trim(),
        autoProcessed: true,
      },
    },
  });

  return {
    kind: "generated",
    subject: emailResult.subject!,
    bodyLength: emailResult.body?.length ?? 0,
  };
}

/**
 * From EMAIL_NOT_GENERATED: regenerate the email using the contact already
 * stored on the company row. No Apollo call — just Gemini. Mirrors the
 * inline logic in /api/pipeline/batch-retry.
 */
export async function retryEmailGenerationForCompany(
  input: ProcessOneInput
): Promise<ProcessOneOutcome> {
  const { userId, companyId } = input;
  const channel: Channel = input.channel ?? "email";

  const [user, company] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.company.findFirst({ where: { id: companyId, userId } }),
  ]);
  if (!user) return { kind: "error", error: "User not found" };
  if (!company) return { kind: "error", error: "Company not found" };
  if (!user.geminiApiKey) {
    return { kind: "error", error: "Gemini API key not configured" };
  }

  if (channel === "email" && !company.targetContactEmail) {
    return { kind: "no_contact", reason: "no_target_contact_email" };
  }
  if (channel === "linkedin" && !company.targetContactLinkedinUrl) {
    return { kind: "no_contact", reason: "no_target_contact_linkedin" };
  }

  const promptToUse = await resolvePrompt(userId, input.customPrompt, channel);

  const generationOpts = {
    apiKey: user.geminiApiKey,
    companyName: company.name,
    companyDomain: company.domain,
    customPrompt: promptToUse,
    companyWebsite: company.website || undefined,
    contact: {
      firstName: company.targetContactFirstName || "",
      lastName: company.targetContactLastName || undefined,
      title: company.targetContactTitle || undefined,
    },
    sender: {
      companyName: user.companyName,
      companyWebsite: user.companyWebsite,
      senderName: user.senderName,
    },
    aiDetectionSummary: company.aiStatusJson
      ? formatAiSummary(company.aiStatusJson)
      : undefined,
  };

  if (channel === "linkedin") {
    const liResult = await generateLinkedInMessageWithRetry(generationOpts);
    if (!liResult.success) {
      return { kind: "error", error: liResult.error || "LinkedIn generation failed" };
    }

    await prisma.email.deleteMany({ where: { companyId } });
    await prisma.email.create({
      data: {
        companyId,
        channel: "linkedin",
        subject: null,
        body: liResult.body!,
        promptUsed: promptToUse || "",
        geminiModelUsed: GEMINI_MODEL,
      },
    });

    await prisma.company.update({
      where: { id: companyId },
      data: { notGeneratedReason: Prisma.JsonNull },
    });

    await transitionState(userId, companyId, PIPELINE_STATES.PENDING_REVIEW);

    await prisma.auditLog.create({
      data: {
        userId,
        entityType: "email",
        entityId: companyId,
        action: "linkedin_generated",
        metadata: {
          bodyLength: liResult.body?.length,
          channel: "linkedin",
          batchRetry: true,
        },
      },
    });

    return {
      kind: "generated",
      subject: null,
      bodyLength: liResult.body?.length ?? 0,
    };
  }

  const emailResult = await generateEmailWithRetry(generationOpts);

  if (!emailResult.success) {
    return { kind: "error", error: emailResult.error || "Email generation failed" };
  }

  await prisma.email.deleteMany({ where: { companyId } });
  await prisma.email.create({
    data: {
      companyId,
      channel: "email",
      subject: emailResult.subject!,
      body: emailResult.body!,
      promptUsed: promptToUse || "",
      geminiModelUsed: GEMINI_MODEL,
    },
  });

  await prisma.company.update({
    where: { id: companyId },
    data: { notGeneratedReason: Prisma.JsonNull },
  });

  await transitionState(userId, companyId, PIPELINE_STATES.PENDING_REVIEW);

  await prisma.auditLog.create({
    data: {
      userId,
      entityType: "email",
      entityId: companyId,
      action: "email_generated",
      metadata: {
        subject: emailResult.subject,
        bodyLength: emailResult.body?.length,
        batchRetry: true,
      },
    },
  });

  return {
    kind: "generated",
    subject: emailResult.subject!,
    bodyLength: emailResult.body?.length ?? 0,
  };
}
