import nodemailer, { type Transporter } from 'nodemailer';
import prisma from '@/lib/prisma';
import { PIPELINE_STATES } from '@/lib/constants';
import { signatureHtml } from '@/lib/signatures';
import { transitionState } from './pipeline';

interface SendResult {
  success: boolean;
  error?: string;
  sentAt?: Date;
  /** RFC 822 message-id returned by nodemailer. Used as In-Reply-To on follow-ups. */
  messageId?: string;
}

export type SmtpProvider = 'gmail' | 'outlook' | 'custom';

export interface UserSmtpConfig {
  smtpProvider: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  smtpUser: string | null;
  smtpPassword: string | null;
  senderEmail: string | null;
  senderName: string | null;
  signature: string | null;
}

export interface EmailProviderPreset {
  host: string;
  port: number;
  secure: boolean;
}

export const PROVIDER_PRESETS: Record<SmtpProvider, EmailProviderPreset> = {
  // Port 465 (implicit SSL) over 587 (STARTTLS) — Gmail accepts both, but
  // many ISPs / corporate networks / café Wi-Fi block outbound 587 to
  // prevent open-relay abuse. 465 is rarely blocked. Functionally
  // identical from the client side.
  gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
  // Personal outlook.com / hotmail.com / live.com.
  // M365 business tenants no longer support SMTP+app-password as of Apr 2026 —
  // those users should pick "custom" and use a relay (or wait for OAuth support).
  outlook: { host: 'smtp-mail.outlook.com', port: 587, secure: false },
  custom: { host: '', port: 587, secure: false },
};

function textToHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>\n');
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export class SmtpNotConfiguredError extends Error {
  constructor(message?: string) {
    super(message || 'Email sending is not configured for this account');
    this.name = 'SmtpNotConfiguredError';
  }
}

interface ResolvedSmtp {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromEmail: string;
  senderName: string | null;
  signature: string | null;
}

export function resolveSmtpConfig(user: UserSmtpConfig): ResolvedSmtp {
  const provider = (user.smtpProvider || '').toLowerCase() as SmtpProvider | '';
  if (!provider) {
    throw new SmtpNotConfiguredError(
      'No email provider selected. Pick Gmail / Outlook / Custom SMTP and save.'
    );
  }
  const missing: string[] = [];
  if (!user.smtpUser) missing.push('SMTP username (email)');
  if (!user.smtpPassword) missing.push('SMTP password / app password');
  if (missing.length) {
    throw new SmtpNotConfiguredError(
      `Missing ${missing.join(' and ')}. Fill it in and click Save changes.`
    );
  }

  let host: string;
  let port: number;
  let secure: boolean;

  if (provider === 'custom') {
    if (!user.smtpHost) {
      throw new SmtpNotConfiguredError('Custom SMTP host is required.');
    }
    host = user.smtpHost;
    port = user.smtpPort || 587;
    secure = user.smtpSecure ?? port === 465;
  } else if (provider === 'gmail' || provider === 'outlook') {
    const preset = PROVIDER_PRESETS[provider];
    host = preset.host;
    port = preset.port;
    secure = preset.secure;
  } else {
    throw new SmtpNotConfiguredError(`Unknown provider: ${provider}`);
  }

  // Already validated above
  const smtpUser = user.smtpUser as string;
  const smtpPassword = user.smtpPassword as string;
  const fromEmail = user.senderEmail || smtpUser;

  return {
    host,
    port,
    secure,
    user: smtpUser,
    pass: smtpPassword,
    fromEmail,
    senderName: user.senderName,
    signature: user.signature,
  };
}

function makeTransporter(cfg: ResolvedSmtp): Transporter {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    // Bound the failure-mode latency. ISP-level port blocks normally
    // surface as ETIMEDOUT after the kernel's TCP retry window (~75s on
    // macOS). Forcing 15s here means a blocked port fails in ~15s instead
    // of hanging the UI for a minute-plus.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

export interface VerifyResult {
  success: boolean;
  error?: string;
}

/** Try to log in to the configured SMTP server without sending mail. */
export async function verifySmtpConfig(user: UserSmtpConfig): Promise<VerifyResult> {
  let cfg: ResolvedSmtp;
  try {
    cfg = resolveSmtpConfig(user);
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'SMTP not configured',
    };
  }

  const transporter = makeTransporter(cfg);
  try {
    await transporter.verify();
    return { success: true };
  } catch (e: any) {
    return {
      success: false,
      error: e?.message || 'SMTP verification failed',
    };
  }
}

