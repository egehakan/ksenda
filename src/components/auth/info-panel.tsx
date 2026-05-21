/*
 * Right-side info column for auth pages.
 *
 * Designed to fit a laptop viewport without scrolling. Just the plainest
 * possible explanation of the product: a one-line summary, then five tight
 * "how it works" steps. No pipeline mock, no separate rules list.
 */
export function AuthInfoPanel() {
  return (
    <aside className="hidden lg:flex flex-col justify-center border-l border-[var(--color-line)] px-12 xl:px-16 py-12">
      <div>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)]">
          What Ksenda is
        </span>
        <h2 className="mt-5 text-[24px] leading-[1.2] tracking-tight font-medium text-[var(--color-fg)] max-w-[28ch]">
          A cold outreach pipeline across email and LinkedIn.
        </h2>
        <p className="mt-4 text-[13.5px] leading-relaxed text-[var(--color-fg-muted)] max-w-[44ch]">
          Apollo finds the leads. Gemini writes the emails and the LinkedIn
          DMs. You review every line. Email goes through your own SMTP;
          LinkedIn DMs you paste manually from your own account.
        </p>
      </div>

      <div className="mt-10">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)]">
          How it works
        </span>
        <ol className="mt-4 space-y-3.5 max-w-[46ch]">
          <Step n="01" title="Connect your keys"
            body="Apollo, Gemini, and your Gmail / Outlook / SMTP credentials."
          />
          <Step n="02" title="Search Apollo"
            body="Filter by location, industry, headcount, keywords. Pick email or LinkedIn for each batch."
          />
          <Step n="03" title="We draft, per recipient"
            body="Gemini writes a personalized email or a short LinkedIn DM to the right decision-maker at each company."
          />
          <Step n="04" title="You review"
            body="Every draft sits in a queue. Edit, approve, or skip. Nothing auto-sends unless you flip the switch."
          />
          <Step n="05" title="Send through your channel"
            body="Email fires via your SMTP. LinkedIn opens the profile in a new tab so you paste the message yourself."
          />
        </ol>
      </div>
    </aside>
  );
}

function Step({
  n,
  title,
  body,
}: {
  n: string;
  title: string;
  body: string;
}) {
  return (
    <li className="grid grid-cols-[26px_1fr] gap-x-3 items-baseline">
      <span className="font-mono text-[11px] tabular-nums text-[var(--color-fg-subtle)]">
        {n}
      </span>
      <div>
        <span className="text-[13.5px] font-medium text-[var(--color-fg)]">{title}.</span>{" "}
        <span className="text-[13px] leading-relaxed text-[var(--color-fg-muted)]">
          {body}
        </span>
      </div>
    </li>
  );
}
