"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";
import { ProviderHelp } from "@/components/settings/provider-help";

interface UserResponse {
  user: {
    id: string;
    email: string;
    name: string | null;
    companyName: string | null;
    companyWebsite: string | null;
    senderEmail: string | null;
    senderName: string | null;
    signature: string | null;
    smtpProvider: string | null;
    smtpHost: string | null;
    smtpPort: number | null;
    smtpSecure: boolean | null;
    smtpUser: string | null;
    hasApolloKey: boolean;
    hasGeminiKey: boolean;
    hasSmtpPassword: boolean;
  };
}

const PLACEHOLDER_SECRET = "••••••••••••••••";

interface FormState {
  name: string;
  companyName: string;
  companyWebsite: string;

  apolloApiKey: string;
  geminiApiKey: string;

  smtpProvider: "" | "gmail" | "outlook" | "custom";
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;

  senderEmail: string;
  senderName: string;
  signature: string;
}

function buildInitialForm(u: UserResponse["user"]): FormState {
  return {
    name: u.name || "",
    companyName: u.companyName || "",
    companyWebsite: u.companyWebsite || "",
    apolloApiKey: u.hasApolloKey ? PLACEHOLDER_SECRET : "",
    geminiApiKey: u.hasGeminiKey ? PLACEHOLDER_SECRET : "",
    smtpProvider: (u.smtpProvider as FormState["smtpProvider"]) || "",
    smtpHost: u.smtpHost || "",
    smtpPort: u.smtpPort != null ? String(u.smtpPort) : "",
    smtpSecure: u.smtpSecure ?? false,
    smtpUser: u.smtpUser || "",
    smtpPassword: u.hasSmtpPassword ? PLACEHOLDER_SECRET : "",
    senderEmail: u.senderEmail || "",
    senderName: u.senderName || "",
    signature: u.signature || "",
  };
}

