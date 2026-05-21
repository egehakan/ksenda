"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { BrandLogo } from "@/components/ui/brand-logo";
import { AuthInfoPanel } from "@/components/auth/info-panel";

export default function RegisterPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent">("idle");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          name: name || undefined,
          companyName: companyName || undefined,
          companyWebsite: companyWebsite || undefined,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Registration failed");
        return;
      }

      if (data.requiresVerification) {
        setSubmittedEmail(data.email || email);
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (!submittedEmail) return;
    setResendStatus("sending");
    try {
      await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: submittedEmail }),
      });
      setResendStatus("sent");
      setTimeout(() => setResendStatus("idle"), 4000);
    } catch {
      setResendStatus("idle");
    }
  };

  if (submittedEmail) {
    return (
      <main className="min-h-dvh grid grid-cols-1 lg:grid-cols-2">
        <div className="flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-[460px]">
          <div className="mb-14 flex justify-center">
            <BrandLogo height={56} priority />
          </div>

          <h1 className="text-[30px] font-medium leading-[1.15] tracking-tight text-[var(--color-fg)]">
            Check your inbox.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-[var(--color-fg-muted)]">
            Verification link sent to{" "}
            <span className="font-mono text-[14px] text-[var(--color-fg)]">{submittedEmail}</span>.
            It expires in 24 hours.
          </p>

          <div className="mt-10 flex items-center justify-between border-t border-[var(--color-line)] pt-6">
            <Link
              href="/login"
              className="font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
            >
              ← Back to sign in
            </Link>
            <button
              type="button"
              onClick={handleResend}
              disabled={resendStatus !== "idle"}
              className="font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--color-accent)] hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {resendStatus === "sending" && "Sending..."}
              {resendStatus === "sent" && "Resent."}
              {resendStatus === "idle" && "Resend →"}
            </button>
          </div>
          </div>
        </div>
        <AuthInfoPanel />
      </main>
    );
  }

  return (
    <main className="min-h-dvh grid grid-cols-1 lg:grid-cols-2">
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[460px]">
        <div className="mb-14 flex justify-center">
          <BrandLogo height={56} priority />
        </div>

        <h1 className="text-[30px] font-medium leading-[1.15] tracking-tight text-[var(--color-fg)]">
          Create account.
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-fg-muted)]">
          Bring your own Apollo, Gemini, and SMTP. We don&apos;t handle deliverability.
        </p>

        <form onSubmit={handleSubmit} className="mt-10 space-y-7">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-7">
            <div className="space-y-2 sm:col-span-2">
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
                minLength={8}
                disabled={isLoading}
                autoComplete="new-password"
              />
              <p className="font-mono text-[11px] text-[var(--color-fg-subtle)]">
                Min 8 characters
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Your name</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isLoading}
                placeholder="Optional"
              />
            </div>

            <div className="space-y-2 sm:col-span-2 pt-3 border-t border-[var(--color-line)]">
              <Label htmlFor="companyName">Sender company</Label>
              <Input
                id="companyName"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                disabled={isLoading}
                placeholder="Acme Inc."
              />
              <p className="text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
                Used as your company context inside the AI prompt.
              </p>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="companyWebsite">Sender website</Label>
              <Input
                id="companyWebsite"
                type="url"
                value={companyWebsite}
                onChange={(e) => setCompanyWebsite(e.target.value)}
                className="font-mono text-[13px]"
                disabled={isLoading}
                placeholder="https://acme.com"
              />
            </div>
          </div>

          {error && (
            <p className="text-[13px] leading-relaxed text-[var(--color-status-error)]">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between pt-3 border-t border-[var(--color-line)]">
            <Link
              href="/login"
              className="font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
            >
              ← Sign in instead
            </Link>
            <Button type="submit" disabled={isLoading} size="lg">
              {isLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Creating
                </>
              ) : (
                "Create account"
              )}
            </Button>
          </div>
        </form>
        </div>
      </div>
      <AuthInfoPanel />
    </main>
  );
}