/**
 * Send a single email via the user's SMTP. Optional `threading` lets the
 * caller thread this message onto a previous message-id (i.e. for follow-ups,
 * Gmail will then collapse them into the same conversation).
 */
export async function sendEmailViaSmtp(
  user: UserSmtpConfig,
  to: string,
  subject: string,
  body: string,
  customSenderEmail?: string,
  threading?: { inReplyTo: string; references?: string[] },
  lang?: string | null
): Promise<SendResult> {
  let cfg: ResolvedSmtp;
  try {
    cfg = resolveSmtpConfig(user);
  } catch {
    return {
      success: false,
      error: 'Email sending is not configured. Add Gmail/Outlook/SMTP credentials in Settings.',
    };
  }

  // Localized signature by the email's language (en|tr; stale 'de' coerces to
  // en). Overrides the account's static signature so a mixed-language account
  // (e.g. Turkish to Turkey + English to UAE) signs each mail in the right
  // language with the matching egehakankaraagac.com/<lang> landing link.
  // First-touch sends (no
  // threading) drop the cal.com booking link from the signature; follow-ups
  // thread, so they keep it.
  if (lang) cfg.signature = signatureHtml(lang, !threading);

  const fromEmail = customSenderEmail || cfg.fromEmail;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(to)) {
    return { success: false, error: `Invalid recipient email address: ${to}` };
  }
  if (!emailRegex.test(fromEmail)) {
    return { success: false, error: `Invalid sender email address: ${fromEmail}` };
  }

  // Strip trailing whitespace from the body so the body→signature gap is
  // determined entirely by us, not by whatever blank lines the AI happened
  // to end with. Then insert exactly two blank lines (three <br>s: one to
  // close the body's last line, two to make blank lines) before the
  // signature opens.
  const trimmedBody = body.replace(/\s+$/, '');
  let htmlBody = textToHtml(trimmedBody);
  let plainTextBody = trimmedBody;
  if (cfg.signature) {
    htmlBody = htmlBody + '<br><br><br>' + cfg.signature;
    plainTextBody = trimmedBody + '\n\n\n' + stripHtml(cfg.signature);
  }

  const fromHeader = cfg.senderName ? `"${cfg.senderName}" <${fromEmail}>` : fromEmail;

  const transporter = makeTransporter(cfg);

  try {
    const info = await transporter.sendMail({
      from: fromHeader,
      to,
      subject,
      html: htmlBody,
      text: plainTextBody,
      ...(threading
        ? {
            inReplyTo: threading.inReplyTo,
            references: threading.references || [threading.inReplyTo],
          }
        : {}),
    });

    console.log(`[SMTP] Email sent. messageId=${info.messageId} to=${to}`);
    return { success: true, sentAt: new Date(), messageId: info.messageId };
  } catch (e: any) {
    console.error('[SMTP] Send error:', e);
    let errorMessage = 'Failed to send email';
    if (e?.responseCode === 535) {
      errorMessage = 'SMTP authentication failed. Check your email provider credentials (app password may be required).';
    } else if (e?.code === 'EENVELOPE') {
      errorMessage = 'Email rejected by server (sender or recipient address invalid).';
    } else if (e?.code === 'ECONNECTION' || e?.code === 'ETIMEDOUT') {
      errorMessage = 'Could not reach the SMTP server. Check host/port and try again.';
    } else if (e?.message) {
      errorMessage = `SMTP error: ${e.message}`;
    }
    return { success: false, error: errorMessage };
  }
}

/**
 * Send an approved email belonging to a specific user. The user is loaded so
 * we can resolve their SMTP config + sender identity.
 */