export function AccountSettings() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);
  const [showApollo, setShowApollo] = useState(false);
  const [showGemini, setShowGemini] = useState(false);
  const [showSmtpPassword, setShowSmtpPassword] = useState(false);
  const [showSignaturePreview, setShowSignaturePreview] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [verifyResult, setVerifyResult] = useState<
    { ok: true } | { ok: false; error: string } | null
  >(null);
  const { data, isLoading, isError, error } = useQuery<UserResponse>({
    queryKey: ["currentUser"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) throw new Error("Failed to fetch profile");
      return res.json();
    },
    retry: false,
  });

  useEffect(() => {
    if (data?.user) setForm(buildInitialForm(data.user));
  }, [data?.user]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form || !data?.user) throw new Error("not loaded");
      const payload: Record<string, unknown> = {
        name: form.name || null,
        companyName: form.companyName || null,
        companyWebsite: form.companyWebsite || null,
        senderEmail: form.senderEmail || null,
        senderName: form.senderName || null,
        signature: form.signature || null,
        smtpProvider: form.smtpProvider || null,
        smtpHost: form.smtpProvider === "custom" ? form.smtpHost || null : null,
        smtpPort:
          form.smtpProvider === "custom" && form.smtpPort
            ? Number(form.smtpPort)
            : null,
        smtpSecure: form.smtpProvider === "custom" ? form.smtpSecure : null,
        smtpUser: form.smtpUser || null,
      };

      if (form.apolloApiKey !== PLACEHOLDER_SECRET) {
        payload.apolloApiKey = form.apolloApiKey || null;
      }
      if (form.geminiApiKey !== PLACEHOLDER_SECRET) {
        payload.geminiApiKey = form.geminiApiKey || null;
      }
      if (form.smtpPassword !== PLACEHOLDER_SECRET) {
        payload.smtpPassword = form.smtpPassword || null;
      }
      if (!form.smtpProvider) {
        payload.smtpPassword = null;
      }

      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setSaveSuccess(true);
      setVerifyResult(null);
      setTimeout(() => setSaveSuccess(false), 2400);
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      await saveMutation.mutateAsync();
      const res = await fetch("/api/users/me/verify-smtp", { method: "POST" });
      const json = await res.json();
      return json as { success: boolean; error?: string };
    },
    onSuccess: (result) => {
      setVerifyResult(
        result.success
          ? { ok: true }
          : { ok: false, error: result.error || "Verification failed" }
      );
    },
    onError: (e: any) => {
      setVerifyResult({ ok: false, error: e?.message || "Verification failed" });
    },
  });

  if (isLoading || !form) {
    return (
      <div className="flex items-center gap-3 py-12 text-[var(--color-fg-muted)] font-mono text-[12px]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading settings...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 text-[var(--color-status-error)] py-6 text-[13px]">
        <AlertCircle className="h-4 w-4" />
        {error instanceof Error ? error.message : "Failed to load profile"}
      </div>
    );
  }

  const u = data!.user;
  const dirty =
    form.name !== (u.name || "") ||
    form.companyName !== (u.companyName || "") ||
    form.companyWebsite !== (u.companyWebsite || "") ||
    form.senderEmail !== (u.senderEmail || "") ||
    form.senderName !== (u.senderName || "") ||
    form.signature !== (u.signature || "") ||
    form.smtpProvider !== (u.smtpProvider || "") ||
    form.smtpHost !== (u.smtpHost || "") ||
    form.smtpPort !== (u.smtpPort != null ? String(u.smtpPort) : "") ||
    form.smtpSecure !== (u.smtpSecure ?? false) ||
    form.smtpUser !== (u.smtpUser || "") ||
    (form.apolloApiKey !== PLACEHOLDER_SECRET && form.apolloApiKey !== "") ||
    (form.apolloApiKey === "" && u.hasApolloKey) ||
    (form.geminiApiKey !== PLACEHOLDER_SECRET && form.geminiApiKey !== "") ||
    (form.geminiApiKey === "" && u.hasGeminiKey) ||
    (form.smtpPassword !== PLACEHOLDER_SECRET && form.smtpPassword !== "") ||
    (form.smtpPassword === "" && u.hasSmtpPassword);

  return (
    <div>
      {/* Sections */}
      <div className="min-w-0 max-w-[720px] space-y-6">
        {/* Profile */}
        <Section id="section-profile" title="Profile" eyebrow="01">
          <Field label="Email">
            <Input value={u.email} disabled className="font-mono text-[13px]" />
          </Field>
          <Field label="Your name">
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Optional"
            />
          </Field>
          <Field label="Sender company">
            <Input
              value={form.companyName}
              onChange={(e) => set("companyName", e.target.value)}
              placeholder="Acme Inc."
            />
            <Caption>Used inside the AI prompt as your sender context.</Caption>
          </Field>
          <Field label="Sender website">
            <Input
              value={form.companyWebsite}
              onChange={(e) => set("companyWebsite", e.target.value)}
              placeholder="https://acme.com"
              className="font-mono text-[13px]"
            />
          </Field>
        </Section>

        {/* API keys */}
        <Section
          id="section-keys"
          title="API keys"
          eyebrow="02"
          intro="Required to search leads (Apollo) and generate drafts (Gemini)."
        >
          <Field label="Apollo">
            <SecretInput
              value={form.apolloApiKey}
              onChange={(v) => set("apolloApiKey", v)}
              show={showApollo}
              onToggle={() => setShowApollo((v) => !v)}
              placeholder="Paste Apollo API key"
              name="ksenda-apollo-api-key"
            />
            <Caption>
              <a
                href="https://app.apollo.io/#/settings/integrations/api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-accent)] hover:underline"
              >
                app.apollo.io → Settings → Integrations → API
              </a>
            </Caption>
          </Field>

          <Field label="Google Gemini">
            <SecretInput
              value={form.geminiApiKey}
              onChange={(v) => set("geminiApiKey", v)}
              show={showGemini}
              onToggle={() => setShowGemini((v) => !v)}
              placeholder="Paste Gemini API key"
              name="ksenda-gemini-api-key"
            />
            <Caption>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-accent)] hover:underline"
              >
                Google AI Studio → API keys
              </a>
            </Caption>
          </Field>
        </Section>

        {/* Email provider */}
        <Section
          id="section-provider"
          title="Email provider"
          eyebrow="03"
          intro="Where outbound emails come from. Test connection saves and probes without sending mail. LinkedIn DMs are sent manually from your account — no provider needed for that channel."
        >
          <Field label="Provider">
            <ProviderPicker
              value={form.smtpProvider}
              onChange={(v) => set("smtpProvider", v)}
            />
          </Field>

          {form.smtpProvider && <ProviderHelp provider={form.smtpProvider} />}

          {form.smtpProvider === "custom" && (
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-x-6 gap-y-7">
              <Field label="SMTP host">
                <Input
                  value={form.smtpHost}
                  onChange={(e) => set("smtpHost", e.target.value)}
                  className="font-mono text-[13px]"
                  placeholder="smtp.example.com"
                />
              </Field>
              <Field label="Port">
                <Input
                  value={form.smtpPort}
                  onChange={(e) => set("smtpPort", e.target.value)}
                  className="font-mono text-[13px]"
                  inputMode="numeric"
                  placeholder="587"
                />
              </Field>
              <label className="sm:col-span-2 inline-flex items-center gap-2 cursor-pointer select-none mt-1">
                <input
                  type="checkbox"
                  checked={form.smtpSecure}
                  onChange={(e) => set("smtpSecure", e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                />
                <span className="font-mono text-[12px] text-[var(--color-fg-muted)]">
                  Implicit TLS (port 465). Leave off for STARTTLS on 587.
                </span>
              </label>
            </div>
          )}

          {form.smtpProvider && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-7 pt-1">
                <Field label="SMTP username">
                  <Input
                    type="email"
                    value={form.smtpUser}
                    onChange={(e) => set("smtpUser", e.target.value)}
                    className="font-mono text-[13px]"
                    placeholder="you@gmail.com"
                  />
                </Field>
                <Field label="App password">
                  <SecretInput
                    value={form.smtpPassword}
                    onChange={(v) => set("smtpPassword", v)}
                    show={showSmtpPassword}
                    onToggle={() => setShowSmtpPassword((v) => !v)}
                    placeholder="App password"
                    name="ksenda-smtp-app-password"
                  />
                </Field>
              </div>

              <div className="flex items-center gap-4 pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => verifyMutation.mutate()}
                  disabled={verifyMutation.isPending}
                >
                  {verifyMutation.isPending ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Testing
                    </>
                  ) : (
                    "Test connection"
                  )}
                </Button>
                {verifyResult?.ok && (
                  <span className="inline-flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--color-accent)]">
                    <CheckCircle2 className="h-3 w-3" />
                    Connected
                  </span>
                )}
                {verifyResult && !verifyResult.ok && (
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-status-error)]">
                    <AlertCircle className="h-3 w-3" />
                    {verifyResult.error}
                  </span>
                )}
              </div>
            </>
          )}
        </Section>

        {/* Sender */}
        <Section
          id="section-sender"
          title="Sender"
          eyebrow="04"
          intro="What the recipient sees as the FROM line."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-7">
            <Field label="Sender email">
              <Input
                type="email"
                value={form.senderEmail}
                onChange={(e) => set("senderEmail", e.target.value)}
                className="font-mono text-[13px]"
                placeholder={form.smtpUser || u.email}
              />
              <Caption>Defaults to SMTP username if blank.</Caption>
            </Field>
            <Field label="Display name">
              <Input
                value={form.senderName}
                onChange={(e) => set("senderName", e.target.value)}
                placeholder="Jane @ Acme"
              />
            </Field>
          </div>
        </Section>

        {/* Signature */}
        <Section
          id="section-signature"
          title="Signature"
          eyebrow="05"
          intro="HTML appended to the bottom of every outbound email. LinkedIn DMs have no signature — recipients see your LinkedIn profile."
        >
          <Field
            label="HTML"
            actions={
              form.signature ? (
                <button
                  type="button"
                  onClick={() => setShowSignaturePreview((v) => !v)}
                  className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] inline-flex items-center gap-1"
                >
                  {showSignaturePreview ? (
                    <>
                      <EyeOff className="h-3 w-3" /> Code
                    </>
                  ) : (
                    <>
                      <Eye className="h-3 w-3" /> Preview
                    </>
                  )}
                </button>
              ) : null
            }
          >
            {showSignaturePreview && form.signature ? (
              <div className="border border-[var(--color-line)] rounded-md overflow-hidden">
                <div className="px-3 py-1.5 bg-[var(--color-panel)] border-b border-[var(--color-line)] font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)]">
                  Recipient view (white background)
                </div>
                {/* Email-client preview pane: white card so the black
                    signature renders the way recipients see it in Gmail /
                    Outlook / Apple Mail. Inline `color: #000` forces
                    Tailwind's prose defaults out of the way. */}
                <div className="bg-white p-4" style={{ color: "#000000" }}>
                  <div
                    className="max-w-none"
                    style={{ color: "#000000" }}
                    dangerouslySetInnerHTML={{ __html: form.signature }}
                  />
                </div>
              </div>
            ) : (
              <Textarea
                value={form.signature}
                onChange={(e) => set("signature", e.target.value)}
                rows={6}
                placeholder={`<p>Best,<br><strong>Your Name</strong><br>Your Company</p>`}
                className="font-mono text-[12px]"
              />
            )}
          </Field>
        </Section>

        {/* Save bar */}
        <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-4 border-t border-[var(--color-line-soft)] bg-[var(--color-canvas)]/95 backdrop-blur-sm flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--color-fg-muted)]">
            {saveMutation.isError ? (
              <span className="text-[var(--color-status-error)]">
                {(saveMutation.error as Error).message}
              </span>
            ) : saveSuccess ? (
              <span className="text-[var(--color-status-success)] inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" />
                Saved
              </span>
            ) : dirty ? (
              "Unsaved changes"
            ) : (
              "All changes saved"
            )}
          </span>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!dirty || saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  eyebrow?: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28">
      <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] text-[var(--color-fg)] shadow-sm">
        <div className="flex flex-col gap-1.5 p-6">
          <h2 className="text-base font-semibold leading-tight tracking-tight text-[var(--color-fg)]">
            {title}
          </h2>
          {intro && (
            <p className="text-sm leading-relaxed text-[var(--color-fg-muted)]">
              {intro}
            </p>
          )}
        </div>
        <div className="p-6 pt-0 space-y-5">{children}</div>
      </div>
    </section>
  );
}

