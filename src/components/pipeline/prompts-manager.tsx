"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles, Mail, Linkedin } from "lucide-react";
import {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_LINKEDIN_INITIAL_PROMPT,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import { AiPromptGeneratorDialog } from "@/components/pipeline/ai-prompt-generator-dialog";

type Platform = "email" | "linkedin";

/**
 * Manage all four prompt slots on each platform (Email / LinkedIn) — initial
 * + 3 follow-ups per platform. Tabs switch the active platform; each tab
 * shares the same 4-section editor layout.
 */
export function PromptsManager() {
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [platform, setPlatform] = useState<Platform>("email");
  // `hydrated` flips to true only AFTER the initial localStorage read has
  // settled. The write effect below is gated on it so the default "email"
  // from useState doesn't clobber a previously saved "linkedin" during the
  // brief window between mount and the read effect's re-render. Without this
  // guard, tabbing away and back during that micro-window would silently
  // lose the user's platform selection.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("promptsActivePlatform");
    if (saved === "linkedin" || saved === "email") {
      setPlatform(saved);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("promptsActivePlatform", platform);
  }, [platform, hydrated]);

  const FOLLOWUP_TITLES: Record<
    Platform,
    [string, string, string]
  > = {
    email: [
      "Day 3 · Quick follow-up",
      "Day 7 · Value-add",
      "Day 14 · Break-up",
    ],
    linkedin: [
      "Day 3 · LinkedIn nudge",
      "Day 7 · LinkedIn value-add",
      "Day 14 · LinkedIn break-up",
    ],
  };

  return (
    <div className="max-w-[920px] space-y-12">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 border-b border-[var(--color-line-soft)] pb-5">
        <div className="max-w-[58ch]">
          <h1 className="text-lg font-semibold tracking-tight text-[var(--color-fg)]">
            Prompts
          </h1>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-fg-muted)]">
            One initial prompt plus three follow-up prompts, per channel. Pick
            a tab to edit email or LinkedIn. The generator can draft a fresh
            suite for the active channel from your company website.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setAiDialogOpen(true)}
          className="shrink-0"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Generate with AI
        </Button>
      </div>

      <div
        role="tablist"
        aria-label="Platform"
        className="inline-flex w-fit overflow-hidden rounded-md border border-[var(--color-line)]"
      >
        {(
          [
            { value: "email", label: "Email", Icon: Mail },
            { value: "linkedin", label: "LinkedIn", Icon: Linkedin },
          ] as const
        ).map((opt) => {
          const isActive = platform === opt.value;
          const Icon = opt.Icon;
          return (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setPlatform(opt.value)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3.5 py-2 font-mono text-[12px] leading-none transition-colors border-l border-[var(--color-line)] first:border-l-0",
                isActive
                  ? "bg-[var(--color-accent)]/12 text-[var(--color-accent)]"
                  : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-panel)]"
              )}
            >
              <Icon className="h-3 w-3" />
              {opt.label}
            </button>
          );
        })}
      </div>

      <div className="space-y-16">
        <InitialPromptSection platform={platform} />
        <FollowUpPromptSection
          platform={platform}
          step={1}
          defaultDay={3}
          title={FOLLOWUP_TITLES[platform][0]}
        />
        <FollowUpPromptSection
          platform={platform}
          step={2}
          defaultDay={7}
          title={FOLLOWUP_TITLES[platform][1]}
        />
        <FollowUpPromptSection
          platform={platform}
          step={3}
          defaultDay={14}
          title={FOLLOWUP_TITLES[platform][2]}
        />
      </div>

      <AiPromptGeneratorDialog
        open={aiDialogOpen}
        onOpenChange={setAiDialogOpen}
        platform={platform}
      />
    </div>
  );
}

function defaultInitialFor(platform: Platform): string {
  return platform === "linkedin"
    ? DEFAULT_LINKEDIN_INITIAL_PROMPT
    : DEFAULT_SYSTEM_PROMPT;
}

