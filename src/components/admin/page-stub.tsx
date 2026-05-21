import { Construction } from "lucide-react";

interface PageStubProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
}

/**
 * Temporary placeholder shown for admin pages whose full implementation
 * lives in a later build phase. Same header layout as the real pages so
 * the shell doesn't visibly shift when a page is implemented.
 */
export function PageStub({ eyebrow, title, subtitle }: PageStubProps) {
  return (
    <div className="px-8 py-8 max-w-[1400px] mx-auto">
      <div>
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--color-fg-muted)]">
          {eyebrow}
        </div>
        <h1 className="mt-2 text-[26px] font-medium tracking-tight text-[var(--color-fg)]">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-[13px] text-[var(--color-fg-muted)]">
            {subtitle}
          </p>
        )}
      </div>

      <div className="mt-10 rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] p-12 text-center">
        <div className="mx-auto grid h-10 w-10 place-items-center rounded-md bg-[var(--color-raised)] text-[var(--color-fg-muted)]">
          <Construction className="h-4 w-4" />
        </div>
        <p className="mt-4 text-[13px] text-[var(--color-fg)]">
          This page is queued in the build plan.
        </p>
        <p className="mt-1 text-[12px] text-[var(--color-fg-muted)]">
          Implementation is in progress — check back shortly.
        </p>
      </div>
    </div>
  );
}