function Field({
  label,
  actions,
  children,
}: {
  label: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {actions}
      </div>
      {children}
    </div>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs leading-relaxed text-[var(--color-fg-muted)] mt-1">
      {children}
    </p>
  );
}

function SecretInput({
  value,
  onChange,
  show,
  onToggle,
  placeholder,
  name,
}: {
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder?: string;
  /** Unique field hint for password managers — see SecretInput in
   *  onboarding/page.tsx for the full rationale. */
  name?: string;
}) {
  return (
    <div className="relative flex items-center">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono text-[13px] pr-10"
        placeholder={placeholder}
        autoComplete="new-password"
        name={name}
        data-1p-ignore="true"
        data-lpignore="true"
        data-bwignore="true"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-0 top-1/2 -translate-y-1/2 p-2 text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors"
        aria-label={show ? "Hide" : "Show"}
      >
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function ProviderPicker({
  value,
  onChange,
}: {
  value: FormState["smtpProvider"];
  onChange: (v: FormState["smtpProvider"]) => void;
}) {
  const options: Array<{
    id: Exclude<FormState["smtpProvider"], "">;
    label: string;
    detail: string;
  }> = [
    { id: "gmail", label: "Gmail", detail: "smtp.gmail.com:587 — App Password required" },
    { id: "outlook", label: "Outlook", detail: "smtp-mail.outlook.com:587 — personal accounts only" },
    { id: "custom", label: "Custom SMTP", detail: "SendGrid, Postmark, Resend, Mailgun, SES SMTP, …" },
  ];

  return (
    <div className="border border-[var(--color-line)] divide-y divide-[var(--color-line)]">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            type="button"
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className={cn(
              "w-full flex items-baseline justify-between gap-4 px-4 py-3 text-left",
              "transition-colors duration-150",
              active
                ? "bg-[var(--color-panel)]"
                : "hover:bg-[var(--color-panel)]"
            )}
          >
            <span className="flex items-baseline gap-3">
              <span
                className={cn(
                  "inline-block h-1.5 w-1.5 rounded-full shrink-0",
                  active ? "bg-[var(--color-accent)]" : "bg-transparent border border-[var(--color-fg-muted)]"
                )}
              />
              <span className="text-[14px] font-medium text-[var(--color-fg)]">{opt.label}</span>
            </span>
            <span className="font-mono text-[11px] text-[var(--color-fg-muted)] hidden sm:inline">
              {opt.detail}
            </span>
          </button>
        );
      })}
    </div>
  );
}

