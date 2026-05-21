"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { BrandLogo } from "@/components/ui/brand-logo";
import { cn } from "@/lib/utils";
import { TARGET_TITLE_CATEGORIES } from "@/lib/constants";
import { CategorizedTitlePicker } from "@/components/onboarding/title-picker";
import { ProviderHelp } from "@/components/settings/provider-help";

type StepId =
  | "welcome"
  | "profile"
  | "apiKeys"
  | "emailProvider"
  | "sender"
  | "signature"
  | "targetTitles"
  | "done";

const STEP_ORDER: StepId[] = [
  "welcome",
  "profile",
  "apiKeys",
  "emailProvider",
  "sender",
  "signature",
  "targetTitles",
  "done",
];

const STEP_META: Record<
  StepId,
  { label: string; eyebrow: string; description: string; required: boolean }
> = {
  welcome: {
    label: "Welcome",
    eyebrow: "00",
    description: "A short setup so the pipeline can run.",
    required: false,
  },
  profile: {
    label: "Profile",
    eyebrow: "01",
    description: "Who you are and what company you represent.",
    required: true,
  },
  apiKeys: {
    label: "API keys",
    eyebrow: "02",
    description: "Apollo finds the leads. Gemini writes the email + LinkedIn drafts.",
    required: true,
  },
  emailProvider: {
    label: "Email provider",
    eyebrow: "03",
    description: "Where your outbound emails come from. LinkedIn DMs are sent manually from your account — no provider needed.",
    required: true,
  },
  sender: {
    label: "Sender",
    eyebrow: "04",
    description: "What email recipients see in the FROM line. LinkedIn DMs use your own LinkedIn identity.",
    required: false,
  },
  signature: {
    label: "Signature",
    eyebrow: "05",
    description: "HTML appended to the bottom of every email. LinkedIn DMs have no signature.",
    required: false,
  },
  targetTitles: {
    label: "Target titles",
    eyebrow: "06",
    description: "Decision-maker roles Apollo will search for.",
    required: true,
  },
  done: {
    label: "Done",
    eyebrow: "07",
    description: "Everything's ready.",
    required: false,
  },
};

const PLACEHOLDER_SECRET = "••••••••••••••••";

type RealStepId = Exclude<StepId, "welcome" | "done">;

interface OnboardingState {
  step: StepId | null;
  completedAt: string | null;
  filled: Record<RealStepId, boolean>;
  titleCount: number;
  profile: { name: string | null; companyName: string | null; companyWebsite: string | null };
  emailProvider: {
    smtpProvider: string | null;
    smtpHost: string | null;
    smtpPort: number | null;
    smtpSecure: boolean | null;
    smtpUser: string | null;
  };
  sender: { senderEmail: string | null; senderName: string | null };
  signature: string | null;
  hasApolloKey: boolean;
  hasGeminiKey: boolean;
  hasSmtpPassword: boolean;
}

