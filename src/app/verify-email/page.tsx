"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { BrandLogo } from "@/components/ui/brand-logo";

type Status = "verifying" | "success" | "error";

function VerifyEmailInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<Status>(token ? "verifying" : "error");
  const [error, setError] = useState<string>(
    token ? "" : "Missing verification token. Use the link from your email."
  );
  const [verifiedEmail, setVerifiedEmail] = useState<string>("");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setStatus("error");
          setError(data.error || "Verification failed.");
          return;
        }
        setStatus("success");
        setVerifiedEmail(data.user?.email || "");
      } catch {
        if (cancelled) return;
        setStatus("error");
        setError("Network error. Try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="w-full max-w-[460px]">
      <div className="mb-14 flex justify-center">
        <BrandLogo height={56} priority />
      </div>

      {status === "verifying" && (
        <>
          <h1 className="text-[30px] font-medium leading-[1.15] tracking-tight text-[var(--color-fg)]">
            Verifying.
          </h1>
          <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-fg-muted)]">
            One moment.
          </p>
          <div className="mt-10">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--color-fg-muted)]" />
          </div>
        </>
      )}

      {status === "success" && (
        <>
          <h1 className="text-[30px] font-medium leading-[1.15] tracking-tight text-[var(--color-fg)]">
            Verified.
          </h1>
          {verifiedEmail && (
            <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-fg-muted)]">
              <span className="font-mono text-[13px] text-[var(--color-fg)]">{verifiedEmail}</span> is
              ready.
            </p>
          )}
          <div className="mt-10">
            <Button
              size="lg"
              onClick={() => {
                // New users land in onboarding first. The dashboard would
                // bounce them here anyway via the meData effect, but going
                // direct avoids the flash. Existing verified users will
                // pass through /onboarding straight to / because their
                // `onboardingCompletedAt` is already set.
                router.push("/onboarding");
                router.refresh();
              }}
            >
              Continue setup
            </Button>
          </div>
        </>
      )}

      {status === "error" && (
        <>
          <h1 className="text-[30px] font-medium leading-[1.15] tracking-tight text-[var(--color-fg)]">
            Couldn&apos;t verify.
          </h1>
          <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-status-error)]">
            {error}
          </p>
          <div className="mt-10">
            <Link
              href="/login"
              className="font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
            >
              ← Back to sign in
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function VerifyEmailFallback() {
  return (
    <div className="w-full max-w-[460px]">
      <div className="mb-14 flex justify-center">
        <BrandLogo height={56} />
      </div>
      <Loader2 className="h-5 w-5 animate-spin text-[var(--color-fg-muted)]" />
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <main className="min-h-dvh flex items-start justify-center px-6 pt-[14vh]">
      <Suspense fallback={<VerifyEmailFallback />}>
        <VerifyEmailInner />
      </Suspense>
    </main>
  );
}
