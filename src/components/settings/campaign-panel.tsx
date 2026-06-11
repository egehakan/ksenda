"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  Loader2,
  Sparkles,
  SkipForward,
  Pencil,
  Plus,
  Trash2,
  Play,
  Linkedin,
  Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  RecipeBuilderDialog,
  type RecipeBuilderRecipe,
} from "@/components/settings/recipe-builder-dialog";
import {
  RecipeDeleteDialog,
  type RecipeForDeletion,
} from "@/components/settings/recipe-delete-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { AutomationCalendar } from "@/components/settings/automation-calendar";
import { SmartSetupWizard } from "@/components/settings/smart-setup-wizard";
import { useAccountBusy } from "@/hooks/use-account-busy";
import { parseMultiLeg } from "@/lib/multi-leg";
import {
  MultiLegChips,
  MultiLegBreakdown,
} from "@/components/settings/multi-leg-view";

interface Recipe {
  id: string;
  code: string;
  name: string;
  description: string | null;
  kind: "companies" | "people";
  defaultDailyCap: number;
  isBuiltIn: boolean;
  // The recipes API parses this into `filters`; the schedule API embeds the raw
  // SavedSearch which only has `filtersJson`. Either may carry a DAILY recipe's
  // { multiLeg, legs } payload — parseMultiLeg accepts both.
  filters?: Record<string, unknown> | null;
  filtersJson?: string | null;
  aiFilter?: "any" | "no_ai" | "has_ai";
  channel?: "email" | "linkedin";
}

interface CampaignDay {
  id: string;
  scheduledDate: string;
  savedSearchId: string | null;
  dailyImportCap: number;
  dailySendCap: number;
  focusNote: string | null;
  status: "scheduled" | "skipped" | "completed";
  channel?: "email" | "linkedin";
  ranAt: string | null;
  outcomeSummary: string | null;
  savedSearch: Recipe | null;
}

/**
 * Campaign panel — calendar-first automation setup.
 *
 * Layout:
 *   1. Today summary + Run today button (the only daily action).
 *   2. Month-grid calendar (AutomationCalendar) — click any day to
 *      add/edit/delete a card. Drives the per-day CampaignDay rows.
 *   3. Recipe library — saved Apollo searches the calendar picks from.
 *
 * The old "Generate 30-day schedule" template flow has been removed in
 * favor of direct manual scheduling. The backend service is preserved
 * for future re-introduction as a one-click starter.
 */
