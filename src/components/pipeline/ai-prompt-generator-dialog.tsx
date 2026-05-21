"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sparkles,
  Loader2,
  AlertCircle,
  RotateCw,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SlotKey = "initial" | "day3" | "day7" | "day14";
type Platform = "email" | "linkedin";

const EMAIL_SLOTS: Array<{ key: SlotKey; label: string; eyebrow: string }> = [
  { key: "initial", label: "Initial cold email", eyebrow: "01" },
  { key: "day3", label: "Day 3 · Quick follow-up", eyebrow: "02" },
  { key: "day7", label: "Day 7 · Value-add", eyebrow: "03" },
  { key: "day14", label: "Day 14 · Break-up", eyebrow: "04" },
];

const LINKEDIN_SLOTS: Array<{ key: SlotKey; label: string; eyebrow: string }> = [
  { key: "initial", label: "Initial LinkedIn message", eyebrow: "01" },
  { key: "day3", label: "Day 3 · LinkedIn nudge", eyebrow: "02" },
  { key: "day7", label: "Day 7 · LinkedIn value-add", eyebrow: "03" },
  { key: "day14", label: "Day 14 · LinkedIn break-up", eyebrow: "04" },
];

function slotsFor(platform: Platform) {
  return platform === "linkedin" ? LINKEDIN_SLOTS : EMAIL_SLOTS;
}

interface GenerateResponse {
  understanding: string;
  suite: Record<SlotKey, string>;
  blocks?: { modules?: Array<{ name: string }> };
  trace?: { fetchedUrls?: string[]; searchQueries?: string[] };
}

/**
 * Smart-Setup-style modal for the Prompts page: Gemini reads the user's
 * company website + recent news, drafts the full 4-prompt suite, and the
 * user reviews + edits each slot before saving. Nothing persists until the
 * user clicks "Save selected".
 */
