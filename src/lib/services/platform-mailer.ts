import { Resend } from 'resend';

/**
 * Platform-level transactional email (verify, password reset, etc.) via
 * Resend. This is *not* user-facing email sending — that's done per-user
 * with each tenant's own SMTP credentials in `email-sender.ts`. Platform
 * mail is a separate concern with its own Resend account and a single
 * verified sending domain (ksenda.com).
 *
 * Required env vars:
 *   RESEND_API_KEY        (re_… key from https://resend.com/api-keys)
 *   RESEND_FROM_EMAIL     verified sender on a domain Resend confirmed,
 *                         e.g. "noreply@ksenda.com"
 *   RESEND_FROM_NAME      optional display name (default: "Ksenda")
 *
 * Plus NEXT_PUBLIC_APP_URL so we can build verification links.
 */

const FROM_NAME_DEFAULT = 'Ksenda';

export class PlatformMailNotConfiguredError extends Error {
  constructor() {
    super(
      'Platform email is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.'
    );
    this.name = 'PlatformMailNotConfiguredError';
  }
}

interface PlatformMailerConfig {
  apiKey: string;
  fromEmail: string;
  fromName: string;
}

function loadConfig(): PlatformMailerConfig {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const fromName = process.env.RESEND_FROM_NAME || FROM_NAME_DEFAULT;

  if (!apiKey || !fromEmail) {
    throw new PlatformMailNotConfiguredError();
  }
  return { apiKey, fromEmail, fromName };
}

let cachedClient: Resend | null = null;
function getClient(cfg: PlatformMailerConfig): Resend {
  if (cachedClient) return cachedClient;
  cachedClient = new Resend(cfg.apiKey);
  return cachedClient;
}

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
}

