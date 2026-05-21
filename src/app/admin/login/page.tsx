"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/admin";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login failed");
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

  return (
    <div className="w-full max-w-[420px]">
      <div className="mb-12 flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-md bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <ShieldCheck className="h-4 w-4" />
        </div>
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-fg-muted)]">
          Ksenda · Admin
        </div>
      </div>

      <h1 className="text-[28px] font-medium leading-[1.15] tracking-tight text-[var(--color-fg)]">
        Operator sign in
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-fg-muted)]">
        Restricted area. Activity is logged.
      </p>

      <form onSubmit={handleSubmit} className="mt-10 space-y-6">
        <div className="space-y-2">
          <Label htmlFor="admin-email">Email</Label>
          <Input
            id="admin-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="font-mono text-[13px]"
            required
            disabled={isLoading}
            autoComplete="username"
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="admin-password">Password</Label>
          <Input
            id="admin-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="font-mono text-[13px]"
            required
            disabled={isLoading}
            autoComplete="current-password"
          />
        </div>

        {error && (
          <p className="text-[13px] leading-relaxed text-[var(--color-status-error)]">
            {error}
          </p>
        )}

        <div className="flex justify-end pt-2">
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

function AdminLoginFallback() {
  return (
    <div className="w-full max-w-[420px]">
      <Loader2 className="h-5 w-5 animate-spin text-[var(--color-fg-muted)]" />
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <main className="min-h-dvh grid place-items-center bg-[var(--color-canvas)] px-6 py-12">
      <Suspense fallback={<AdminLoginFallback />}>
        <AdminLoginForm />
      </Suspense>
    </main>
  );
}