export default function OnboardingPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: state, isLoading } = useQuery<OnboardingState>({
    queryKey: ["onboardingState"],
    queryFn: async () => {
      const res = await fetch("/api/onboarding");
      if (!res.ok) throw new Error("Failed to load onboarding state");
      return res.json();
    },
    retry: false,
  });

  const [currentStep, setCurrentStep] = useState<StepId>("welcome");
  const [hydrated, setHydrated] = useState(false);
  // Highest STEP_ORDER index the user has reached. Sidebar items beyond this
  // are disabled — strict sequential flow, no skipping. Bumped only by
  // Continue (goNext), never by sidebar clicks. Persisted implicitly via
  // `state.step` so resume picks up where the user left off.
  const [furthestReachedIdx, setFurthestReachedIdx] = useState(0);

  useEffect(() => {
    if (!state || hydrated) return;
    if (state.completedAt) {
      router.replace("/");
      return;
    }
    // If the user has nothing saved we start at "welcome". Otherwise we jump
    // to the step AFTER the last one they finished. The user can always go
    // back with the prev arrow.
    const resumeFrom: StepId = (() => {
      const saved = state.step as StepId | null;
      if (!saved || saved === "welcome") return "welcome";
      if (saved === "done") return "done";
      const idx = STEP_ORDER.indexOf(saved);
      if (idx === -1) return "welcome";
      const next = STEP_ORDER[idx + 1];
      return next ?? saved;
    })();
    setCurrentStep(resumeFrom);
    setFurthestReachedIdx(STEP_ORDER.indexOf(resumeFrom));
    setHydrated(true);
  }, [state, hydrated, router]);

  const persistStep = useMutation({
    mutationFn: async (step: StepId) => {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step }),
      });
      if (!res.ok) throw new Error("Failed to save progress");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboardingState"] });
    },
  });

  const completeOnboarding = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ complete: true }),
      });
      if (!res.ok) throw new Error("Failed to complete onboarding");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboardingState"] });
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
    },
  });

  const goToStep = (step: StepId, recordPrevious: boolean = true) => {
    const currentIdx = STEP_ORDER.indexOf(currentStep);
    if (recordPrevious && currentIdx >= 0 && currentStep !== "welcome") {
      // Save the step the user just finished so we resume past it on reload.
      persistStep.mutate(currentStep);
    }
    setCurrentStep(step);
    setFurthestReachedIdx((prev) => Math.max(prev, STEP_ORDER.indexOf(step)));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goNext = () => {
    const idx = STEP_ORDER.indexOf(currentStep);
    const next = STEP_ORDER[idx + 1];
    if (next) goToStep(next, currentStep !== "welcome");
  };

  const goBack = () => {
    const idx = STEP_ORDER.indexOf(currentStep);
    if (idx > 0) goToStep(STEP_ORDER[idx - 1], false);
  };

  /**
   * Sidebar navigation — only allowed BACKWARDS to a step the user has
   * already visited. Forward jumps must go through Continue so each step's
   * data gets saved. Returns null when the step isn't yet reachable.
   */
  const jumpToReachedStep = (step: StepId): (() => void) | null => {
    const targetIdx = STEP_ORDER.indexOf(step);
    if (targetIdx > furthestReachedIdx) return null;
    return () => goToStep(step, false);
  };

  if (isLoading || !state) {
    return (
      <main className="min-h-dvh flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--color-fg-muted)]" />
      </main>
    );
  }

  // ONLY show this redirect-spinner for users who LAND on /onboarding with
  // a pre-existing completedAt (the resume effect above will router.replace
  // them away on next tick). Once the page has hydrated, we trust the
  // component flow — when the user finishes the wizard, state.completedAt
  // flips true via the refetch, but currentStep is already "done" so the
  // DoneStep renders with its "Open dashboard" button. Without this guard
  // the user gets stuck on a spinner.
  if (state.completedAt && !hydrated) {
    return (
      <main className="min-h-dvh flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--color-fg-muted)]" />
      </main>
    );
  }

  const progress = STEP_ORDER.indexOf(currentStep);
  const total = STEP_ORDER.length - 1; // exclude "done" from the bar denominator

  return (
    <main className="min-h-dvh grid grid-cols-1 lg:grid-cols-[280px_1fr]">
      {/* Side rail */}
      <aside className="hidden lg:flex flex-col gap-8 border-r border-[var(--color-line)] px-7 py-10">
        <div>
          <BrandLogo height={42} priority />
        </div>
        <div>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)]">
            Setup
          </span>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-fg-muted)]">
            Six quick steps. Finish each one to unlock the next — we save as you go.
          </p>
        </div>
        <nav className="space-y-1">
          {(STEP_ORDER.filter((s) => s !== "welcome" && s !== "done") as RealStepId[]).map((step) => {
            const meta = STEP_META[step];
            const active = currentStep === step;
            const filled = state.filled[step];
            const stepIdx = STEP_ORDER.indexOf(step);
            const reached = stepIdx <= furthestReachedIdx;
            const onClick = jumpToReachedStep(step);
            return (
              <button
                key={step}
                type="button"
                onClick={onClick ?? undefined}
                disabled={!onClick}
                aria-disabled={!reached}
                className={cn(
                  "w-full flex items-center gap-3 rounded-md px-3 py-2 text-left transition-colors",
                  active
                    ? "bg-[var(--color-accent-soft)] text-[var(--color-fg)]"
                    : reached
                    ? "text-[var(--color-fg-muted)] hover:bg-[var(--color-panel)] hover:text-[var(--color-fg)] cursor-pointer"
                    : "text-[var(--color-fg-subtle)] cursor-not-allowed opacity-60"
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-5 w-5 items-center justify-center rounded-full font-mono text-[10px] tabular-nums",
                    filled
                      ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                      : active
                      ? "border border-[var(--color-accent)] text-[var(--color-accent)]"
                      : "border border-[var(--color-line)] text-[var(--color-fg-subtle)]"
                  )}
                >
                  {filled ? <Check className="h-3 w-3" /> : meta.eyebrow}
                </span>
                <span className="text-[13.5px] font-medium">{meta.label}</span>
                {!reached && (
                  <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
                    locked
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Step content */}
      <div className="flex flex-col">
        {/* Mobile header */}
        <div className="lg:hidden border-b border-[var(--color-line)] px-6 py-5 flex items-center justify-between">
          <BrandLogo height={32} priority />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)] tabular-nums">
            Step {Math.min(progress, total - 1)} / {total - 1}
          </span>
        </div>

        {/* Progress bar */}
        <div className="border-b border-[var(--color-line)]">
          <div
            className="h-0.5 bg-[var(--color-accent)] transition-[width] duration-500 ease-out"
            style={{
              width: `${Math.min(100, (progress / (total - 1)) * 100)}%`,
            }}
          />
        </div>

        <div className="flex-1 flex justify-center px-6 lg:px-12 py-12">
          <div className="w-full max-w-[640px]">
            <StepHeader step={currentStep} />

            <div className="mt-10">
              {currentStep === "welcome" && (
                <WelcomeStep onNext={goNext} userName={state.profile.name} />
              )}
              {currentStep === "profile" && (
                <ProfileStep
                  initial={state.profile}
                  onNext={goNext}
                  onBack={goBack}
                />
              )}
              {currentStep === "apiKeys" && (
                <ApiKeysStep
                  hasApolloKey={state.hasApolloKey}
                  hasGeminiKey={state.hasGeminiKey}
                  onNext={goNext}
                  onBack={goBack}
                />
              )}
              {currentStep === "emailProvider" && (
                <EmailProviderStep
                  initial={state.emailProvider}
                  hasSmtpPassword={state.hasSmtpPassword}
                  onNext={goNext}
                  onBack={goBack}
                />
              )}
              {currentStep === "sender" && (
                <SenderStep
                  initial={state.sender}
                  fallbackEmail={state.emailProvider.smtpUser || ""}
                  onNext={goNext}
                  onBack={goBack}
                />
              )}
              {currentStep === "signature" && (
                <SignatureStep
                  initial={state.signature}
                  onNext={goNext}
                  onBack={goBack}
                />
              )}
              {currentStep === "targetTitles" && (
                <TargetTitlesStep
                  hasGeminiKey={state.hasGeminiKey}
                  hasCompanyProfile={state.filled.profile}
                  onNext={async () => {
                    // The titles step is the last — also flip the completion flag.
                    persistStep.mutate("targetTitles");
                    await completeOnboarding.mutateAsync();
                    goToStep("done", false);
                  }}
                  onBack={goBack}
                  completing={completeOnboarding.isPending}
                />
              )}
              {currentStep === "done" && <DoneStep />}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function StepHeader({ step }: { step: StepId }) {
  const meta = STEP_META[step];
  return (
    <div>
      <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)] tabular-nums">
        {meta.eyebrow} · {meta.label}
        {!meta.required && step !== "welcome" && step !== "done" && " · Optional"}
      </span>
      <h1 className="mt-3 text-[28px] leading-[1.15] tracking-tight font-medium text-[var(--color-fg)]">
        {step === "welcome" && "Let's get you set up."}
        {step === "profile" && "Tell us about you."}
        {step === "apiKeys" && "Connect your API keys."}
        {step === "emailProvider" && "Pick your email provider."}
        {step === "sender" && "Your FROM identity."}
        {step === "signature" && "Add a signature."}
        {step === "targetTitles" && "Who do you want to reach?"}
        {step === "done" && "You're ready."}
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-fg-muted)] max-w-[52ch]">
        {meta.description}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step components
// ---------------------------------------------------------------------------

function WelcomeStep({
  onNext,
  userName,
}: {
  onNext: () => void;
  userName: string | null;
}) {
  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] p-5 space-y-5">
        <p className="text-[14px] leading-relaxed text-[var(--color-fg-muted)]">
          {userName ? <>Welcome, {userName}.</> : <>Welcome.</>}{" "}
          Before your dashboard, we need a few things so the pipeline can actually do its job.
        </p>
        <ul className="space-y-2.5">
          {[
            { label: "Profile", body: "Your name and company context for the AI." },
            { label: "API keys", body: "Apollo for leads, Gemini for email + LinkedIn drafts." },
            { label: "Email provider", body: "Gmail, Outlook, or any SMTP relay (for the email channel only)." },
            { label: "Sender + signature", body: "What the email recipient sees. Optional." },
            { label: "Target titles", body: "Decision-maker roles to search for — applies to both channels." },
          ].map((row, i) => (
            <li key={row.label} className="flex items-baseline gap-3">
              <span className="font-mono text-[11px] tabular-nums text-[var(--color-fg-subtle)] w-5">
                0{i + 1}
              </span>
              <span>
                <span className="text-[13.5px] font-medium text-[var(--color-fg)]">
                  {row.label}.
                </span>{" "}
                <span className="text-[13px] text-[var(--color-fg-muted)]">{row.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="font-mono text-[11px] text-[var(--color-fg-subtle)] leading-relaxed">
        Takes ~3 minutes. Each step saves immediately — you can leave and come back.
      </p>
      <div className="flex items-center justify-end">
        <Button onClick={onNext} size="lg">
          Let's go
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ProfileStep({
  initial,
  onNext,
  onBack,
}: {
  initial: OnboardingState["profile"];
  onNext: () => void;
  onBack: () => void;
}) {
  const [name, setName] = useState(initial.name ?? "");
  const [companyName, setCompanyName] = useState(initial.companyName ?? "");
  const [companyWebsite, setCompanyWebsite] = useState(initial.companyWebsite ?? "");

  const save = useStepSaver(async () => {
    const res = await fetch("/api/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim() || null,
        companyName: companyName.trim() || null,
        companyWebsite: companyWebsite.trim() || null,
      }),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Failed to save");
  });

  const valid = name.trim() && companyName.trim() && companyWebsite.trim();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        save.run().then(() => onNext());
      }}
      className="space-y-6"
    >
      <Field label="Your name" required>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jane Doe"
          autoFocus
        />
      </Field>
      <Field label="Company name" required>
        <Input
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="Acme Inc."
        />
        <Caption>Used inside the AI prompt as your sender context.</Caption>
      </Field>
      <Field label="Company website" required>
        <Input
          value={companyWebsite}
          onChange={(e) => setCompanyWebsite(e.target.value)}
          placeholder="https://acme.com"
          className="font-mono text-[13px]"
        />
        <Caption>Gemini fetches this to infer your positioning.</Caption>
      </Field>
      <StepFooter
        onBack={onBack}
        canContinue={!!valid}
        saving={save.saving}
        error={save.error}
      />
    </form>
  );
}

function ApiKeysStep({
  hasApolloKey,
  hasGeminiKey,
  onNext,
  onBack,
}: {
  hasApolloKey: boolean;
  hasGeminiKey: boolean;
  onNext: () => void;
  onBack: () => void;
}) {
  const [apolloApiKey, setApolloApiKey] = useState(hasApolloKey ? PLACEHOLDER_SECRET : "");
  const [geminiApiKey, setGeminiApiKey] = useState(hasGeminiKey ? PLACEHOLDER_SECRET : "");
  const [showApollo, setShowApollo] = useState(false);
  const [showGemini, setShowGemini] = useState(false);

  const save = useStepSaver(async () => {
    const payload: Record<string, unknown> = {};
    if (apolloApiKey !== PLACEHOLDER_SECRET) payload.apolloApiKey = apolloApiKey || null;
    if (geminiApiKey !== PLACEHOLDER_SECRET) payload.geminiApiKey = geminiApiKey || null;
    if (Object.keys(payload).length === 0) return;
    const res = await fetch("/api/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Failed to save");
  });

  const apolloProvided = apolloApiKey === PLACEHOLDER_SECRET || apolloApiKey.trim().length > 0;
  const geminiProvided = geminiApiKey === PLACEHOLDER_SECRET || geminiApiKey.trim().length > 0;
  const valid = apolloProvided && geminiProvided;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        save.run().then(() => onNext());
      }}
      className="space-y-6"
    >
      <Field label="Apollo API key" required>
        <SecretInput
          value={apolloApiKey}
          onChange={setApolloApiKey}
          show={showApollo}
          onToggle={() => setShowApollo((v) => !v)}
          placeholder="Paste Apollo API key"
          name="ksenda-apollo-api-key"
        />
        <Caption>
          Get yours at{" "}
          <a
            className="text-[var(--color-accent)] hover:underline"
            href="https://app.apollo.io/#/settings/integrations/api"
            target="_blank"
            rel="noopener noreferrer"
          >
            app.apollo.io → Settings → Integrations → API
          </a>
          .
        </Caption>
      </Field>
      <Field label="Google Gemini API key" required>
        <SecretInput
          value={geminiApiKey}
          onChange={setGeminiApiKey}
          show={showGemini}
          onToggle={() => setShowGemini((v) => !v)}
          placeholder="Paste Gemini API key"
          name="ksenda-gemini-api-key"
        />
        <Caption>
          Get yours at{" "}
          <a
            className="text-[var(--color-accent)] hover:underline"
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google AI Studio → API keys
          </a>
          .
        </Caption>
      </Field>
      <StepFooter
        onBack={onBack}
        canContinue={valid}
        saving={save.saving}
        error={save.error}
      />
    </form>
  );
}