function InitialPromptSection({ platform }: { platform: Platform }) {
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["active-prompt", platform],
    queryFn: async () => {
      const res = await fetch(`/api/prompts/active?platform=${platform}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<{ prompt: { content: string } | null }>;
    },
    staleTime: 0,
  });

  // Reset editor when switching platforms — the freshly-loaded content for
  // the new platform should win.
  useEffect(() => {
    setPrompt(null);
  }, [platform]);

  useEffect(() => {
    if (data === undefined) return;
    if (prompt !== null) return;
    setPrompt(data.prompt?.content || defaultInitialFor(platform));
  }, [data, prompt, platform]);

  const saveMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(`/api/prompts/active?platform=${platform}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active-prompt", platform] });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2400);
    },
  });

  const baseline = data?.prompt?.content || defaultInitialFor(platform);
  const dirty = prompt !== null && prompt !== baseline;

  if (isLoading || prompt === null) {
    return (
      <div className="flex items-center gap-3 text-[var(--color-fg-muted)] font-mono text-[12px]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading prompt...
      </div>
    );
  }

  return (
    <section>
      <SectionHeader
        eyebrow="01"
        title={platform === "linkedin" ? "Initial LinkedIn message" : "Initial cold email"}
        meta={`${prompt.length.toLocaleString()} chars`}
      />
      {platform === "linkedin" ? (
        <p className="text-[13px] leading-relaxed text-[var(--color-fg-muted)] mb-6 max-w-[68ch]">
          Output JSON with a single <Code>message</Code> field — no subject.
          Placeholders: <Code>{"{{SENDER_COMPANY_NAME}}"}</Code>,{" "}
          <Code>{"{{SENDER_COMPANY_WEBSITE}}"}</Code>, <Code>{"{{COMPANY_NAME}}"}</Code>,{" "}
          <Code>{"{{COMPANY_WEBSITE_URL}}"}</Code>, <Code>{"{{CONTACT_FIRST_NAME}}"}</Code>,{" "}
          <Code>{"{{SENDER_NAME}}"}</Code>.
        </p>
      ) : (
        <p className="text-[13px] leading-relaxed text-[var(--color-fg-muted)] mb-6 max-w-[68ch]">
          Output JSON with <Code>subject</Code> and <Code>email_body</Code>.
          Placeholders: <Code>{"{{SENDER_COMPANY_NAME}}"}</Code>,{" "}
          <Code>{"{{SENDER_COMPANY_WEBSITE}}"}</Code>, <Code>{"{{COMPANY_NAME}}"}</Code>,{" "}
          <Code>{"{{COMPANY_WEBSITE_URL}}"}</Code>, <Code>{"{{CONTACT_FIRST_NAME}}"}</Code>,{" "}
          <Code>{"{{SENDER_NAME}}"}</Code>.
        </p>
      )}
      <PromptTextarea value={prompt} onChange={setPrompt} />
      <SaveBar
        dirty={dirty}
        saving={saveMutation.isPending}
        savedFlash={savedFlash}
        onSave={() => saveMutation.mutate(prompt)}
        onReset={() => setPrompt(defaultInitialFor(platform))}
      />
    </section>
  );
}

interface FollowUpPrompt {
  id: string;
  step: number;
  dayOffset: number;
  name: string;
  content: string;
  isActive: boolean;
  platform: string;
}