export async function sendApprovedEmail(
  userId: string,
  companyId: string,
  recipientEmail: string,
  performedBy?: string,
  customSenderEmail?: string
): Promise<{ success: boolean; error?: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { success: false, error: 'User not found' };

  const company = await prisma.company.findFirst({
    where: { id: companyId, userId },
    include: { email: true },
  });

  if (!company) return { success: false, error: 'Company not found' };

  if (company.pipelineState !== PIPELINE_STATES.APPROVED_TO_SEND) {
    return {
      success: false,
      error: `Cannot send email: company is in state "${company.pipelineState}"`,
    };
  }
  if (!company.email) return { success: false, error: 'No email found for this company' };
  if ((company.email.channel || 'email') === 'linkedin') {
    return {
      success: false,
      error: 'LinkedIn-channel rows are sent manually. Use markInitialEmailAsSent / the LinkedIn modal instead.',
    };
  }

  const subject =
    company.email.finalSubject || company.email.editedSubject || company.email.subject || '';
  const body = company.email.finalBody || company.email.editedBody || company.email.body;

  const result = await sendEmailViaSmtp(
    user,
    recipientEmail,
    subject,
    body,
    customSenderEmail,
    undefined,
    (company.email as { language?: string }).language
  );

  if (!result.success) {
    await prisma.email.update({
      where: { id: company.email.id },
      data: {
        sendAttempts: { increment: 1 },
        sendError: result.error,
      },
    });
    return { success: false, error: result.error };
  }

  await prisma.email.update({
    where: { id: company.email.id },
    data: {
      sentAt: result.sentAt,
      sentTo: recipientEmail,
      sendAttempts: { increment: 1 },
      sendError: null,
      messageId: result.messageId || null,
    },
  });

  const transitionResult = await transitionState(
    userId,
    companyId,
    PIPELINE_STATES.SENT,
    performedBy,
    { recipientEmail, sentAt: result.sentAt }
  );

  if (!transitionResult.success) {
    return { success: false, error: transitionResult.error };
  }

  // Promote the company into the client lifecycle. Sets next follow-up due
  // date based on the user's FollowUpPrompt step 1 dayOffset (defaults to 3
  // days per the 90-Day Plan).
  const platform = (company.email.channel || 'email') as 'email' | 'linkedin';
  const step1Prompt = await prisma.followUpPrompt.findFirst({
    where: { userId, step: 1, platform },
  });
  const nextDays = step1Prompt?.dayOffset ?? 3;
  const sentAt = result.sentAt || new Date();
  const nextAt = new Date(sentAt.getTime() + nextDays * 24 * 60 * 60 * 1000);
  await prisma.company.update({
    where: { id: companyId },
    data: {
      clientStatus: 'contacted',
      clientStatusUpdatedAt: sentAt,
      nextFollowUpAt: nextAt,
      followUpStep: 0,
    },
  });

  return { success: true };
}

/**
 * LinkedIn manual-send path for an initial Email row with channel='linkedin'.
 * The user has copy-pasted the message into LinkedIn themselves; we just mark
 * the row sent and advance the company. Mirrors sendApprovedEmail's success
 * branch minus the SMTP call.
 */
export async function markInitialEmailAsSent(
  userId: string,
  companyId: string,
  performedBy?: string
): Promise<{ success: boolean; error?: string }> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, userId },
    include: { email: true },
  });
  if (!company) return { success: false, error: 'Company not found' };
  if (company.pipelineState !== PIPELINE_STATES.APPROVED_TO_SEND) {
    return {
      success: false,
      error: `Cannot mark sent: company is in state "${company.pipelineState}"`,
    };
  }
  if (!company.email) return { success: false, error: 'No outreach record for this company' };
  if ((company.email.channel || 'email') !== 'linkedin') {
    return {
      success: false,
      error: 'markInitialEmailAsSent is only valid for LinkedIn channel rows.',
    };
  }

  const sentAt = new Date();

  await prisma.email.update({
    where: { id: company.email.id },
    data: {
      sentAt,
      sentTo: company.targetContactLinkedinUrl,
      sendAttempts: { increment: 1 },
      sendError: null,
    },
  });

  const transitionResult = await transitionState(
    userId,
    companyId,
    PIPELINE_STATES.SENT,
    performedBy,
    { recipientLinkedinUrl: company.targetContactLinkedinUrl, sentAt, channel: 'linkedin' }
  );

  if (!transitionResult.success) {
    return { success: false, error: transitionResult.error };
  }

  const step1Prompt = await prisma.followUpPrompt.findFirst({
    where: { userId, step: 1, platform: 'linkedin' },
  });
  const nextDays = step1Prompt?.dayOffset ?? 3;
  const nextAt = new Date(sentAt.getTime() + nextDays * 24 * 60 * 60 * 1000);
  await prisma.company.update({
    where: { id: companyId },
    data: {
      clientStatus: 'contacted',
      clientStatusUpdatedAt: sentAt,
      nextFollowUpAt: nextAt,
      followUpStep: 0,
    },
  });

  return { success: true };
}