export function AiPromptGeneratorDialog({
  open,
  onOpenChange,
  platform = "email",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  platform?: Platform;
}) {
  const queryClient = useQueryClient();
  const SLOTS = slotsFor(platform);
  const [activeSlot, setActiveSlot] = useState<SlotKey>("initial");
  const [draft, setDraft] = useState<Record<SlotKey, string> | null>(null);
  const [selected, setSelected] = useState<Set<SlotKey>>(
    new Set(["initial", "day3", "day7", "day14"])
  );
  const [understanding, setUnderstanding] = useState<string | null>(null);
  const [moduleCount, setModuleCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset on close so a re-open starts fresh.
  useEffect(() => {
    if (open) return;
    setDraft(null);
    setUnderstanding(null);
    setModuleCount(null);
    setError(null);
    setActiveSlot("initial");
    setSelected(new Set(["initial", "day3", "day7", "day14"]));
  }, [open]);

  const generateMutation = useMutation({
    mutationFn: async () => {
      // 3-minute ceiling. Gemini-3.1-flash-lite with urlContext + googleSearch
      // typically returns in 8-20s for prompt-suite extraction; anything past
      // 180s is a stuck call.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180_000);
      try {
        const res = await fetch("/api/prompts/ai-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platform }),
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Generation failed");
        return data as GenerateResponse;
      } finally {
        clearTimeout(timeoutId);
      }
    },
    onSuccess: (data) => {
      setDraft(data.suite);
      setUnderstanding(data.understanding || null);
      setModuleCount(data.blocks?.modules?.length ?? null);
      setError(null);
    },
    onError: (e: any) => {
      if (e?.name === "AbortError") {
        setError("Generation timed out after 3 minutes. Check that your Gemini API key is valid and try again.");
      } else {
        setError(e?.message || "Generation failed");
      }
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("Nothing to save");
      const payload: Record<string, string> = { platform };
      for (const slot of SLOTS) {
        if (selected.has(slot.key) && draft[slot.key]) {
          payload[slot.key] = draft[slot.key];
        }
      }
      if (Object.keys(payload).length <= 1) {
        throw new Error("Pick at least one slot to save.");
      }
      const res = await fetch("/api/prompts/ai-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      return data as { applied: string[] };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active-prompt", platform] });
      queryClient.invalidateQueries({ queryKey: ["followup-prompts", platform] });
      onOpenChange(false);
    },
    onError: (e: any) => setError(e?.message || "Save failed"),
  });

  const runGenerate = () => {
    setError(null);
    setDraft(null);
    setUnderstanding(null);
    setModuleCount(null);
    generateMutation.mutate();
  };

  const toggleSlot = (key: SlotKey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setSlotContent = (key: SlotKey, content: string) => {
    setDraft((prev) => (prev ? { ...prev, [key]: content } : prev));
  };

  const loading = generateMutation.isPending;
  const hasDraft = !!draft;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] flex flex-col gap-0 p-0 bg-[var(--color-panel)] border-[var(--color-line)]">
        <DialogHeader className="px-6 py-5 border-b border-[var(--color-line-soft)]">
          <DialogTitle className="text-[var(--color-fg)] flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--color-accent)]" />
            Generate {platform === "linkedin" ? "LinkedIn" : "email"} prompt suite with AI
          </DialogTitle>
          <DialogDescription className="text-[var(--color-fg-muted)]">
            Gemini reads your company website and recent news, then drafts the
            full 4-prompt outbound suite tailored to your product
            {platform === "linkedin"
              ? " — LinkedIn-shaped, short, no subject, single-message output."
              : "."}{" "}
            Review and edit each prompt before saving — nothing persists until you click Save.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col">
          {!hasDraft && !loading && (
            <IntroPane error={error} onStart={runGenerate} />
          )}

          {loading && <LoadingPane />}

          {hasDraft && draft && (
            <ReviewPane
              slots={SLOTS}
              draft={draft}
              activeSlot={activeSlot}
              onActiveSlotChange={setActiveSlot}
              selected={selected}
              onToggleSlot={toggleSlot}
              onContentChange={setSlotContent}
              understanding={understanding}
              moduleCount={moduleCount}
              onRegenerate={runGenerate}
              regenerating={false}
            />
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-[var(--color-line-soft)] flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between sm:space-x-0 bg-[var(--color-panel)]">
          <div>
            {error && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-status-error)]">
                <AlertCircle className="h-3 w-3" />
                {error}
              </span>
            )}
            {!error && hasDraft && (
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)]">
                {selected.size} of 4 selected
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={applyMutation.isPending}
            >
              Cancel
            </Button>
            {hasDraft && (
              <Button
                variant="outline"
                onClick={runGenerate}
                disabled={applyMutation.isPending || loading}
              >
                <RotateCw className="h-3.5 w-3.5" />
                Regenerate
              </Button>
            )}
            {hasDraft && (
              <Button
                onClick={() => {
                  setError(null);
                  applyMutation.mutate();
                }}
                disabled={applyMutation.isPending || selected.size === 0}
              >
                {applyMutation.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Saving
                  </>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Save selected
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IntroPane({ error, onStart }: { error: string | null; onStart: () => void }) {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <div className="max-w-xl mx-auto space-y-5">
        <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-canvas)]/40 p-5 space-y-3">
          <p className="text-[14px] leading-relaxed text-[var(--color-fg)]">
            Before generating, AI will:
          </p>
          <ul className="space-y-2 text-[13px] text-[var(--color-fg-muted)]">
            {[
              "Fetch your company website via url-context",
              "Search recent news about your company",
              "Extract 5-8 product modules with named tools",
              "Build credibility + offer decision matrices specific to your ICP",
              "Build a Day 7 value-add menu of 2026 industry observations",
              "Assemble all four prompts using the production-grade template",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <Check className="h-3.5 w-3.5 text-[var(--color-status-success)] shrink-0 mt-0.5" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <p className="text-[12.5px] text-[var(--color-fg-subtle)] leading-relaxed">
            Usually 8-20 seconds. Your existing prompts stay untouched until you Save.
          </p>
        </div>
        {error && (
          <div className="rounded-md border border-[var(--color-status-error)]/30 bg-[var(--color-status-error)]/[0.08] p-3">
            <p className="inline-flex items-start gap-1.5 text-[12.5px] text-[var(--color-fg)]">
              <AlertCircle className="h-3 w-3 text-[var(--color-status-error)] mt-0.5 shrink-0" />
              <span>{error}</span>
            </p>
          </div>
        )}
        <div className="flex justify-center pt-2">
          <Button size="lg" onClick={onStart}>
            <Sparkles className="h-3.5 w-3.5" />
            Generate suite
          </Button>
        </div>
      </div>
    </div>
  );
}

function LoadingPane() {
  return (
    <div className="flex-1 flex items-center justify-center px-6 py-12">
      <div className="max-w-md text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-accent-soft)] mb-4">
          <Loader2 className="h-6 w-6 text-[var(--color-accent)] animate-spin" />
        </div>
        <p className="text-[14px] font-medium text-[var(--color-fg)]">
          Reading your site + recent news…
        </p>
        <p className="mt-2 text-[12.5px] text-[var(--color-fg-muted)] leading-relaxed">
          Usually 8-20 seconds. Building modules, matrices, and the value-add menu.
        </p>
      </div>
    </div>
  );
}

function ReviewPane({
  slots,
  draft,
  activeSlot,
  onActiveSlotChange,
  selected,
  onToggleSlot,
  onContentChange,
  understanding,
  moduleCount,
  onRegenerate,
  regenerating,
}: {
  slots: Array<{ key: SlotKey; label: string; eyebrow: string }>;
  draft: Record<SlotKey, string>;
  activeSlot: SlotKey;
  onActiveSlotChange: (k: SlotKey) => void;
  selected: Set<SlotKey>;
  onToggleSlot: (k: SlotKey) => void;
  onContentChange: (k: SlotKey, v: string) => void;
  understanding: string | null;
  moduleCount: number | null;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  void onRegenerate;
  void regenerating;
  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {understanding && (
        <div className="px-6 py-3 border-b border-[var(--color-line-soft)] bg-[var(--color-canvas)]/40">
          <div className="font-mono text-[10px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)] mb-1">
            What AI read about your company
            {moduleCount != null && (
              <span className="ml-2 text-[var(--color-fg-muted)]">
                · {moduleCount} modules extracted
              </span>
            )}
          </div>
          <p className="text-[13px] leading-relaxed text-[var(--color-fg)]">{understanding}</p>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Tabs — each row has TWO interactive elements side-by-side: the
            Checkbox (controls whether this slot will be saved) and the
            tab-switcher button (changes which prompt is shown in the editor).
            They live as siblings under a div, not nested under a single
            button — Radix's Checkbox renders a <button> internally, so
            wrapping it in another <button> is invalid HTML. */}
        <nav className="w-56 shrink-0 border-r border-[var(--color-line-soft)] overflow-y-auto py-2">
          {slots.map((slot) => {
            const isActive = slot.key === activeSlot;
            const isChecked = selected.has(slot.key);
            const charCount = draft[slot.key]?.length ?? 0;
            return (
              <div
                key={slot.key}
                className={cn(
                  "flex items-start gap-3 px-4 py-3 border-l-2 transition-colors",
                  isActive
                    ? "border-l-[var(--color-accent)] bg-[var(--color-accent-soft)]/30"
                    : "border-l-transparent hover:bg-[var(--color-raised)]/40"
                )}
              >
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={() => onToggleSlot(slot.key)}
                  className="mt-0.5 shrink-0"
                  aria-label={`Include ${slot.label} when saving`}
                />
                <button
                  type="button"
                  onClick={() => onActiveSlotChange(slot.key)}
                  className="min-w-0 flex-1 text-left"
                  aria-label={`View ${slot.label} prompt`}
                  aria-current={isActive ? "true" : undefined}
                >
                  <div className="font-mono text-[10px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)] tabular-nums">
                    {slot.eyebrow}
                  </div>
                  <div className="text-[13px] font-medium text-[var(--color-fg)] mt-0.5 leading-tight">
                    {slot.label}
                  </div>
                  <div className="font-mono text-[10.5px] text-[var(--color-fg-subtle)] tabular-nums mt-1">
                    {charCount.toLocaleString()} chars
                  </div>
                </button>
              </div>
            );
          })}
        </nav>

        {/* Editor */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <textarea
            value={draft[activeSlot] || ""}
            onChange={(e) => onContentChange(activeSlot, e.target.value)}
            className={cn(
              "flex-1 w-full px-5 py-4 resize-none",
              "bg-[var(--color-canvas)] text-[var(--color-fg)]",
              "font-mono text-[12.5px] leading-[1.55]",
              "focus:outline-none"
            )}
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
}