async function sendPlatformEmail({ to, subject, html, text }: SendArgs): Promise<void> {
  const cfg = loadConfig();
  const client = getClient(cfg);
  const from = `${cfg.fromName} <${cfg.fromEmail}>`;

  const { data, error } = await client.emails.send({
    from,
    to: [to],
    subject,
    html,
    text,
  });

  if (error) {
    throw new Error(
      `[platform-mailer] Resend send failed: ${error.name ?? 'UnknownError'}: ${error.message ?? JSON.stringify(error)}`
    );
  }

  console.log(
    `[platform-mailer] Sent to=${to} subject=${JSON.stringify(subject)} resendId=${data?.id ?? '?'}`
  );
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ──────────────────────────────────────────────────────────────────────
// Shared email layout
// ──────────────────────────────────────────────────────────────────────

interface TemplateArgs {
  /** Heading shown at the top of the card. */
  title: string;
  /** Greeting line, e.g. "Hi Ege," or "Welcome,". */
  greeting: string;
  /** Body paragraph rendered above the CTA button. */
  body: string;
  /** Button label, e.g. "Verify email". */
  ctaLabel: string;
  /** Absolute URL the CTA button points at. */
  ctaHref: string;
  /** Small line below the button (e.g. token expiry). Optional. */
  footnote?: string;
}

/**
 * Build the shared HTML + plain-text bodies for any transactional email.
 *
 * Layout rules:
 *   - Table-based, inline styles only (Outlook + Gmail compat).
 *   - 520px max-width card, centered on a soft grey canvas.
 *   - "Ksenda" rendered as plain text at the top using the same system
 *     font stack as the rest of the email — no hosted image dependency.
 *   - Single CTA button, brand violet (#7C3AED). No "or copy and paste
 *     this URL" fallback — visual quality wins over the rare case of an
 *     HTML-disabled client (those clients still get the link from the
 *     plain-text body).
 */
function renderEmail(args: TemplateArgs): { html: string; text: string } {
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light only">
    <meta name="supported-color-schemes" content="light only">
    <title>${escapeHtml(args.title)}</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f4f4f5; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4f4f5;">
      <tr>
        <td align="center" style="padding:48px 16px;">

          <!-- Card -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px; background-color:#ffffff; border-radius:16px; border:1px solid #ececef;">

            <!-- Wordmark -->
            <tr>
              <td align="left" style="padding:36px 40px 8px 40px;">
                <span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; font-size:22px; font-weight:600; color:#0a0a0a; letter-spacing:-0.02em; line-height:1;">Ksenda</span>
              </td>
            </tr>

            <!-- Title -->
            <tr>
              <td align="left" style="padding:24px 40px 0 40px;">
                <h1 style="margin:0; font-size:22px; line-height:1.3; font-weight:600; color:#0a0a0a; letter-spacing:-0.012em;">
                  ${escapeHtml(args.title)}
                </h1>
              </td>
            </tr>

            <!-- Greeting + body -->
            <tr>
              <td align="left" style="padding:16px 40px 0 40px;">
                <p style="margin:0; font-size:15px; line-height:1.65; color:#52525b;">${args.greeting}</p>
                <p style="margin:14px 0 0 0; font-size:15px; line-height:1.65; color:#52525b;">${args.body}</p>
              </td>
            </tr>

            <!-- CTA button (table-wrapped for Outlook) -->
            <tr>
              <td align="left" style="padding:28px 40px 8px 40px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" bgcolor="#7C3AED" style="background-color:#7C3AED; border-radius:10px;">
                      <a href="${args.ctaHref}" target="_blank" rel="noopener" style="display:inline-block; padding:13px 22px; font-size:15px; font-weight:600; color:#ffffff; text-decoration:none; letter-spacing:-0.005em; line-height:1;">
                        ${escapeHtml(args.ctaLabel)}
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            ${
              args.footnote
                ? `<!-- Footnote -->
            <tr>
              <td align="left" style="padding:20px 40px 36px 40px;">
                <p style="margin:0; font-size:13px; line-height:1.6; color:#a1a1aa;">${escapeHtml(args.footnote)}</p>
              </td>
            </tr>`
                : `<tr><td style="padding-bottom:36px;">&nbsp;</td></tr>`
            }

          </table>

          <!-- Outer footer -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;">
            <tr>
              <td align="left" style="padding:20px 40px 0 40px;">
                <p style="margin:0; font-size:12px; line-height:1.6; color:#a1a1aa;">
                  Sent by <span style="color:#52525b; font-weight:500;">Ksenda</span> &middot; precision cold-email outreach.<br>
                  If this message wasn't for you, you can safely ignore it.
                </p>
              </td>
            </tr>
          </table>

        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `${args.title}

${args.greeting}

${args.body.replace(/<[^>]+>/g, '')}

${args.ctaLabel}: ${args.ctaHref}
${args.footnote ? `\n${args.footnote}\n` : ''}
— Ksenda
`;

  return { html, text };
}

// ──────────────────────────────────────────────────────────────────────
// Templates
// ──────────────────────────────────────────────────────────────────────

export async function sendVerificationEmail(args: {
  to: string;
  recipientName?: string | null;
  token: string;
}): Promise<void> {
  const { to, recipientName, token } = args;
  const link = `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : 'Welcome to Ksenda,';

  const { html, text } = renderEmail({
    title: 'Verify your Ksenda email',
    greeting,
    body: 'Thanks for signing up. Confirm your email to activate your account and start drafting your first campaign.',
    ctaLabel: 'Verify email',
    ctaHref: link,
    footnote: 'This link expires in 24 hours.',
  });

  await sendPlatformEmail({
    to,
    subject: 'Verify your Ksenda account',
    html,
    text,
  });
}

/**
 * Cheap "is the platform mailer configured?" check that doesn't actually
 * try to talk to Resend. Useful for surfacing setup problems clearly at
 * the registration boundary.
 */
export function isPlatformMailerConfigured(): boolean {
  try {
    loadConfig();
    return true;
  } catch {
    return false;
  }
}
