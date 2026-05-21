"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles,
  Loader2,
  Check,
  X,
  AlertCircle,
  Calendar,
  ChevronRight,
  Building2,
  User as UserIcon,
  Mail,
  Linkedin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

type Kind = "companies" | "people";
type AiFilter = "any" | "no_ai" | "has_ai";
type Channel = "email" | "linkedin";
type ChannelChoice = "email" | "linkedin" | "both";

interface ProposedRecipe {
  name: string;
  description: string;
  kind: Kind;
  defaultDailyCap: number;
  filters: Record<string, unknown>;
  aiFilter: AiFilter;
  channel: Channel;
  rationale?: string;
}

interface SavedRecipeMin {
  id: string;
  code: string;
  name: string;
}

type Stage = "intro" | "loading" | "review" | "cadence" | "filling" | "done";
type Cadence = "daily" | "alt" | "light";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Smart Setup — one-button AI-driven setup. Walks the user through:
 *   intro → loading (Gemini reads their site) → review proposed recipes
 *   → pick cadence + start date → calendar fills → done.
 *
 * Designed for non-tech users: short copy, big buttons, clear progress
 * dots, ability to back out at any stage without losing work (the
 * recipes are only persisted at the end of the review step).
 */
export function SmartSetupWizard({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<Stage>("intro");
  const [channels, setChannels] = useState<ChannelChoice>("email");
  const [companyUnderstanding, setCompanyUnderstanding] = useState<string>("");
  const [proposals, setProposals] = useState<ProposedRecipe[]>([]);
  const [keepIndices, setKeepIndices] = useState<Set<number>>(new Set());
  const [savedRecipes, setSavedRecipes] = useState<SavedRecipeMin[]>([]);
  const [cadence, setCadence] = useState<Cadence>("daily");
  const [startDate, setStartDate] = useState<string>(() =>
    toDateInput(new Date())
  );
  const [fillResult, setFillResult] = useState<{
    scheduledCount: number;
    skippedCount: number;
    firstScheduledDate: string;
    lastScheduledDate: string;
    filledChannels?: Array<"email" | "linkedin">;
    preservedOtherChannelDays?: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ESC closes — but only on safe stages (not mid-network call).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (stage === "loading" || stage === "filling") return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, stage, onClose]);

  const proposeMutation = useMutation({
    mutationFn: async () => {
      // When the user picks "both", we fire two parallel calls (one per
      // platform) so the LinkedIn prompt's persona/cap guidance applies
      // cleanly to its recipes and the email guidance to its own.
      // Concatenate the proposal lists; the email response's
      // companyUnderstanding seeds the review header (the LinkedIn pass
      // will produce a near-identical understanding from the same site).
      const platforms: Channel[] =
        channels === "both" ? ["email", "linkedin"] : [channels];

      const responses = await Promise.all(
        platforms.map(async (p) => {
          const res = await fetch("/api/automation/ai-setup/propose-recipes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ platform: p }),
          });
          const data = await res.json();
          if (!res.ok)
            throw new Error(data.error || "Could not propose recipes");
          return data as {
            companyUnderstanding: string;
            recipes: ProposedRecipe[];
          };
        })
      );

      return {
        companyUnderstanding: responses[0]?.companyUnderstanding ?? "",
        recipes: responses.flatMap((r) => r.recipes),
      };
    },
    onSuccess: (data) => {
      setCompanyUnderstanding(data.companyUnderstanding || "");
      setProposals(data.recipes);
      // Default: keep them all checked
      setKeepIndices(new Set(data.recipes.map((_, i) => i)));
      setStage("review");
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : "Unknown error");
      setStage("intro");
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const kept = proposals.filter((_, i) => keepIndices.has(i));
      const res = await fetch("/api/automation/ai-setup/save-recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipes: kept }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save recipes");
      return data as { created: SavedRecipeMin[] };
    },
    onSuccess: (data) => {
      setSavedRecipes(data.created);
      queryClient.invalidateQueries({ queryKey: ["recipes"] });
      setStage("cadence");
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : "Unknown error");
    },
  });

  const fillMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/automation/ai-setup/auto-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate,
          cadence,
          recipeIds: savedRecipes.map((r) => r.id),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fill calendar");
      return data as {
        scheduledCount: number;
        skippedCount: number;
        firstScheduledDate: string;
        lastScheduledDate: string;
        filledChannels?: Array<"email" | "linkedin">;
        preservedOtherChannelDays?: number;
      };
    },
    onSuccess: (data) => {
      setFillResult(data);
      queryClient.invalidateQueries({ queryKey: ["campaign-schedule"] });
      setStage("done");
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : "Unknown error");
      setStage("cadence");
    },
  });

  if (!open) return null;

  const stageIndex: Record<Stage, number> = {
    intro: 0,
    loading: 1,
    review: 1,
    cadence: 2,
    filling: 2,
    done: 3,
  };
  const stepNum = stageIndex[stage];

  return (
    <>
      <div
        onClick={() => {
          if (stage !== "loading" && stage !== "filling") onClose();
        }}
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Smart Setup"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
      >
        <div
          className={cn(
            "pointer-events-auto w-full max-w-2xl",
            "rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] shadow-2xl",
            "flex flex-col max-h-[90dvh] overflow-hidden"
          )}
        >
          {/* Header — progress dots + close */}
          <div className="px-6 py-4 border-b border-[var(--color-line-soft)] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Sparkles className="h-4 w-4 text-[var(--color-accent)]" />
              <span className="text-sm font-semibold tracking-tight text-[var(--color-fg)]">
                Smart Setup
              </span>
              <StepDots active={stepNum} total={4} />
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={stage === "loading" || stage === "filling"}
              className="inline-flex items-center justify-center h-8 w-8 rounded-md text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-raised)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {stage === "intro" && (
              <IntroStage
                error={error}
                channels={channels}
                onChannelsChange={setChannels}
                onStart={() => {
                  setError(null);
                  setStage("loading");
                  proposeMutation.mutate();
                }}
              />
            )}
            {stage === "loading" && <LoadingStage />}
            {stage === "review" && (
              <ReviewStage
                companyUnderstanding={companyUnderstanding}
                proposals={proposals}
                keepIndices={keepIndices}
                onToggle={(idx) => {
                  setKeepIndices((prev) => {
                    const next = new Set(prev);
                    if (next.has(idx)) next.delete(idx);
                    else next.add(idx);
                    return next;
                  });
                }}
                error={error}
              />
            )}
            {stage === "cadence" && (
              <CadenceStage
                cadence={cadence}
                onCadenceChange={setCadence}
                startDate={startDate}
                onStartDateChange={setStartDate}
                savedCount={savedRecipes.length}
                error={error}
              />
            )}
            {stage === "filling" && <FillingStage />}
            {stage === "done" && fillResult && (
              <DoneStage
                savedCount={savedRecipes.length}
                fillResult={fillResult}
                cadence={cadence}
              />
            )}
          </div>

          {/* Footer — stage-appropriate buttons */}
          <div className="px-6 py-4 border-t border-[var(--color-line-soft)] flex items-center justify-between gap-3 bg-[var(--color-panel)]">
            <div className="text-[11px] text-[var(--color-fg-subtle)]">
              {stage === "intro" && "Step 1 of 4 — Get started"}
              {stage === "loading" && "Step 2 of 4 — Reading your site"}
              {stage === "review" && "Step 2 of 4 — Review proposals"}
              {stage === "cadence" && "Step 3 of 4 — Pick cadence"}
              {stage === "filling" && "Step 3 of 4 — Filling calendar"}
              {stage === "done" && "Step 4 of 4 — All done"}
            </div>
            <div className="flex items-center gap-2">
              {stage === "intro" && (
                <Button
                  size="sm"
                  onClick={() => {
                    setError(null);
                    setStage("loading");
                    proposeMutation.mutate();
                  }}
                >
                  <Sparkles className="h-4 w-4" />
                  Start setup
                </Button>
              )}
              {stage === "review" && (
                <>
                  <Button variant="outline" size="sm" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => saveMutation.mutate()}
                    disabled={
                      saveMutation.isPending || keepIndices.size === 0
                    }
                  >
                    {saveMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Saving…
                      </>
                    ) : (
                      <>
                        Save {keepIndices.size} recipe
                        {keepIndices.size === 1 ? "" : "s"}
                        <ChevronRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </>
              )}
              {stage === "cadence" && (
                <>
                  <Button variant="outline" size="sm" onClick={onClose}>
                    Skip auto-fill
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setError(null);
                      setStage("filling");
                      fillMutation.mutate();
                    }}
                    disabled={fillMutation.isPending}
                  >
                    {fillMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Filling…
                      </>
                    ) : (
                      <>
                        <Calendar className="h-4 w-4" />
                        Auto-fill calendar
                      </>
                    )}
                  </Button>
                </>
              )}
              {stage === "done" && (
                <Button size="sm" onClick={onClose}>
                  View calendar
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Stage components

function IntroStage({
  error,
  channels,
  onChannelsChange,
  onStart,
}: {
  error: string | null;
  channels: ChannelChoice;
  onChannelsChange: (c: ChannelChoice) => void;
  onStart: () => void;
}) {
  return (
    <div className="px-8 py-10">
      <div className="max-w-md mx-auto text-center">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-accent-soft)] mb-5">
          <Sparkles className="h-7 w-7 text-[var(--color-accent)]" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-[var(--color-fg)]">
          Let AI set up your campaign
        </h2>
        <p className="mt-2 text-sm text-[var(--color-fg-muted)] leading-relaxed">
          We&apos;ll read your company website, propose targeting recipes that
          fit what you sell, and lay them out across the next 30 days. You
          stay in control — review before saving, edit anything you want.
        </p>

        {/* Channel picker — drives the prompt + the calendar layout */}
        <div className="mt-7 text-left">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)] mb-2">
            Which channel(s) should the recipes drive?
          </div>
          <div
            role="radiogroup"
            aria-label="Outreach channel"
            className="grid grid-cols-3 overflow-hidden rounded-md border border-[var(--color-line)]"
          >
            {(
              [
                { value: "email", label: "Email", Icon: Mail },
                { value: "linkedin", label: "LinkedIn", Icon: Linkedin },
                {
                  value: "both",
                  label: "Both",
                  Icon: () => (
                    <span className="inline-flex items-center gap-0.5">
                      <Mail className="h-3 w-3" />
                      <Linkedin className="h-3 w-3" />
                    </span>
                  ),
                },
              ] as const
            ).map((opt) => {
              const isActive = channels === opt.value;
              const Icon = opt.Icon;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => onChannelsChange(opt.value)}
                  className={cn(
                    "inline-flex flex-col items-center justify-center gap-1 px-3 py-3 transition-colors border-l border-[var(--color-line)] first:border-l-0",
                    isActive
                      ? "bg-[var(--color-accent)]/12 text-[var(--color-accent)]"
                      : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-raised)]"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="text-[12px] font-medium">{opt.label}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 font-mono text-[10.5px] text-[var(--color-fg-subtle)] leading-snug">
            {channels === "email" &&
              "AI proposes email recipes. Email auto-send (if enabled) fires SMTP for approved drafts."}
            {channels === "linkedin" &&
              "AI proposes LinkedIn DM recipes targeting person personas reachable on LinkedIn. Daily caps default to 15 — you paste each message manually."}
            {channels === "both" &&
              "AI proposes one set per channel. Each active weekday gets two campaign cards: one email + one LinkedIn. Auto-send only fires for email; LinkedIn waits for your manual paste."}
          </p>
        </div>

        <ul className="mt-6 space-y-2.5 text-left text-[13px] text-[var(--color-fg-muted)]">
          <li className="flex items-start gap-2.5">
            <Check className="h-4 w-4 text-[var(--color-status-success)] shrink-0 mt-0.5" />
            <span>
              <strong className="text-[var(--color-fg)]">No data leaves</strong>{" "}
              your browser apart from your website URL.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <Check className="h-4 w-4 text-[var(--color-status-success)] shrink-0 mt-0.5" />
            <span>
              <strong className="text-[var(--color-fg)]">Nothing is saved</strong>{" "}
              until you click Save. Cancel anytime.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <Check className="h-4 w-4 text-[var(--color-status-success)] shrink-0 mt-0.5" />
            <span>
              <strong className="text-[var(--color-fg)]">Your existing recipes</strong>{" "}
              stay — we add new ones alongside.
            </span>
          </li>
        </ul>

        {error && (
          <div className="mt-6 rounded-md border border-[var(--color-status-error)]/30 bg-[var(--color-status-error)]/[0.08] p-3 text-left">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-[var(--color-status-error)] shrink-0 mt-0.5" />
              <p className="text-[12.5px] text-[var(--color-fg)] leading-relaxed">
                {error}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Hidden hint button — the real CTA is in the footer */}
      <button type="button" onClick={onStart} className="sr-only">
        Start
      </button>
    </div>
  );
}

function LoadingStage() {
  return (
    <div className="px-8 py-16">
      <div className="max-w-md mx-auto text-center">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-accent-soft)] mb-5">
          <Loader2 className="h-7 w-7 text-[var(--color-accent)] animate-spin" />
        </div>
        <h2 className="text-lg font-semibold tracking-tight text-[var(--color-fg)]">
          Reading your website…
        </h2>
        <p className="mt-2 text-sm text-[var(--color-fg-muted)] leading-relaxed">
          AI is fetching your site, understanding what you do, and matching
          it to ideal prospect segments. This usually takes 10–20 seconds.
        </p>
        <div className="mt-6 flex justify-center gap-1.5">
          <span className="h-1.5 w-12 rounded-full bg-[var(--color-accent)] animate-pulse" />
          <span
            className="h-1.5 w-12 rounded-full bg-[var(--color-accent)] animate-pulse"
            style={{ animationDelay: "0.15s" }}
          />
          <span
            className="h-1.5 w-12 rounded-full bg-[var(--color-accent)] animate-pulse"
            style={{ animationDelay: "0.3s" }}
          />
        </div>
      </div>
    </div>
  );
}