function EmailProviderStep({
  initial,
  hasSmtpPassword,
  onNext,
  onBack,
}: {
  initial: OnboardingState["emailProvider"];
  hasSmtpPassword: boolean;
  onNext: () => void;
  onBack: () => void;
}) {
  const [provider, setProvider] = useState<"" | "gmail" | "outlook" | "custom">(
    (initial.smtpProvider as "gmail" | "outlook" | "custom") || ""
  );
  const [host, setHost] = useState(initial.smtpHost ?? "");
  const [port, setPort] = useState(initial.smtpPort != null ? String(initial.smtpPort) : "");
  const [secure, setSecure] = useState(initial.smtpSecure ?? false);
  const [user, setUser] = useState(initial.smtpUser ?? "");
  const [password, setPassword] = useState(hasSmtpPassword ? PLACEHOLDER_SECRET : "");
  const [showPw, setShowPw] = useState(false);
  const [verifyResult, setVerifyResult] = useState<
    { ok: true } | { ok: false; error: string } | null
  >(null);

  const save = useStepSaver(async () => {
    const payload: Record<string, unknown> = {
      smtpProvider: provider || null,
      smtpHost: provider === "custom" ? host || null : null,
      smtpPort: provider === "custom" && port ? Number(port) : null,
      smtpSecure: provider === "custom" ? secure : null,
      smtpUser: user || null,
    };
    if (password !== PLACEHOLDER_SECRET) {
      payload.smtpPassword = password || null;
    }
    if (!provider) payload.smtpPassword = null;
    const res = await fetch("/api/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Failed to save");
  });

  const testConnection = useMutation({
    mutationFn: async () => {
      await save.run();
      const res = await fetch("/api/users/me/verify-smtp", { method: "POST" });
      return (await res.json()) as { success: boolean; error?: string };
    },
    onSuccess: (r) =>
      setVerifyResult(
        r.success ? { ok: true } : { ok: false, error: r.error || "Verification failed" }
      ),
    onError: (e: any) =>
      setVerifyResult({ ok: false, error: e?.message || "Verification failed" }),
  });

  const passwordProvided = password === PLACEHOLDER_SECRET || password.trim().length > 0;
  const customValid =
    provider !== "custom" || (host.trim().length > 0 && Number(port) > 0);
  const valid = !!provider && user.trim().length > 0 && passwordProvided && customValid;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        save.run().then(() => onNext());
      }}
      className="space-y-6"
    >
      <Field label="Provider" required>
        <div className="overflow-hidden rounded-md border border-[var(--color-line)] divide-y divide-[var(--color-line)]">
          {[
            { id: "gmail" as const, label: "Gmail", detail: "smtp.gmail.com:587 · App Password" },
            { id: "outlook" as const, label: "Outlook", detail: "Personal accounts only" },
            { id: "custom" as const, label: "Custom SMTP", detail: "SendGrid, Postmark, Resend, SES, …" },
          ].map((opt) => {
            const active = provider === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setProvider(opt.id)}
                className={cn(
                  "w-full flex items-baseline justify-between gap-4 px-4 py-3 text-left transition-colors",
                  active ? "bg-[var(--color-accent-soft)]" : "hover:bg-[var(--color-panel)]"
                )}
              >
                <span className="flex items-baseline gap-3">
                  <span
                    className={cn(
                      "inline-block h-1.5 w-1.5 rounded-full shrink-0",
                      active
                        ? "bg-[var(--color-accent)]"
                        : "bg-transparent border border-[var(--color-fg-muted)]"
                    )}
                  />
                  <span className="text-[14px] font-medium text-[var(--color-fg)]">
                    {opt.label}
                  </span>
                </span>
                <span className="font-mono text-[11px] text-[var(--color-fg-muted)] hidden sm:inline">
                  {opt.detail}
                </span>
              </button>
            );
          })}
        </div>
      </Field>

      {provider && <ProviderHelp provider={provider} />}

      {provider === "custom" && (
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-x-4 gap-y-5">
          <Field label="SMTP host" required>
            <Input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="smtp.example.com"
              className="font-mono text-[13px]"
            />
          </Field>
          <Field label="Port" required>
            <Input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="587"
              inputMode="numeric"
              className="font-mono text-[13px]"
            />
          </Field>
          <label className="sm:col-span-2 inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={secure}
              onChange={(e) => setSecure(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--color-accent)]"
            />
            <span className="font-mono text-[12px] text-[var(--color-fg-muted)]">
              Implicit TLS (port 465). Leave off for STARTTLS on 587.
            </span>
          </label>
        </div>
      )}

      {provider && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
          <Field label="SMTP username" required>
            <Input
              type="email"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="you@gmail.com"
              className="font-mono text-[13px]"
            />
          </Field>
          <Field label="App password" required>
            <SecretInput
              value={password}
              onChange={setPassword}
              show={showPw}
              onToggle={() => setShowPw((v) => !v)}
              placeholder="App password"
              name="ksenda-smtp-app-password"
            />
          </Field>
        </div>
      )}

      {provider && (
        <div className="flex items-center gap-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => testConnection.mutate()}
            disabled={!valid || testConnection.isPending}
          >
            {testConnection.isPending ? (
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
              <CheckCircle2 className="h-3 w-3" /> Connected
            </span>
          )}
          {verifyResult && !verifyResult.ok && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-status-error)]">
              <AlertCircle className="h-3 w-3" /> {verifyResult.error}
            </span>
          )}
        </div>
      )}

      <StepFooter
        onBack={onBack}
        canContinue={valid}
        saving={save.saving}
        error={save.error}
      />
    </form>
  );
}