export function CampaignPanel() {
  const queryClient = useQueryClient();
  /** Per-card multi-select for bulk recipe delete. Clears on every
   *  mutation and dialog open. */
  const [selectedRecipeIds, setSelectedRecipeIds] = useState<Set<string>>(
    () => new Set()
  );
  const [pendingDelete, setPendingDelete] = useState<RecipeForDeletion[] | null>(
    null
  );
  const [recipeDialog, setRecipeDialog] = useState<
    { open: false } | { open: true; initial: RecipeBuilderRecipe | null }
  >({ open: false });
  const [smartSetupOpen, setSmartSetupOpen] = useState(false);
  // Run result: summary line + structured errors. Errors render inline
  // so the user sees *what* broke, not buried elsewhere on the page.
  const [runResult, setRunResult] = useState<{
    summary: string;
    errors: Array<{ stage: string; detail: string }>;
  } | null>(null);
  // Per-run channel toggle on the Today card. Defaults to ALL channels
  // scheduled for today; user can untoggle to skip one. Empty set blocks
  // the Run button — having no channel selected is meaningless.
  const [runChannels, setRunChannels] = useState<Set<"email" | "linkedin">>(
    () => new Set(["email", "linkedin"])
  );

  const { data: scheduleData, isLoading: scheduleLoading } = useQuery({
    queryKey: ["campaign-schedule"],
    queryFn: async () => {
      const res = await fetch("/api/automation/schedule?includePast=1");
      if (!res.ok) throw new Error("Failed to load schedule");
      return res.json() as Promise<{ days: CampaignDay[]; today: string }>;
    },
    staleTime: 0,
  });
  // Wrapping in useMemo keeps the array reference stable across renders
  // when the underlying data hasn't changed — important because `days`
  // feeds dependencies of downstream useMemo and the AutomationCalendar.
  const days = useMemo(() => scheduleData?.days || [], [scheduleData?.days]);
  const today = scheduleData?.today;

  const { data: recipesData } = useQuery({
    queryKey: ["recipes"],
    queryFn: async () => {
      const res = await fetch("/api/automation/recipes");
      if (!res.ok) throw new Error("Failed to load recipes");
      return res.json() as Promise<{ recipes: Recipe[] }>;
    },
    staleTime: 60_000,
  });
  const recipes = recipesData?.recipes || [];

  // Today can carry up to two CampaignDay rows (one per channel) since the
  // 0012 migration. Render the first non-skipped row for the legacy
  // single-day code paths; the Today card itself iterates the full list.
  const todaysDays = useMemo(
    () => days.filter((d) => d.scheduledDate === today),
    [days, today]
  );
  const todaysDay = useMemo(() => {
    if (todaysDays.length === 0) return undefined;
    return (
      todaysDays.find((d) => d.status !== "skipped") ?? todaysDays[0]
    );
  }, [todaysDays]);

  // The set of channels that are actually scheduled today (and not skipped).
  // Used both to render the toggle and to clamp `runChannels` so it can't
  // include a channel today doesn't have.
  const todayChannels = useMemo(() => {
    const s = new Set<"email" | "linkedin">();
    for (const d of todaysDays) {
      if (d.status === "skipped" || !d.savedSearchId) continue;
      s.add(d.channel === "linkedin" ? "linkedin" : "email");
    }
    return s;
  }, [todaysDays]);

  // Whenever the set of scheduled channels for today changes (new schedule
  // synced, a day flipped to skipped, etc.), reset the toggle to match —
  // user starts with all today's channels enabled, then opts out per click.
  useEffect(() => {
    setRunChannels(new Set(todayChannels));
  }, [todayChannels]);

  // Account-wide single-flight: a search / generation / automation job
  // already in flight disables Run today (the API also hard-blocks 409).
  const { busy: accountBusy, label: busyLabel } = useAccountBusy();

  const runTodayMutation = useMutation({
    mutationFn: async (channels?: Array<"email" | "linkedin">) => {
      const res = await fetch("/api/automation/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(channels && channels.length > 0 ? { channels } : {}),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error || "Run failed");
      }
      return res.json() as Promise<{
        success: boolean;
        queued?: boolean;
        message?: string;
      }>;
    },
    onSuccess: (r) => {
      setRunResult({
        summary:
          r.message || "Automation run queued. Watch the jobs widget for progress.",
        errors: [],
      });
      queryClient.invalidateQueries({ queryKey: ["campaign-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline-stats"] });
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["automation-settings"] });
      setTimeout(() => setRunResult(null), 8000);
    },
    onError: (e: unknown) => {
      const detail = e instanceof Error ? e.message : "unknown";
      setRunResult({
        summary: "Run failed to queue",
        errors: [{ stage: "request", detail }],
      });
    },
  });

  const deleteRecipeMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      // Fire all DELETEs in parallel — the server endpoint is per-id and
      // SavedSearch has a unique constraint per (userId, code), so order
      // doesn't matter. Collect any failures into an aggregate error.
      const results = await Promise.allSettled(
        ids.map(async (id) => {
          const res = await fetch(`/api/automation/recipes/${id}`, {
            method: "DELETE",
          });
          if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            throw new Error(e.error || `Delete failed for ${id}`);
          }
          return id;
        })
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        throw new Error(`${failed} of ${ids.length} deletes failed`);
      }
      return { deleted: ids.length };
    },
    onSuccess: () => {
      setSelectedRecipeIds(new Set());
      setPendingDelete(null);
      queryClient.invalidateQueries({ queryKey: ["recipes"] });
      queryClient.invalidateQueries({ queryKey: ["campaign-schedule"] });
    },
  });

  const toggleRecipeSelected = (id: string) =>
    setSelectedRecipeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (scheduleLoading) {
    return (
      <Card>
        <CardContent className="pt-6 flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading campaign…
        </CardContent>
      </Card>
    );
  }

  // Runnable when at least one of today's rows has a recipe and is not
  // skipped. The orchestrator iterates each channel-row independently.
  const todayIsRunnable = todaysDays.some(
    (d) => d.status !== "skipped" && d.savedSearchId
  );

  // Smart Setup card is more prominent when the user has nothing scheduled
  // and few recipes — that's the "needs setup" state. Once they've got
  // momentum, it stays available but collapses to a slim banner.
  const isFirstTimeUser = days.length === 0 && recipes.length <= 9; // ≤ built-ins only

  return (
    <div className="space-y-6">
      {/* Smart Setup hero — adapts to first-time vs returning user */}
      {isFirstTimeUser ? (
        <SmartSetupHero onStart={() => setSmartSetupOpen(true)} />
      ) : (
        <SmartSetupBanner onStart={() => setSmartSetupOpen(true)} />
      )}

      {/* Today's run — primary daily action lives here */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--color-accent)]" />
            Today
          </CardTitle>
          <CardDescription>
            {todaysDay
              ? "Today's scheduled card. Click Run today to import contacts and draft emails."
              : "Nothing is scheduled for today yet. Click today's cell in the calendar below to add a card."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {todaysDays.length === 0 ? (
            <div className="flex items-start gap-3 text-sm">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-raised)] text-[var(--color-fg-muted)]">
                <Plus className="h-4 w-4" />
              </div>
              <div>
                <div className="font-medium text-[var(--color-fg)]">
                  No card for today
                </div>
                <div className="text-muted-foreground mt-0.5">
                  Pick a day in the calendar below to schedule a recipe + cap.
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {todaysDays.map((d, idx) => (
                <div
                  key={d.id}
                  className={cn(
                    idx > 0 &&
                      "pt-5 border-t border-[var(--color-line-soft)]"
                  )}
                >
                  <TodaySummary day={d} />
                </div>
              ))}
            </div>
          )}

          {/* Primary CTA row */}
          <div className="mt-6 pt-6 border-t border-[var(--color-line-soft)] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                size="lg"
                onClick={() =>
                  runTodayMutation.mutate(
                    // Only send the channel filter when the user has actively
                    // limited the run. When all of today's channels are
                    // selected we pass undefined so the server runs every
                    // row (matches pre-toggle behaviour).
                    runChannels.size > 0 && runChannels.size < todayChannels.size
                      ? Array.from(runChannels)
                      : undefined
                  )
                }
                disabled={
                  runTodayMutation.isPending ||
                  !todayIsRunnable ||
                  accountBusy ||
                  (todayChannels.size > 0 && runChannels.size === 0)
                }
                title={
                  accountBusy
                    ? busyLabel
                      ? `Busy: ${busyLabel}`
                      : "A job is already running for this account."
                    : runChannels.size === 0 && todayChannels.size > 0
                      ? "Pick at least one channel to run."
                      : undefined
                }
              >
                {runTodayMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Running…
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    Run today
                    {todayChannels.size === 2 && runChannels.size === 1 && (
                      <span className="ml-1.5 font-mono text-[10.5px] uppercase tracking-[0.10em] opacity-80">
                        · {Array.from(runChannels)[0]}
                      </span>
                    )}
                  </>
                )}
              </Button>

              {/* Channel selector — checkbox-style so the on/off state is
                  unambiguous. Visible whenever today has at least one
                  scheduled channel. With both scheduled the user can flip
                  either off; with only one scheduled the lone channel
                  can't be deselected (clicking does nothing). */}
              {todayChannels.size > 0 && (
                <div
                  role="group"
                  aria-label="Channels to run on this click"
                  className="inline-flex items-center gap-2"
                >
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)]">
                    Channels
                  </span>
                  <div className="flex items-center gap-1.5">
                    {(["email", "linkedin"] as const)
                      .filter((c) => todayChannels.has(c))
                      .map((c, _i, arr) => {
                        const active = runChannels.has(c);
                        const isOnlyOneScheduled = arr.length === 1;
                        const Icon = c === "linkedin" ? Linkedin : Mail;
                        const label =
                          c === "linkedin" ? "LinkedIn" : "Email";
                        return (
                          <label
                            key={c}
                            className={cn(
                              "inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[12px] leading-none transition-colors",
                              active
                                ? "border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 text-[var(--color-fg)]"
                                : "border-[var(--color-line)] text-[var(--color-fg-subtle)] hover:border-[var(--color-line-soft)] hover:text-[var(--color-fg-muted)]",
                              isOnlyOneScheduled && active
                                ? "cursor-default"
                                : "cursor-pointer",
                              runTodayMutation.isPending && "opacity-60 cursor-not-allowed"
                            )}
                            title={
                              isOnlyOneScheduled
                                ? `Only ${label} is scheduled today`
                                : active
                                  ? `Click to skip ${label} on this run`
                                  : `Click to include ${label} in this run`
                            }
                          >
                            <Checkbox
                              checked={active}
                              disabled={
                                runTodayMutation.isPending ||
                                (isOnlyOneScheduled && active)
                              }
                              onCheckedChange={() => {
                                setRunChannels((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(c)) next.delete(c);
                                  else next.add(c);
                                  return next;
                                });
                              }}
                              className="h-3.5 w-3.5"
                            />
                            <Icon
                              className={cn(
                                "h-3 w-3 shrink-0",
                                active
                                  ? c === "linkedin"
                                    ? "text-[var(--color-accent)]"
                                    : "text-[var(--color-fg-muted)]"
                                  : ""
                              )}
                            />
                            <span
                              className={cn(
                                !active && "line-through decoration-[var(--color-fg-subtle)]/60"
                              )}
                            >
                              {label}
                            </span>
                          </label>
                        );
                      })}
                  </div>
                </div>
              )}
              {accountBusy && !runTodayMutation.isPending && (
                <span className="text-xs text-muted-foreground">
                  {busyLabel || "A job is already running…"}
                </span>
              )}
              {!todaysDay && (
                <span className="text-xs text-muted-foreground">
                  Add today&apos;s card to enable Run.
                </span>
              )}
              {todaysDay?.status === "skipped" && (
                <span className="text-xs text-muted-foreground">
                  Today is a skip day — nothing to run.
                </span>
              )}
              {todaysDay && todaysDay.status !== "skipped" && !todaysDay.savedSearchId && (
                <span className="text-xs text-muted-foreground">
                  Pick a recipe on today&apos;s card to enable Run.
                </span>
              )}
              {todaysDay?.status === "completed" && (
                <span className="text-xs text-[var(--color-fg-muted)] inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[var(--color-status-success)]" />
                  Ran today · click to run again
                </span>
              )}
            </div>
            {runResult && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {runResult.summary}
                </span>
                {runResult.errors.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setRunResult(null)}
                    className="text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] underline"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            )}
          </div>

          {runResult && runResult.errors.length > 0 && (
            <div className="mt-4 border border-[var(--color-status-error)]/30 bg-[var(--color-status-error)]/[0.06] rounded-md p-3 space-y-2">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-status-error)]">
                {runResult.errors.length} issue
                {runResult.errors.length === 1 ? "" : "s"} during run
              </div>
              <ul className="space-y-1.5">
                {runResult.errors.map((err, i) => (
                  <li
                    key={i}
                    className="text-[13px] leading-relaxed text-[var(--color-fg)]"
                  >
                    <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-muted)] mr-2">
                      {err.stage}
                    </span>
                    {err.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Calendar — the heart of the page. */}
      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-[var(--color-fg)]">
              Schedule
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Click any day to add, edit, or skip it. Each card pins a recipe
              and a daily cap.
            </p>
          </div>
        </div>
        {today && (
          <AutomationCalendar today={today} days={days} recipes={recipes} />
        )}
        {days.length === 0 && (
          <p className="mt-3 text-xs text-[var(--color-fg-subtle)]">
            Tip — start by clicking today, pick a recipe, and click <strong>Add to calendar</strong>.
            Repeat for the days you want to run outbound.
          </p>
        )}
      </section>

      {/* Recipe library */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Recipe library</CardTitle>
              <CardDescription>
                Your saved Apollo search recipes. The calendar picks from
                these. Built-ins are starters — edit their filters or add
                your own that match your ICP.
              </CardDescription>
            </div>
            <Button
              size="sm"
              onClick={() => setRecipeDialog({ open: true, initial: null })}
            >
              <Plus className="h-4 w-4" />
              Add recipe
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Selection toolbar — fades in when at least one card is picked. */}
          {recipes.length > 0 && (
            <div className="mb-3 flex items-center gap-3 min-h-[28px]">
              {selectedRecipeIds.size > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedRecipeIds.size === recipes.length) {
                        setSelectedRecipeIds(new Set());
                      } else {
                        setSelectedRecipeIds(new Set(recipes.map((r) => r.id)));
                      }
                    }}
                    className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors"
                  >
                    {selectedRecipeIds.size === recipes.length
                      ? "Deselect all"
                      : "Select all"}
                  </button>
                  <span className="font-mono text-[11px] text-[var(--color-fg-subtle)] tabular-nums">
                    {selectedRecipeIds.size} selected
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="ml-auto"
                    onClick={() => {
                      const list = recipes.filter((r) =>
                        selectedRecipeIds.has(r.id)
                      );
                      if (list.length > 0) {
                        setPendingDelete(
                          list.map((r) => ({
                            id: r.id,
                            code: r.code,
                            name: r.name,
                            isBuiltIn: r.isBuiltIn,
                          }))
                        );
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete {selectedRecipeIds.size}
                  </Button>
                </>
              ) : (
                <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
                  Tip — tick a card to multi-select. Hover a card for the trash icon.
                </p>
              )}
            </div>
          )}
          {recipes.length === 0 ? (
            <div className="rounded-md border border-dashed border-[var(--color-line)] p-6 text-center">
              <p className="text-sm font-medium">No recipes yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add one to define what Apollo should search for.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {recipes.map((r) => {
                const openEditor = () =>
                  setRecipeDialog({
                    open: true,
                    initial: {
                      id: r.id,
                      code: r.code,
                      name: r.name,
                      description: r.description,
                      kind: r.kind,
                      filters: r.filters || {},
                      // Pass the raw JSON too so a DAILY recipe is still
                      // detected as multiLeg even if `filters` failed to parse
                      // server-side (else editing would flatten its legs).
                      filtersJson: r.filtersJson ?? null,
                      defaultDailyCap: r.defaultDailyCap,
                      isBuiltIn: r.isBuiltIn,
                      aiFilter: r.aiFilter ?? "any",
                      // Preserve the recipe's channel — omitting it defaulted
                      // every edited recipe back to "email", silently flipping
                      // LinkedIn recipes.
                      channel: r.channel ?? "email",
                    },
                  });
                const isSelected = selectedRecipeIds.has(r.id);
                const isDeleting =
                  deleteRecipeMutation.isPending &&
                  Array.isArray(deleteRecipeMutation.variables) &&
                  (deleteRecipeMutation.variables as string[]).includes(r.id);
                const cardMl = parseMultiLeg(r.filters ?? r.filtersJson);
                return (
                  <div
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    onClick={openEditor}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        openEditor();
                      }
                    }}
                    className={cn(
                      "group relative text-left rounded-md border p-3 transition-colors cursor-pointer",
                      isSelected
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]/30"
                        : "border-[var(--color-line-soft)] hover:bg-[var(--color-raised)]"
                    )}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleRecipeSelected(r.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select recipe ${r.code}`}
                      className={cn(
                        "absolute top-3 left-3 transition-opacity",
                        isSelected || selectedRecipeIds.size > 0
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100"
                      )}
                    />
                    <div className="flex items-center gap-2 pr-8 pl-7">
                      <span
                        className={cn(
                          "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono font-semibold",
                          r.code.startsWith("A")
                            ? "bg-[var(--color-status-success)]/15 text-[var(--color-status-success)]"
                            : r.code.startsWith("B")
                            ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                            : "bg-[var(--color-panel)] text-[var(--color-fg)]"
                        )}
                      >
                        {r.code}
                      </span>
                      <span className="text-sm font-medium truncate">{r.name}</span>
                      {r.channel === "linkedin" && (
                        <span
                          title="LinkedIn outreach — sent manually, excluded from auto-send"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[9.5px] uppercase tracking-[0.10em] text-[var(--color-accent)] bg-[var(--color-accent)]/10 shrink-0"
                        >
                          <Linkedin className="h-2.5 w-2.5" />
                          LI
                        </span>
                      )}
                      {r.isBuiltIn && (
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                          starter
                        </span>
                      )}
                      {r.aiFilter === "no_ai" && (
                        <span
                          title="Import-time gate: only no-AI companies. Walks Apollo pages, runs batched cheap AI detection, keeps matches."
                          className="inline-flex items-center gap-1 rounded-full border border-[var(--color-status-success)]/30 bg-[var(--color-status-success)]/12 text-[var(--color-status-success)] font-mono text-[9.5px] uppercase tracking-[0.05em] px-1.5 py-[3px] shrink-0"
                        >
                          no AI
                        </span>
                      )}
                      {r.aiFilter === "has_ai" && (
                        <span
                          title="Import-time gate: only companies already using AI."
                          className="inline-flex items-center gap-1 rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/12 text-[var(--color-accent)] font-mono text-[9.5px] uppercase tracking-[0.05em] px-1.5 py-[3px] shrink-0"
                        >
                          has AI
                        </span>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground tabular-nums shrink-0">
                        cap {r.defaultDailyCap}
                      </span>
                    </div>
                    {cardMl && (
                      <div className="mt-2 pl-7 pr-8">
                        <div className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
                          {cardMl.legs.length} countries · {cardMl.totalCap}/day
                        </div>
                        <MultiLegChips legs={cardMl.legs} size="xs" />
                      </div>
                    )}
                    {r.description && !cardMl && (
                      <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed line-clamp-2 pl-7 pr-8">
                        {r.description}
                      </p>
                    )}
                    <div className="mt-2 pl-7 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                      <Pencil className="h-3 w-3" />
                      Click to edit
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDelete([
                          {
                            id: r.id,
                            code: r.code,
                            name: r.name,
                            isBuiltIn: r.isBuiltIn,
                          },
                        ]);
                      }}
                      disabled={isDeleting}
                      title="Delete this recipe"
                      className={cn(
                        "absolute top-2.5 right-2.5 inline-flex items-center justify-center rounded-md h-6 w-6",
                        "text-[var(--color-fg-subtle)] hover:text-[var(--color-status-error)] hover:bg-[var(--color-status-error)]/10",
                        "opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity",
                        "disabled:opacity-50 disabled:cursor-not-allowed"
                      )}
                    >
                      {isDeleting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            The 9 built-ins (A1–B5) are baked from a solo-AI-consulting 30-day
            plan. They&apos;re examples — feel free to replace them with recipes
            that match your own ICP, or add new ones alongside.
          </p>
        </CardContent>
      </Card>

      {/* Recipe builder dialog */}
      <RecipeBuilderDialog
        open={recipeDialog.open}
        initial={recipeDialog.open ? recipeDialog.initial : null}
        onClose={() => setRecipeDialog({ open: false })}
        onSaved={() => setRecipeDialog({ open: false })}
      />

      {/* Recipe delete confirmation — supports single + bulk */}
      <RecipeDeleteDialog
        isOpen={pendingDelete !== null}
        recipes={pendingDelete ?? []}
        isLoading={deleteRecipeMutation.isPending}
        onClose={() => {
          if (!deleteRecipeMutation.isPending) setPendingDelete(null);
        }}
        onConfirm={async () => {
          const ids = (pendingDelete ?? []).map((r) => r.id);
          if (ids.length === 0) return;
          await deleteRecipeMutation.mutateAsync(ids);
        }}
      />

      {/* Smart Setup wizard — AI proposes recipes + auto-fills schedule.
          Conditionally mounted so each open starts with fresh state. */}
      {smartSetupOpen && (
        <SmartSetupWizard
          open={smartSetupOpen}
          onClose={() => setSmartSetupOpen(false)}
        />
      )}
    </div>
  );
}

function TodaySummary({ day }: { day: CampaignDay }) {
  const isLinkedIn =
    day.channel === "linkedin" ||
    (day.savedSearch as { channel?: string } | undefined)?.channel ===
      "linkedin";
  const channelBadge = isLinkedIn ? (
    <span
      title="LinkedIn outreach — sent manually, excluded from auto-send"
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[9.5px] uppercase tracking-[0.10em] text-[var(--color-accent)] bg-[var(--color-accent)]/10"
    >
      <Linkedin className="h-2.5 w-2.5" />
      LI
    </span>
  ) : null;
  if (day.status === "skipped") {
    return (
      <div className="flex items-start gap-3 text-sm">
        <SkipForward className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
        <div>
          <div className="font-medium text-[var(--color-fg)] flex items-center gap-2">
            Skip day {channelBadge}
          </div>
          <div className="text-muted-foreground mt-0.5">
            {day.focusNote || "No outbound scheduled for today."}
          </div>
        </div>
      </div>
    );
  }
  if (day.status === "completed") {
    return (
      <div className="flex items-start gap-3 text-sm">
        <CheckCircle2 className="h-5 w-5 text-[var(--color-status-success)] shrink-0 mt-0.5" />
        <div>
          <div className="font-medium text-[var(--color-fg)] flex items-center gap-2">
            Already ran today {channelBadge}
          </div>
          <div className="text-muted-foreground mt-0.5">
            {day.outcomeSummary || "Completed."}
          </div>
        </div>
      </div>
    );
  }
  const ml = parseMultiLeg(
    day.savedSearch?.filtersJson ?? day.savedSearch?.filters
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Recipe
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <span
              className={cn(
                "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono font-semibold",
                (day.savedSearch?.code || "").startsWith("A")
                  ? "bg-[var(--color-status-success)]/15 text-[var(--color-status-success)]"
                  : "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
              )}
            >
              {day.savedSearch?.code || "—"}
            </span>
            {channelBadge}
            <span className="font-medium">{day.savedSearch?.name || "No recipe"}</span>
          </div>
        </div>
        {ml ? (
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Daily total
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {ml.totalCap}
              <span className="ml-1.5 text-xs font-normal text-[var(--color-fg-subtle)]">
                across {ml.legs.length}
              </span>
            </div>
          </div>
        ) : (
          <>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Import cap
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {day.dailyImportCap}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Send cap
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {day.dailySendCap}
              </div>
            </div>
          </>
        )}
        {day.focusNote && (
          <div className="basis-full">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Focus
            </div>
            <div className="mt-1 text-sm text-[var(--color-fg)] italic">
              {day.focusNote}
            </div>
          </div>
        )}
      </div>
      {ml && (
        <div>
          <div className="mb-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            Today&apos;s countries{" "}
            <span className="text-[var(--color-fg-subtle)] normal-case tracking-normal">
              — each fills its own cap; the industry rotates daily
            </span>
          </div>
          <MultiLegBreakdown
            legs={ml.legs}
            date={day.scheduledDate}
            totalCap={ml.totalCap}
          />
        </div>
      )}
    </div>
  );
}

/**
 * SmartSetupHero — large, accent-glowing CTA for the first-time state.
 * Shown when the calendar is empty and the user hasn't added custom
 * recipes beyond the built-in starters.
 */
function SmartSetupHero({ onStart }: { onStart: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--color-accent)]/30 bg-gradient-to-br from-[var(--color-accent-soft)]/40 via-[var(--color-panel)] to-[var(--color-panel)] p-6 shadow-sm">
      {/* Decorative glow */}
      <div
        aria-hidden="true"
        className="absolute -top-12 -right-12 h-48 w-48 rounded-full bg-[var(--color-accent)]/20 blur-3xl pointer-events-none"
      />
      <div className="relative flex items-start gap-4">
        <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-accent-soft)] shrink-0">
          <Sparkles className="h-5 w-5 text-[var(--color-accent)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold tracking-tight text-[var(--color-fg)]">
              Smart Setup
            </h3>
            <span className="inline-flex items-center font-mono text-[9.5px] uppercase tracking-[0.08em] text-[var(--color-accent)] border border-[var(--color-accent)]/30 rounded-full px-1.5 py-[2px]">
              AI · new
            </span>
          </div>
          <p className="mt-1 text-[13px] text-[var(--color-fg-muted)] leading-relaxed">
            Let AI read your company website, propose 4 targeting recipes
            tailored to what you sell, and auto-fill the next 30 days. You
            review everything before anything is saved.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button size="default" onClick={onStart}>
              <Sparkles className="h-4 w-4" />
              Start Smart Setup
            </Button>
            <span className="text-[11px] text-[var(--color-fg-subtle)]">
              Takes ~30 seconds · uses your Gemini key
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * SmartSetupBanner — slim re-runnable variant. Returning users see this
 * once they already have recipes or a schedule. Still discoverable, not
 * intrusive.
 */
function SmartSetupBanner({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] px-4 py-3 shadow-sm">
      <Sparkles className="h-4 w-4 text-[var(--color-accent)] shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-[var(--color-fg)] leading-snug">
          <strong>Smart Setup</strong>{" "}
          <span className="text-[var(--color-fg-muted)]">
            — re-run AI to propose new recipes or rebuild the schedule.
          </span>
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onStart}>
        <Sparkles className="h-3.5 w-3.5" />
        Run again
      </Button>
    </div>
  );
}