function FollowUpPromptSection({
  platform,
  step,
  defaultDay,
  title,
}: {
  platform: Platform;
  step: number;
  defaultDay: number;
  title: string;
}) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState<string | null>(null);
  const [dayOffset, setDayOffset] = useState<number>(defaultDay);
  const [savedFlash, setSavedFlash] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["followup-prompts", platform],
    queryFn: async () => {
      const res = await fetch(`/api/followups/prompts?platform=${platform}`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ prompts: FollowUpPrompt[] }>;
    },
    staleTime: 0,
  });

  // Reset when platform changes so the editor reloads cleanly.
  useEffect(() => {
    setContent(null);
  }, [platform]);

  const current = data?.prompts.find((p) => p.step === step);

  useEffect(() => {
    if (current && content === null) {
      setContent(current.content);
      setDayOffset(current.dayOffset);
    }
  }, [current, content]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/followups/prompts/${step}?platform=${platform}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, dayOffset }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["followup-prompts", platform] });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2400);
    },
  });

  const dirty =
    content !== null &&
    current !== undefined &&
    (content !== current.content || dayOffset !== current.dayOffset);

  if (isLoading || content === null || !current) {
    return (
      <div className="flex items-center gap-3 text-[var(--color-fg-muted)] font-mono text-[12px]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading follow-up step {step}...
      </div>
    );
  }

  return (
    <section>
      <SectionHeader
        eyebrow={`0${step + 1}`}
        title={title}
        meta={`${content.length.toLocaleString()} chars`}
      />
      <div className="flex items-baseline gap-4 mb-4">
        <Label>Send after</Label>
        <Input
          type="number"
          value={dayOffset}
          onChange={(e) => setDayOffset(parseInt(e.target.value, 10) || defaultDay)}
          className="w-20 font-mono text-[13px]"
          min={1}
          max={60}
        />
        <span className="font-mono text-[12px] text-[var(--color-fg-muted)]">
          days after previous step
        </span>
      </div>
      {platform === "linkedin" ? (
        <p className="text-[13px] leading-relaxed text-[var(--color-fg-muted)] mb-6 max-w-[68ch]">
          Output JSON with a single <Code>message</Code> field (no subject).
          Placeholders include <Code>{"{{ORIGINAL_BODY}}"}</Code> for
          referencing the previous LinkedIn DM.
        </p>
      ) : (
        <p className="text-[13px] leading-relaxed text-[var(--color-fg-muted)] mb-6 max-w-[68ch]">
          Same placeholders as the initial prompt, PLUS{" "}
          <Code>{"{{ORIGINAL_SUBJECT}}"}</Code> and <Code>{"{{ORIGINAL_BODY}}"}</Code> for
          referencing the previous email. Output JSON with{" "}
          <Code>subject</Code> (already prefixed with “Re:” for Gmail threading)
          and <Code>email_body</Code>.
        </p>
      )}
      <PromptTextarea value={content} onChange={setContent} />
      <SaveBar
        dirty={dirty}
        saving={saveMutation.isPending}
        savedFlash={savedFlash}
        onSave={() => saveMutation.mutate()}
      />
    </section>
  );
}

function PromptTextarea({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "block w-full min-h-[44vh] px-4 py-3",
        "bg-[var(--color-panel)] text-[var(--color-fg)]",
        "border border-[var(--color-line)]",
        "font-mono text-[13px] leading-[1.6]",
        "transition-colors duration-150",
        "focus:outline-none focus:border-[var(--color-accent)]",
        "resize-y"
      )}
      spellCheck={false}
    />
  );
}

function SaveBar({
  dirty,
  saving,
  savedFlash,
  onSave,
  onReset,
}: {
  dirty: boolean;
  saving: boolean;
  savedFlash: boolean;
  onSave: () => void;
  onReset?: () => void;
}) {
  return (
    <div className="flex items-center justify-between pt-4">
      <div>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            disabled={saving}
            className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors disabled:opacity-50"
          >
            Reset to default
          </button>
        )}
      </div>
      <div className="flex items-center gap-4">
        {savedFlash ? (
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-accent)]">
            Saved
          </span>
        ) : dirty ? (
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)]">
            Unsaved
          </span>
        ) : null}
        <Button onClick={onSave} disabled={saving || !dirty}>
          {saving ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving
            </>
          ) : (
            "Save prompt"
          )}
        </Button>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  meta,
}: {
  eyebrow?: string;
  title: string;
  meta?: string;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-[var(--color-line-soft)] pb-3 mb-5">
      <div>
        <h2 className="text-lg font-semibold leading-tight tracking-tight text-[var(--color-fg)]">
          {title}
        </h2>
      </div>
      {meta && (
        <span className="text-xs tabular-nums text-muted-foreground">
          {meta}
        </span>
      )}
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-xs text-[var(--color-fg)] bg-[var(--color-panel)] px-1 py-0.5 rounded">
      {children}
    </code>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-muted)]">
      {children}
    </label>
  );
}