function SenderStep({
  initial,
  fallbackEmail,
  onNext,
  onBack,
}: {
  initial: OnboardingState["sender"];
  fallbackEmail: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const [senderEmail, setSenderEmail] = useState(initial.senderEmail ?? "");
  const [senderName, setSenderName] = useState(initial.senderName ?? "");

  const save = useStepSaver(async () => {
    const res = await fetch("/api/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderEmail: senderEmail.trim() || null,
        senderName: senderName.trim() || null,
      }),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Failed to save");
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.run().then(() => onNext());
      }}
      className="space-y-6"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
        <Field label="Sender email">
          <Input
            type="email"
            value={senderEmail}
            onChange={(e) => setSenderEmail(e.target.value)}
            placeholder={fallbackEmail || "you@acme.com"}
            className="font-mono text-[13px]"
          />
          <Caption>Defaults to your SMTP username if blank.</Caption>
        </Field>
        <Field label="Display name">
          <Input
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            placeholder="Jane @ Acme"
          />
          <Caption>Shows up before the email in the recipient's inbox.</Caption>
        </Field>
      </div>
      <p className="text-[13px] leading-relaxed text-[var(--color-fg-muted)]">
        Leave both blank to send straight from your SMTP login. You can always come back later.
      </p>
      <StepFooter
        onBack={onBack}
        canContinue={true}
        saving={save.saving}
        error={save.error}
        nextLabel="Continue"
      />
    </form>
  );
}