function ReviewStage({
  companyUnderstanding,
  proposals,
  keepIndices,
  onToggle,
  error,
}: {
  companyUnderstanding: string;
  proposals: ProposedRecipe[];
  keepIndices: Set<number>;
  onToggle: (idx: number) => void;
  error: string | null;
}) {
  return (
    <div className="px-6 py-5 space-y-4">
      {companyUnderstanding && (
        <div className="rounded-md border border-[var(--color-line-soft)] bg-[var(--color-canvas)]/40 px-4 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] mb-1">
            What AI read about your company
          </div>
          <p className="text-[13px] text-[var(--color-fg)] leading-relaxed">
            {companyUnderstanding}
          </p>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold tracking-tight text-[var(--color-fg)]">
          Proposed recipes
        </h3>
        <p className="mt-0.5 text-[12px] text-[var(--color-fg-muted)]">
          Tick the ones you want to keep. You can edit any of them later
          in the Recipe library.
        </p>
      </div>

      <div className="space-y-2">
        {proposals.map((p, idx) => (
          <RecipeProposalCard
            key={idx}
            proposal={p}
            isChecked={keepIndices.has(idx)}
            onToggle={() => onToggle(idx)}
          />
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-[var(--color-status-error)]/30 bg-[var(--color-status-error)]/[0.08] p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-[var(--color-status-error)] shrink-0 mt-0.5" />
            <p className="text-[12.5px] text-[var(--color-fg)] leading-relaxed">
              {error}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function RecipeProposalCard({
  proposal,
  isChecked,
  onToggle,
}: {
  proposal: ProposedRecipe;
  isChecked: boolean;
  onToggle: () => void;
}) {
  const filterChips = renderFilterChips(proposal.filters);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      className={cn(
        "rounded-md border p-3 cursor-pointer transition-colors",
        isChecked
          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]/20"
          : "border-[var(--color-line-soft)] hover:bg-[var(--color-raised)]/40"
      )}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          checked={isChecked}
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={onToggle}
          className="mt-0.5 shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold leading-none",
                proposal.kind === "companies"
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "bg-[var(--color-status-success)]/15 text-[var(--color-status-success)]"
              )}
            >
              {proposal.kind === "companies" ? (
                <Building2 className="h-2.5 w-2.5" />
              ) : (
                <UserIcon className="h-2.5 w-2.5" />
              )}
              {proposal.kind}
            </span>
            {proposal.channel === "linkedin" && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[9.5px] uppercase tracking-[0.10em] text-[var(--color-accent)] bg-[var(--color-accent)]/10"
                title="LinkedIn outreach"
              >
                <Linkedin className="h-2.5 w-2.5" />
                LI
              </span>
            )}
            <span className="text-sm font-medium text-[var(--color-fg)] truncate">
              {proposal.name}
            </span>
            <span className="ml-auto text-[10.5px] text-[var(--color-fg-muted)] tabular-nums">
              cap {proposal.defaultDailyCap}
            </span>
          </div>
          {proposal.description && (
            <p className="mt-1 text-[12px] text-[var(--color-fg-muted)] leading-relaxed">
              {proposal.description}
            </p>
          )}
          {filterChips.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {filterChips.map((c, i) => (
                <span
                  key={i}
                  className="inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] bg-[var(--color-canvas)]/60 border border-[var(--color-line-soft)] text-[var(--color-fg-muted)]"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
          {proposal.aiFilter !== "any" && (
            <div className="mt-2">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-1.5 py-[3px] text-[10px] font-mono uppercase tracking-[0.05em] border",
                  proposal.aiFilter === "no_ai"
                    ? "border-[var(--color-status-success)]/30 bg-[var(--color-status-success)]/12 text-[var(--color-status-success)]"
                    : "border-[var(--color-accent)]/30 bg-[var(--color-accent)]/12 text-[var(--color-accent)]"
                )}
              >
                {proposal.aiFilter === "no_ai" ? "no AI" : "has AI"} gate
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CadenceStage({
  cadence,
  onCadenceChange,
  startDate,
  onStartDateChange,
  savedCount,
  error,
}: {
  cadence: Cadence;
  onCadenceChange: (c: Cadence) => void;
  startDate: string;
  onStartDateChange: (s: string) => void;
  savedCount: number;
  error: string | null;
}) {
  return (
    <div className="px-6 py-5 space-y-5">
      <div className="rounded-md border border-[var(--color-status-success)]/30 bg-[var(--color-status-success)]/[0.06] p-3">
        <div className="flex items-start gap-2">
          <Check className="h-4 w-4 text-[var(--color-status-success)] shrink-0 mt-0.5" />
          <p className="text-[13px] text-[var(--color-fg)] leading-relaxed">
            <strong>{savedCount} recipe{savedCount === 1 ? "" : "s"} saved.</strong>{" "}
            Now pick how often to run outbound — the calendar will fill
            itself with these recipes on a rotating basis.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label>How often should outbound run?</Label>
        <div className="grid grid-cols-1 gap-2">
          <CadenceOption
            value="daily"
            current={cadence}
            onSelect={onCadenceChange}
            title="Every weekday"
            subtitle="Mon–Fri · ~22 runs in 30 days"
            badge="Full pace"
          />
          <CadenceOption
            value="alt"
            current={cadence}
            onSelect={onCadenceChange}
            title="Mon, Wed, Fri"
            subtitle="3×/week · ~13 runs in 30 days"
            badge="Balanced"
          />
          <CadenceOption
            value="light"
            current={cadence}
            onSelect={onCadenceChange}
            title="Tue & Thu"
            subtitle="2×/week · ~8 runs in 30 days"
            badge="Light touch"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ss-start">Start date</Label>
        <Input
          id="ss-start"
          type="date"
          value={startDate}
          onChange={(e) => onStartDateChange(e.target.value)}
          className="w-48"
        />
        <p className="text-[11px] text-[var(--color-fg-subtle)]">
          Past days are preserved. The fill replaces only future days.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-[var(--color-status-error)]/30 bg-[var(--color-status-error)]/[0.08] p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-[var(--color-status-error)] shrink-0 mt-0.5" />
            <p className="text-[12.5px] text-[var(--color-fg)] leading-relaxed">
              {error}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function CadenceOption({
  value,
  current,
  onSelect,
  title,
  subtitle,
  badge,
}: {
  value: Cadence;
  current: Cadence;
  onSelect: (c: Cadence) => void;
  title: string;
  subtitle: string;
  badge: string;
}) {
  const isActive = value === current;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={cn(
        "w-full text-left rounded-md border px-4 py-3 transition-colors",
        isActive
          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]/20"
          : "border-[var(--color-line-soft)] hover:bg-[var(--color-raised)]/40"
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0",
            isActive
              ? "border-[var(--color-accent)]"
              : "border-[var(--color-line)]"
          )}
        >
          {isActive && (
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--color-fg)]">
              {title}
            </span>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.05em] text-[var(--color-fg-subtle)] border border-[var(--color-line-soft)] rounded px-1.5 py-[2px]">
              {badge}
            </span>
          </div>
          <div className="mt-0.5 text-[11.5px] text-[var(--color-fg-muted)]">
            {subtitle}
          </div>
        </div>
      </div>
    </button>
  );
}

function FillingStage() {
  return (
    <div className="px-8 py-16">
      <div className="max-w-md mx-auto text-center">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-accent-soft)] mb-5">
          <Loader2 className="h-7 w-7 text-[var(--color-accent)] animate-spin" />
        </div>
        <h2 className="text-lg font-semibold tracking-tight text-[var(--color-fg)]">
          Filling your calendar…
        </h2>
        <p className="mt-2 text-sm text-[var(--color-fg-muted)] leading-relaxed">
          Laying the recipes out across the next 30 days.
        </p>
      </div>
    </div>
  );
}

function DoneStage({
  savedCount,
  fillResult,
  cadence,
}: {
  savedCount: number;
  fillResult: {
    scheduledCount: number;
    skippedCount: number;
    firstScheduledDate: string;
    lastScheduledDate: string;
    filledChannels?: Array<"email" | "linkedin">;
    preservedOtherChannelDays?: number;
  };
  cadence: Cadence;
}) {
  const cadenceLabel: Record<Cadence, string> = {
    daily: "every weekday",
    alt: "Mon/Wed/Fri",
    light: "Tue/Thu",
  };
  const filledChannels = fillResult.filledChannels ?? ["email"];
  const filledChannelsLabel =
    filledChannels.length === 2
      ? "email + LinkedIn"
      : filledChannels[0] === "linkedin"
        ? "LinkedIn"
        : "email";
  const preservedCount = fillResult.preservedOtherChannelDays ?? 0;
  const preservedChannelLabel = filledChannels.includes("email")
    ? "LinkedIn"
    : "email";
  return (
    <div className="px-8 py-10">
      <div className="max-w-md mx-auto text-center">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-status-success)]/15 mb-5">
          <Check className="h-7 w-7 text-[var(--color-status-success)]" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-[var(--color-fg)]">
          All set
        </h2>
        <p className="mt-2 text-sm text-[var(--color-fg-muted)] leading-relaxed">
          Created {savedCount} recipe{savedCount === 1 ? "" : "s"} and scheduled{" "}
          <strong className="text-[var(--color-fg)]">
            {fillResult.scheduledCount} {filledChannelsLabel} day
            {fillResult.scheduledCount === 1 ? "" : "s"}
          </strong>{" "}
          on a <strong className="text-[var(--color-fg)]">{cadenceLabel[cadence]}</strong>{" "}
          cadence.
        </p>

        {preservedCount > 0 && (
          <p className="mt-3 text-[12.5px] text-[var(--color-fg-muted)] leading-relaxed">
            Your existing{" "}
            <strong className="text-[var(--color-fg)]">
              {preservedCount} {preservedChannelLabel} day
              {preservedCount === 1 ? "" : "s"}
            </strong>{" "}
            stay in place — each channel runs its own schedule.
          </p>
        )}

        <div className="mt-5 inline-flex items-center gap-3 px-4 py-3 rounded-md border border-[var(--color-line-soft)] bg-[var(--color-canvas)]/40">
          <div className="text-left">
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
              First run
            </div>
            <div className="text-sm font-medium text-[var(--color-fg)] tabular-nums">
              {formatShortDate(fillResult.firstScheduledDate)}
            </div>
          </div>
          <span className="text-[var(--color-fg-subtle)]">→</span>
          <div className="text-left">
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
              Last run
            </div>
            <div className="text-sm font-medium text-[var(--color-fg)] tabular-nums">
              {formatShortDate(fillResult.lastScheduledDate)}
            </div>
          </div>
        </div>

        <p className="mt-5 text-[12.5px] text-[var(--color-fg-muted)] leading-relaxed">
          Click <strong>Run today</strong> on the calendar to start importing
          contacts and drafting {filledChannelsLabel} messages.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Misc

function StepDots({ active, total }: { active: number; total: number }) {
  return (
    <span className="inline-flex items-center gap-1 ml-2">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 rounded-full transition-all",
            i === active
              ? "w-5 bg-[var(--color-accent)]"
              : i < active
              ? "w-1.5 bg-[var(--color-accent)]/70"
              : "w-1.5 bg-[var(--color-line)]"
          )}
        />
      ))}
    </span>
  );
}

function renderFilterChips(filters: Record<string, unknown>): string[] {
  const chips: string[] = [];
  const fmtArr = (label: string, v: unknown) => {
    if (Array.isArray(v) && v.length > 0) {
      const shown = v.slice(0, 3).join(", ");
      const more = v.length > 3 ? ` +${v.length - 3}` : "";
      chips.push(`${label}: ${shown}${more}`);
    }
  };
  fmtArr("Locations", filters.locations);
  fmtArr("HQ", filters.organizationLocations);
  fmtArr("Person in", filters.personLocations);
  fmtArr("Industries", filters.industries);
  fmtArr("Titles", filters.titles);
  fmtArr("Seniorities", filters.seniorities);
  fmtArr("Keywords", filters.keywords);
  fmtArr("Tech", filters.technologies);
  const min = filters.employeeCountMin;
  const max = filters.employeeCountMax;
  if (typeof min === "number" || typeof max === "number") {
    chips.push(
      `Headcount ${typeof min === "number" ? min : "—"}–${
        typeof max === "number" ? max : "—"
      }`
    );
  }
  return chips;
}

function toDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatShortDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
