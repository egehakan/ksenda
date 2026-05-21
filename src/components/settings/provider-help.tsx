/*
 * Provider-specific setup guide for the SMTP picker.
 *
 * Same content rendered both in the onboarding flow (Email provider step)
 * and in /settings → Email provider. Kept here so the two surfaces never
 * drift out of sync — the SMTP App Password steps change often enough
 * (Workspace policy, M365 deprecations) that two copies would rot.
 */

export type SmtpProviderId = "gmail" | "outlook" | "custom";

export function ProviderHelp({ provider }: { provider: SmtpProviderId }) {
  if (provider === "gmail") {
    return (
      <div className="border-l-0 border border-[var(--color-line)] bg-[var(--color-panel)]/40 px-5 py-4 space-y-4 text-[13px]">
        <div>
          <p className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-muted)] mb-3">
            Gmail App Password — steps
          </p>
          <ol className="list-decimal list-outside ml-5 space-y-1.5 text-[var(--color-fg-muted)] leading-relaxed">
            <li>
              Sign in to{" "}
              <a
                className="text-[var(--color-accent)] hover:underline"
                href="https://myaccount.google.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                myaccount.google.com
              </a>{" "}
              → <span className="text-[var(--color-fg)]">Security</span>.
            </li>
            <li>
              Make sure <span className="text-[var(--color-fg)]">2-Step Verification</span> is on.
            </li>
            <li>
              Open{" "}
              <a
                className="text-[var(--color-accent)] hover:underline"
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noopener noreferrer"
              >
                myaccount.google.com/apppasswords
              </a>{" "}
              directly. It&apos;s hidden from the menu.
            </li>
            <li>
              Type a name like{" "}
              <code className="font-mono text-[12px] text-[var(--color-fg)] bg-[var(--color-canvas)] px-1">
                Ksenda
              </code>{" "}
              and click Create.
            </li>
            <li>Copy the 16-character password Google shows. You only see it once.</li>
            <li>
              Paste it into <span className="text-[var(--color-fg)]">App password</span> below.
            </li>
          </ol>
        </div>
        <div className="border-t border-[var(--color-line)] pt-4">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-muted)] mb-2">
            Workspace caveat
          </p>
          <p className="text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
            If{" "}
            <code className="font-mono text-[11px] bg-[var(--color-canvas)] px-1">apppasswords</code>{" "}
            says{" "}
            <em className="text-[var(--color-fg)] not-italic">
              &quot;the setting you&apos;re looking for is not available&quot;
            </em>
            , your Workspace admin has App Passwords disabled. Either ask them to enable it under
            Admin Console → Security → Authentication → 2-Step Verification, or use{" "}
            <span className="text-[var(--color-fg)]">Custom SMTP</span> with a relay (SendGrid,
            Postmark, Resend, Amazon SES SMTP).
          </p>
        </div>
        <p className="font-mono text-[11px] text-[var(--color-fg-subtle)] leading-relaxed">
          Sending limits: consumer Gmail ~500/day; Workspace ~2,000/day.
        </p>
      </div>
    );
  }

  if (provider === "outlook") {
    return (
      <div className="border border-[var(--color-line)] bg-[var(--color-panel)]/40 px-5 py-4 space-y-4 text-[13px]">
        <div className="border border-[oklch(0.50_0.14_30)] bg-[oklch(0.40_0.10_30/0.10)] p-3">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-status-error)] mb-2">
            Microsoft 365 business — not supported
          </p>
          <p className="text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
            Microsoft retired SMTP+Basic-Auth for Exchange Online tenants in March–April 2026. M365
            business accounts will fail with 535. Use{" "}
            <span className="text-[var(--color-fg)]">Custom SMTP</span> with a relay instead.
          </p>
        </div>
        <div>
          <p className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-muted)] mb-3">
            Personal outlook.com / hotmail.com / live.com
          </p>
          <ol className="list-decimal list-outside ml-5 space-y-1.5 text-[var(--color-fg-muted)] leading-relaxed">
            <li>
              Sign in to{" "}
              <a
                className="text-[var(--color-accent)] hover:underline"
                href="https://account.microsoft.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                account.microsoft.com
              </a>{" "}
              → <span className="text-[var(--color-fg)]">Security</span>.
            </li>
            <li>Turn on Two-step verification.</li>
            <li>
              Open{" "}
              <a
                className="text-[var(--color-accent)] hover:underline"
                href="https://account.live.com/proofs/AppPassword"
                target="_blank"
                rel="noopener noreferrer"
              >
                account.live.com/proofs/AppPassword
              </a>{" "}
              → Create a new app password.
            </li>
            <li>Paste it into App password below.</li>
          </ol>
        </div>
        <p className="font-mono text-[11px] text-[var(--color-fg-subtle)]">
          Sending limit ~300/day.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-[var(--color-line)] bg-[var(--color-panel)]/40 px-5 py-4 space-y-3 text-[13px]">
      <p className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-muted)]">
        Provider snippets
      </p>
      <ul className="space-y-1.5 text-[var(--color-fg-muted)] leading-relaxed">
        <li>
          <span className="text-[var(--color-fg)]">SendGrid</span>{" "}
          <code className="font-mono text-[12px]">smtp.sendgrid.net:587</code>, user ={" "}
          <code className="font-mono text-[12px]">apikey</code>, password = your API key.
        </li>
        <li>
          <span className="text-[var(--color-fg)]">Postmark</span>{" "}
          <code className="font-mono text-[12px]">smtp.postmarkapp.com:587</code>, both fields =
          Server API token.
        </li>
        <li>
          <span className="text-[var(--color-fg)]">Resend</span>{" "}
          <code className="font-mono text-[12px]">smtp.resend.com:587</code>, user ={" "}
          <code className="font-mono text-[12px]">resend</code>, password = your API key.
        </li>
        <li>
          <span className="text-[var(--color-fg)]">Mailgun</span>{" "}
          <code className="font-mono text-[12px]">smtp.mailgun.org:587</code>, with your domain
          SMTP credentials.
        </li>
        <li>
          <span className="text-[var(--color-fg)]">Amazon SES SMTP</span>{" "}
          <code className="font-mono text-[12px]">
            email-smtp.&lt;region&gt;.amazonaws.com:587
          </code>
          , with IAM SMTP credentials.
        </li>
      </ul>
      <p className="font-mono text-[11px] text-[var(--color-fg-subtle)]">
        Port 465 = implicit TLS; 587 = STARTTLS.
      </p>
    </div>
  );
}