function SignatureStep({
  initial,
  onNext,
  onBack,
}: {
  initial: string | null;
  onNext: () => void;
  onBack: () => void;
}) {
  const [signature, setSignature] = useState(initial ?? "");
  const [preview, setPreview] = useState(false);

  const save = useStepSaver(async () => {
    const res = await fetch("/api/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signature: signature.trim() || null }),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Failed to save");
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.run().then(() => onNext());
      }}
      className="space-y-6"
    >
      <Field
        label="HTML signature"
        actions={
          signature ? (
            <button
              type="button"
              onClick={() => setPreview((v) => !v)}
              className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] inline-flex items-center gap-1"
            >
              {preview ? (
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
        {preview && signature ? (
          <div className="overflow-hidden rounded-md border border-[var(--color-line)]">
            <div className="px-3 py-1.5 bg-[var(--color-panel)] border-b border-[var(--color-line)] font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)]">
              Recipient view (white background)
            </div>
            <div className="bg-white p-4" style={{ color: "#000000" }}>
              <div
                style={{ color: "#000000" }}
                dangerouslySetInnerHTML={{ __html: signature }}
              />
            </div>
          </div>
        ) : (
          <Textarea
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            rows={8}
            placeholder={`<p>Best,<br><strong>Your Name</strong><br>Your Company<br><a href="https://acme.com">acme.com</a></p>`}
            className="font-mono text-[12px]"
          />
        )}
      </Field>
      <p className="text-[13px] leading-relaxed text-[var(--color-fg-muted)]">
        Plain HTML — same syntax Gmail and Outlook accept. You can skip this and add one later.
      </p>
      <StepFooter
        onBack={onBack}
        canContinue={true}
        saving={save.saving}
        error={save.error}
        nextLabel="Continue"
      />
    </form>
  );
}

function TargetTitlesStep({
  hasGeminiKey,
  hasCompanyProfile,
  onNext,
  onBack,
  completing,
}: {
  hasGeminiKey: boolean;
  hasCompanyProfile: boolean;
  onNext: () => void;
  onBack: () => void;
  completing: boolean;
}) {
  const { data: existing, isLoading } = useQuery<{
    titles: Array<{ id: string; title: string; priority: number; isActive: boolean }>;
  }>({
    queryKey: ["onboardingTargetTitles"],
    queryFn: async () => {
      const res = await fetch("/api/target-titles");
      if (!res.ok) throw new Error("Failed to load titles");
      return res.json();
    },
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!existing || hydrated) return;
    const catalogAll = new Set<string>(Object.values(TARGET_TITLE_CATEGORIES).flat());
    const next = new Set<string>();
    const customList: string[] = [];
    // Always start from whatever the user has explicitly saved. Brand-new
    // accounts hit this with `existing.titles.length === 0` and stay empty —
    // the user has to deliberately pick their ICP titles, no defaults.
    for (const t of existing.titles) {
      if (catalogAll.has(t.title)) next.add(t.title);
      else customList.push(t.title);
    }
    setSelected(next);
    setCustom(customList);
    setHydrated(true);
  }, [existing, hydrated]);

  const save = useStepSaver(async () => {
    const ordered: string[] = [];
    // Catalog order first (preserves intentional priority), then custom titles
    // the user typed in.
    for (const cat of Object.keys(TARGET_TITLE_CATEGORIES) as Array<
      keyof typeof TARGET_TITLE_CATEGORIES
    >) {
      for (const t of TARGET_TITLE_CATEGORIES[cat]) {
        if (selected.has(t)) ordered.push(t);
      }
    }
    for (const t of custom) ordered.push(t);

    const res = await fetch("/api/target-titles", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titles: ordered }),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Failed to save");
  });

  const totalSelected = selected.size + custom.length;
  const valid = totalSelected > 0;

  if (isLoading || !hydrated) {
    return (
      <div className="flex items-center gap-3 py-12 text-[var(--color-fg-muted)] font-mono text-[12px]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading catalog…
      </div>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        await save.run();
        onNext();
      }}
      className="space-y-6"
    >
      <CategorizedTitlePicker
        selected={selected}
        onChange={setSelected}
        customTitles={custom}
        onCustomTitlesChange={setCustom}
        enableAiSuggest
        aiSuggestDisabledReason={
          !hasGeminiKey
            ? "Add your Gemini API key in step 02 to unlock AI suggestions."
            : !hasCompanyProfile
            ? "Complete your company profile in step 01 so Gemini knows whose ICP to model."
            : undefined
        }
      />
      <p className="text-[13px] leading-relaxed text-[var(--color-fg-muted)]">
        Apollo will only return contacts whose title matches this list. Priority
        follows order — you can reshuffle anytime from Settings.
      </p>
      <StepFooter
        onBack={onBack}
        canContinue={valid}
        saving={save.saving || completing}
        error={save.error}
        nextLabel={completing ? "Finishing" : "Finish setup"}
        nextIcon={completing ? null : <Sparkles className="h-3.5 w-3.5" />}
      />
    </form>
  );
}

