"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { BrandLogo } from "@/components/ui/brand-logo";
import { AuthInfoPanel } from "@/components/auth/info-panel";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent">("idle");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNeedsVerification(false);
    setResendStatus("idle");
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Login failed");
        if (data.needsVerification) setNeedsVerification(true);
        return;
      }

      router.push(redirect);
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email) return;
    setResendStatus("sending");
    try {
      await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setResendStatus("sent");
      setTimeout(() => setResendStatus("idle"), 4000);
    } catch {
      setResendStatus("idle");
    }
  };

  return (
    <div className="w-full max-w-[460px]">
      <div className="mb-14 flex justify-center">
        <BrandLogo height={56} priority />
      </div>

      <h1 className="text-[30px] font-medium leading-[1.15] tracking-tight text-[var(--color-fg)]">
        Sign in.
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-fg-muted)]">
        Pipeline waiting on you.
      </p>

      <form onSubmit={handleSubmit} className="mt-10 space-y-7">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="font-mono text-[13px]"
            required
            disabled={isLoading}
            autoComplete="email"
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="font-mono text-[13px]"
            required
            disabled={isLoading}
            autoComplete="current-password"
          />
        </div>

        {error && !needsVerification && (
          <p className="text-[13px] leading-relaxed text-[var(--color-status-error)]">
            {error}
          </p>
        )}

        {needsVerification && (
          <div className="space-y-3 border-t border-[var(--color-line)] pt-5">
            <p className="text-[13px] leading-relaxed text-[var(--color-fg)]">
              Email not verified. {error || "Check your inbox for the link we sent."}
            </p>
            <button
              type="button"
              onClick={handleResend}
              disabled={resendStatus !== "idle" || !email}
              className="font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--color-accent)] hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {resendStatus === "sending" && "Sending..."}
              {resendStatus === "sent" && "Sent. Check your inbox."}
              {resendStatus === "idle" && "Resend verification →"}
            </button>
          </div>
        )}

        <div className="flex items-center justify-between pt-3">
          <Link
            href="/register"
            className="font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
          >
            Create account →
          </Link>
          <Button type="submit" disabled={isLoading} size="lg">
            {isLoading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Signing in
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

function LoginFallback() {
  return (
    <div className="w-full max-w-[460px]">
      <div className="mb-14 flex justify-center">
        <BrandLogo height={56} priority />
      </div>
      <Loader2 className="h-5 w-5 animate-spin text-[var(--color-fg-muted)]" />
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-dvh grid grid-cols-1 lg:grid-cols-2">
      <div className="flex items-center justify-center px-6 py-12">
        <Suspense fallback={<LoginFallback />}>
          <LoginForm />
        </Suspense>
      </div>
      <AuthInfoPanel />
    </main>
  );
}