function DoneStep() {
  const router = useRouter();
  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-6 text-[14px] leading-relaxed text-[var(--color-fg)]">
        <p className="font-medium">
          Everything's connected. Your dashboard is ready.
        </p>
        <p className="mt-2 text-[var(--color-fg-muted)]">
          You can tweak any of these later from Settings — the same fields live there.
        </p>
      </div>
      <Button
        size="lg"
        onClick={() => {
          router.push("/");
          router.refresh();
        }}
      >
        Open dashboard
        <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function useStepSaver(fn: () => Promise<void>) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setSaving(true);
    setError(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message || "Save failed");
      throw e;
    } finally {
      setSaving(false);
    }
  };
  return { run, saving, error };
}

function Field({
  label,
  required,
  actions,
  children,
}: {
  label: string;
  required?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label>
          {label}
          {required && <span className="text-[var(--color-fg-subtle)]"> *</span>}
        </Label>
        {actions}
      </div>
      {children}
    </div>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
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
  /** Optional field name. Used to give password managers a unique-enough
   *  hint that this is NOT a user account password (e.g. "apollo-api-key"
   *  vs "smtp-app-password"). */
  name?: string;
}) {
  return (
    <div className="relative flex items-center">
      {/*
       * Browsers and password managers see `type="password"` and try to
       * autofill the user's saved login password — which is wrong for API
       * keys and SMTP app passwords. We defuse that with:
       *   - autoComplete="new-password" (Chrome/Safari/Firefox respect this)
       *   - data-1p-ignore / data-lpignore / data-bwignore (1Password,
       *     LastPass, Bitwarden vendor hints)
       *   - a unique `name` per field so managers don't cross-fill
       */}
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-10 font-mono text-[13px]"
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
        className="absolute right-0 top-1/2 -translate-y-1/2 p-2 text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
        aria-label={show ? "Hide" : "Show"}
      >
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function StepFooter({
  onBack,
  canContinue,
  saving,
  error,
  nextLabel = "Continue",
  nextIcon,
}: {
  onBack: () => void;
  canContinue: boolean;
  saving: boolean;
  error: string | null;
  nextLabel?: string;
  nextIcon?: React.ReactNode | null;
}) {
  return (
    <div className="border-t border-[var(--color-line-soft)] pt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      <button
        type="button"
        onClick={onBack}
        className="font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] inline-flex items-center gap-1.5 self-start"
      >
        <ArrowLeft className="h-3 w-3" />
        Back
      </button>
      <div className="flex items-center gap-3 sm:gap-4 sm:justify-end">
        {error && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-status-error)]">
            <AlertCircle className="h-3 w-3" />
            {error}
          </span>
        )}
        <Button type="submit" size="lg" disabled={!canContinue || saving}>
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Saving
            </>
          ) : (
            <>
              {nextLabel}
              {nextIcon === undefined ? <ArrowRight className="h-3.5 w-3.5" /> : nextIcon}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
