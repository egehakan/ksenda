"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  SkipForward,
  CheckCircle2,
  Loader2,
  X,
  Trash2,
  Linkedin,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Channel = "email" | "linkedin";

interface Recipe {
  id: string;
  code: string;
  name: string;
  description: string | null;
  kind: "companies" | "people";
  defaultDailyCap: number;
  isBuiltIn: boolean;
  channel?: Channel;
}

interface CampaignDay {
  id: string;
  scheduledDate: string;
  savedSearchId: string | null;
  dailyImportCap: number;
  dailySendCap: number;
  focusNote: string | null;
  status: "scheduled" | "skipped" | "completed";
  channel?: Channel;
  ranAt: string | null;
  outcomeSummary: string | null;
  savedSearch: Recipe | null;
}

interface EditorTarget {
  date: string;
  channel: Channel;
}

interface Props {
  /** Today's date as YYYY-MM-DD, server-anchored so tz doesn't drift. */
  today: string;
  days: CampaignDay[];
  recipes: Recipe[];
}

/**
 * Month-grid calendar for building an automation schedule by clicking
 * days. Empty days show a "+" affordance. Scheduled days show recipe
 * code + cap. Today is highlighted. Click any day to open the slide-in
 * editor.
 *
 * Source-of-truth flow: this component is dumb — parent owns the data
 * fetches via React Query, this just renders + mutates per-day rows.
 */
export function AutomationCalendar({ today, days, recipes }: Props) {
  // Anchor the viewed month on today's month by default. parseDateKey is
  // UTC-safe so we don't drift across DST or local-tz boundaries.
  const todayDate = useMemo(() => parseDateKey(today), [today]);
  const [viewYear, setViewYear] = useState(todayDate.getUTCFullYear());
  const [viewMonth, setViewMonth] = useState(todayDate.getUTCMonth());
  const [openTarget, setOpenTarget] = useState<EditorTarget | null>(null);

  // Group all CampaignDay rows by date. Two rows are possible per date now
  // (one per channel — see migration 0012). The order inside each bucket is
  // email-then-linkedin so the calendar cell renders consistently.
  const daysByDate = useMemo(() => {
    const m = new Map<string, CampaignDay[]>();
    for (const d of days) {
      const arr = m.get(d.scheduledDate) ?? [];
      arr.push(d);
      m.set(d.scheduledDate, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => (channelOf(a) === "email" ? -1 : channelOf(b) === "email" ? 1 : 0));
    }
    return m;
  }, [days]);

  const monthCells = useMemo(
    () => buildMonthGrid(viewYear, viewMonth),
    [viewYear, viewMonth]
  );

  const goPrev = () => {
    const d = new Date(Date.UTC(viewYear, viewMonth - 1, 1));
    setViewYear(d.getUTCFullYear());
    setViewMonth(d.getUTCMonth());
  };
  const goNext = () => {
    const d = new Date(Date.UTC(viewYear, viewMonth + 1, 1));
    setViewYear(d.getUTCFullYear());
    setViewMonth(d.getUTCMonth());
  };
  const goToday = () => {
    setViewYear(todayDate.getUTCFullYear());
    setViewMonth(todayDate.getUTCMonth());
  };

  const monthLabel = new Date(Date.UTC(viewYear, viewMonth, 1)).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric", timeZone: "UTC" }
  );

  return (
    <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] shadow-sm overflow-hidden">
      {/* Header: month label + nav */}
      <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-[var(--color-line-soft)]">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold tracking-tight text-[var(--color-fg)]">
            {monthLabel}
          </h3>
          <button
            type="button"
            onClick={goToday}
            className="text-xs font-medium text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors rounded px-2 py-0.5 border border-[var(--color-line-soft)] hover:border-[var(--color-line)]"
          >
            Today
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={goPrev}
            className="inline-flex items-center justify-center h-8 w-8 rounded-md text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-raised)] transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={goNext}
            className="inline-flex items-center justify-center h-8 w-8 rounded-md text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-raised)] transition-colors"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Calendar scroll viewport — a month grid can't stay legible at
          ~47px/cell on a phone, so it scrolls horizontally under a fixed
          minimum cell size instead of crushing its content. */}
      <div className="overflow-x-auto">
      <div className="min-w-[600px]">
      {/* Weekday header row */}
      <div className="grid grid-cols-7 border-b border-[var(--color-line-soft)] bg-[var(--color-canvas)]/40">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div
            key={d}
            className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-7 auto-rows-fr">
        {monthCells.map((cell) => {
          const cellDays = daysByDate.get(cell.dateKey) ?? [];
          const isToday = cell.dateKey === today;
          const isPast = cell.dateKey < today;
          return (
            <CalendarCell
              key={cell.dateKey}
              cell={cell}
              days={cellDays}
              isToday={isToday}
              isPast={isPast}
              onOpen={(target) => setOpenTarget(target)}
            />
          );
        })}
      </div>
      </div>
      </div>

      {/* Slide-in day editor. Keyed by date+channel so switching between
          email and linkedin rows on the same date fully remounts the form
          — avoids stale state and satisfies the "no setState in useEffect"
          lint rule. */}
      {(() => {
        const targetKey = openTarget
          ? `${openTarget.date}:${openTarget.channel}`
          : "closed";
        const rowsForDate = openTarget
          ? daysByDate.get(openTarget.date) ?? []
          : [];
        const matchedDay = openTarget
          ? rowsForDate.find((d) => channelOf(d) === openTarget.channel)
          : undefined;
        // True when ANOTHER channel row already exists on this date — used
        // by the editor to suppress the Skip option (the user is plainly
        // adding the second channel; Skip doesn't make sense).
        const siblingExists = openTarget
          ? rowsForDate.some((d) => channelOf(d) !== openTarget.channel)
          : false;
        return (
          <DayEditorPanel
            key={targetKey}
            open={openTarget !== null}
            date={openTarget?.date ?? null}
            channel={openTarget?.channel ?? "email"}
            day={matchedDay ?? null}
            siblingExists={siblingExists}
            recipes={recipes}
            onClose={() => setOpenTarget(null)}
          />
        );
      })()}
    </div>
  );
}

/** Normalise the channel column off either the CampaignDay row or its
 *  linked recipe. Pre-0012 rows that lack the column entirely default to
 *  email. */
function channelOf(d: CampaignDay): Channel {
  return d.channel === "linkedin" || d.savedSearch?.channel === "linkedin"
    ? "linkedin"
    : "email";
}

// ─────────────────────────────────────────────────────────────────────
// Calendar cell

interface MonthCell {
  dateKey: string; // YYYY-MM-DD
  dayNumber: number;
  isCurrentMonth: boolean;
  isWeekend: boolean;
}

function CalendarCell({
  cell,
  days,
  isToday,
  isPast,
  onOpen,
}: {
  cell: MonthCell;
  days: CampaignDay[];
  isToday: boolean;
  isPast: boolean;
  onOpen: (target: EditorTarget) => void;
}) {
  const hasAny = days.length > 0;
  // Surface a single completed checkmark when ANY row on this date has run.
  const anyCompleted = days.some((d) => d.status === "completed");
  // Skip-only days have exactly one skipped row with no recipe; treat the
  // cell as a skip card. When the user has an email-or-linkedin row alongside
  // a leftover skip row (shouldn't happen in normal flow), the real rows win.
  const realRows = days.filter((d) => d.status !== "skipped" || d.savedSearchId);
  const skipRow = days.find((d) => d.status === "skipped" && !d.savedSearchId);
  const isSkipOnly = realRows.length === 0 && skipRow !== undefined;

  return (
    <div
      className={cn(
        "group relative flex flex-col items-stretch min-h-[96px] p-2 text-left border-r border-b border-[var(--color-line-soft)] last:border-r-0 transition-colors",
        !cell.isCurrentMonth && "bg-[var(--color-canvas)]/30 opacity-50",
        isToday && "ring-2 ring-inset ring-[var(--color-accent)]",
        "hover:bg-[var(--color-raised)]/60",
        isPast && !hasAny && "opacity-60"
      )}
    >
      {/* Day number + today badge */}
      <div className="flex items-center justify-between mb-1.5">
        <span
          className={cn(
            "inline-flex items-center justify-center text-[11px] font-semibold tabular-nums",
            isToday
              ? "h-5 w-5 rounded-full bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
              : cell.isCurrentMonth
              ? "text-[var(--color-fg)]"
              : "text-[var(--color-fg-subtle)]"
          )}
        >
          {cell.dayNumber}
        </span>
        {anyCompleted && (
          <CheckCircle2
            className="h-3.5 w-3.5 text-[var(--color-status-success)]"
            aria-label="Already ran"
          />
        )}
      </div>

      {/* Body */}
      {isSkipOnly ? (
        <button
          type="button"
          onClick={() => onOpen({ date: cell.dateKey, channel: "email" })}
          className="flex items-start gap-1.5 text-left text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
        >
          <SkipForward className="h-3 w-3 mt-[3px] shrink-0" />
          <span className="text-[11px] leading-tight truncate">
            {skipRow?.focusNote ?? "Skip"}
          </span>
        </button>
      ) : hasAny ? (
        <div className="space-y-1">
          {realRows.map((d) => (
            <CampaignRowMini
              key={d.id}
              day={d}
              onClick={() =>
                onOpen({ date: cell.dateKey, channel: channelOf(d) })
              }
            />
          ))}
          {/* Add-the-other-channel affordance when only one channel is scheduled */}
          {realRows.length === 1 && (() => {
            const present = channelOf(realRows[0]);
            const missing: Channel = present === "email" ? "linkedin" : "email";
            const Icon = missing === "linkedin" ? Linkedin : Mail;
            return (
              <button
                type="button"
                onClick={() => onOpen({ date: cell.dateKey, channel: missing })}
                className="inline-flex items-center gap-1 text-[10px] text-[var(--color-fg-subtle)] hover:text-[var(--color-accent)] transition-colors opacity-0 group-hover:opacity-100"
                title={`Add ${missing} row to this day`}
              >
                <Plus className="h-3 w-3" />
                <Icon className="h-3 w-3" />
                {missing}
              </button>
            );
          })()}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onOpen({ date: cell.dateKey, channel: "email" })}
          className="flex-1 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-fg-muted)]">
            <Plus className="h-3 w-3" />
            Add
          </span>
        </button>
      )}
    </div>
  );
}

function CampaignRowMini({
  day,
  onClick,
}: {
  day: CampaignDay;
  onClick: () => void;
}) {
  const code = day.savedSearch?.code;
  const isLinkedIn = channelOf(day) === "linkedin";
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-left rounded-sm px-1 -mx-1 hover:bg-[var(--color-raised)]/70 transition-colors"
    >
      {code ? (
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold leading-none",
              code.startsWith("A")
                ? "bg-[var(--color-status-success)]/15 text-[var(--color-status-success)]"
                : code.startsWith("B")
                ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                : "bg-[var(--color-raised)] text-[var(--color-fg)]"
            )}
          >
            {code}
          </span>
          {isLinkedIn && (
            <Linkedin
              className="h-2.5 w-2.5 text-[var(--color-accent)]"
              aria-label="LinkedIn outreach"
            />
          )}
          <span className="text-[10px] text-[var(--color-fg-muted)] tabular-nums">
            cap {day.dailyImportCap}
          </span>
        </div>
      ) : (
        <span className="text-[10px] text-[var(--color-fg-subtle)]">
          No recipe
        </span>
      )}
      {day.savedSearch?.name && (
        <p className="text-[10.5px] text-[var(--color-fg-muted)] leading-tight line-clamp-1">
          {day.savedSearch.name}
        </p>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Slide-in editor panel

function DayEditorPanel({
  open,
  date,
  channel,
  day,
  siblingExists,
  recipes,
  onClose,
}: {
  open: boolean;
  date: string | null;
  /** Which channel slot this editor edits. The parent picks this from the
   *  mini-row the user clicked (or defaults to 'email' for empty cells). */
  channel: Channel;
  day: CampaignDay | null;
  /** True when the OTHER channel already has a row on this date. Used to
   *  hide the Skip option — when the user is in "add the second channel"
   *  mode, Skip would mean "skip this slot only", which is confusing.
   *  Days are skipped wholesale, not per-channel. */
  siblingExists: boolean;
  recipes: Recipe[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  // Form state is initialized from props on mount. The parent re-mounts
  // this component via a key prop whenever the selected (date, channel)
  // changes, so we never need to re-sync inside an effect.
  const [recipeId, setRecipeId] = useState<string>(day?.savedSearchId ?? "");
  const [importCap, setImportCap] = useState<number>(
    day?.dailyImportCap ?? (channel === "linkedin" ? 15 : 25)
  );
  const [sendCap, setSendCap] = useState<number>(
    day?.dailySendCap ?? (channel === "linkedin" ? 15 : 25)
  );
  const [focus, setFocus] = useState<string>(day?.focusNote ?? "");
  const [status, setStatus] = useState<CampaignDay["status"]>(
    day?.status ?? "scheduled"
  );
  const [error, setError] = useState<string | null>(null);

  // Restrict the recipe picker to recipes that match the current channel
  // slot. Picking an email recipe for a linkedin slot (or vice versa) would
  // either fail the (userId, scheduledDate, channel) unique constraint when
  // the matching slot is empty, or silently put the wrong channel on the
  // row. Filtering at the UI is the clearer path.
  const channelRecipes = recipes.filter((r) => (r.channel ?? "email") === channel);

  // ESC closes the panel for keyboard users. Bind only while open so we
  // don't leak listeners.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!date) throw new Error("No date selected");
      const res = await fetch(`/api/automation/schedule/${date}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          savedSearchId: status === "skipped" ? null : recipeId || null,
          dailyImportCap: importCap,
          dailySendCap: sendCap,
          focusNote: focus,
          status,
          channel,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign-schedule"] });
      onClose();
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : "Save failed");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!date) throw new Error("No date selected");
      // Delete only this channel's row, not both. The DELETE route accepts
      // `?channel=` and drops one row at a time.
      const res = await fetch(
        `/api/automation/schedule/${date}?channel=${channel}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "Delete failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign-schedule"] });
      onClose();
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : "Delete failed");
    },
  });

  // Render an inert version when closed to keep the slide-out animation
  // smooth (mount stays, opacity + translate animate).
  const dateLabel = date ? formatLongDate(date) : "";
  const isExisting = day !== null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] transition-opacity",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        aria-hidden="true"
      />
      {/* Side panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={dateLabel ? `Edit ${dateLabel}` : "Day editor"}
        className={cn(
          "fixed right-0 top-0 z-50 h-dvh w-full max-w-[440px] bg-[var(--color-panel)] border-l border-[var(--color-line)] shadow-2xl flex flex-col transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="px-4 sm:px-6 py-5 border-b border-[var(--color-line-soft)] flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] flex items-center gap-2">
              {isExisting ? "Edit day" : "Add day"}
              <span
                className={cn(
                  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[9.5px] uppercase tracking-[0.10em]",
                  channel === "linkedin"
                    ? "text-[var(--color-accent)] bg-[var(--color-accent)]/10"
                    : "text-[var(--color-fg-muted)] bg-[var(--color-raised)]"
                )}
              >
                {channel === "linkedin" ? (
                  <Linkedin className="h-2.5 w-2.5" />
                ) : (
                  <Mail className="h-2.5 w-2.5" />
                )}
                {channel}
              </span>
            </div>
            <h3 className="mt-1 text-lg font-semibold tracking-tight text-[var(--color-fg)]">
              {dateLabel}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center h-8 w-8 rounded-md text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-raised)] transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-5">
          {/* Status toggle. Skip is suppressed when the other channel
              already has a row on this date — in that scenario the user is
              plainly adding the second channel slot, not flipping the day
              to a skip. Skip stays available for existing skipped rows so
              the user can switch them back to "scheduled". */}
          {(() => {
            const hideSkip = siblingExists && status !== "skipped";
            return (
              <div className="space-y-2">
                <Label>Status</Label>
                <div className={cn(hideSkip ? "" : "grid grid-cols-2 gap-2")}>
                  <button
                    type="button"
                    onClick={() => setStatus("scheduled")}
                    className={cn(
                      "px-3 py-2 rounded-md text-sm font-medium transition-colors border",
                      hideSkip && "w-full",
                      status === "scheduled"
                        ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-[var(--color-accent)]"
                        : "bg-transparent text-[var(--color-fg-muted)] border-[var(--color-line-soft)] hover:text-[var(--color-fg)] hover:border-[var(--color-line)]"
                    )}
                  >
                    Run this day
                  </button>
                  {!hideSkip && (
                    <button
                      type="button"
                      onClick={() => setStatus("skipped")}
                      className={cn(
                        "px-3 py-2 rounded-md text-sm font-medium transition-colors border inline-flex items-center justify-center gap-1.5",
                        status === "skipped"
                          ? "bg-[var(--color-raised)] text-[var(--color-fg)] border-[var(--color-line)]"
                          : "bg-transparent text-[var(--color-fg-muted)] border-[var(--color-line-soft)] hover:text-[var(--color-fg)] hover:border-[var(--color-line)]"
                      )}
                    >
                      <SkipForward className="h-3.5 w-3.5" />
                      Skip
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-[var(--color-fg-subtle)] leading-relaxed">
                  {status === "scheduled"
                    ? siblingExists
                      ? `Adding the ${channel} slot to a day that already has the other channel scheduled. Each channel runs its own import + cap.`
                      : "On Run today, this day will import contacts and draft emails using the recipe below."
                    : "Nothing runs on a skip day. Use it for weekends, holidays, or audit/review days."}
                </p>
              </div>
            );
          })()}

          {status === "scheduled" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="dep-recipe">Recipe</Label>
                <select
                  id="dep-recipe"
                  value={recipeId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setRecipeId(id);
                    // Auto-suggest the recipe's default cap so users don't
                    // have to retype it every time. Only updates the cap if
                    // it's still on the channel-canonical default.
                    const channelDefault = channel === "linkedin" ? 15 : 25;
                    const r = channelRecipes.find((x) => x.id === id);
                    if (r && importCap === channelDefault)
                      setImportCap(r.defaultDailyCap);
                    if (r && sendCap === channelDefault)
                      setSendCap(r.defaultDailyCap);
                  }}
                  className="flex h-9 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
                >
                  <option value="">— Pick a recipe —</option>
                  {channelRecipes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code} · {r.name}
                    </option>
                  ))}
                </select>
                {channelRecipes.length === 0 && (
                  <p className="text-[11px] text-[var(--color-fg-subtle)]">
                    No {channel} recipes yet. Add one in the Recipe library
                    below — set its channel to {channel}.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="dep-import">Import cap</Label>
                  <Input
                    id="dep-import"
                    type="number"
                    min={0}
                    value={importCap}
                    onChange={(e) =>
                      setImportCap(Math.max(0, parseInt(e.target.value, 10) || 0))
                    }
                  />
                  <p className="text-[10.5px] text-[var(--color-fg-subtle)]">
                    Max new contacts to fetch.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dep-send">Send cap</Label>
                  <Input
                    id="dep-send"
                    type="number"
                    min={0}
                    value={sendCap}
                    onChange={(e) =>
                      setSendCap(Math.max(0, parseInt(e.target.value, 10) || 0))
                    }
                  />
                  <p className="text-[10.5px] text-[var(--color-fg-subtle)]">
                    Max emails to send.
                  </p>
                </div>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="dep-focus">Focus note</Label>
            <Input
              id="dep-focus"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder={
                status === "skipped"
                  ? "e.g. Weekend, holiday, audit day"
                  : "Optional reminder for this day"
              }
            />
          </div>

          {error && (
            <div className="rounded-md border border-[var(--color-status-error)]/30 bg-[var(--color-status-error)]/[0.08] p-3">
              <p className="text-[12.5px] text-[var(--color-status-error)] leading-relaxed">
                {error}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-4 border-t border-[var(--color-line-soft)] flex items-center justify-between gap-3 bg-[var(--color-panel)]">
          {isExisting ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                if (
                  confirm(
                    `Delete this day's card? The date will become unscheduled again.`
                  )
                ) {
                  deleteMutation.mutate();
                }
              }}
              disabled={deleteMutation.isPending || saveMutation.isPending}
              className="text-[var(--color-status-error)] hover:text-[var(--color-status-error)] hover:bg-[var(--color-status-error)]/10"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setError(null);
                saveMutation.mutate();
              }}
              disabled={saveMutation.isPending || deleteMutation.isPending}
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : isExisting ? (
                "Save changes"
              ) : (
                "Add to calendar"
              )}
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers — UTC-anchored date math

/** Build the 6-week grid that fully encloses a given month. Cells before
 *  the 1st and after the last are flagged so the cell can mute them. */
function buildMonthGrid(year: number, month: number): MonthCell[] {
  const first = new Date(Date.UTC(year, month, 1));
  const firstDow = first.getUTCDay(); // 0=Sun
  // Start on the Sunday on/before the 1st.
  const start = new Date(Date.UTC(year, month, 1 - firstDow));
  const cells: MonthCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(
      Date.UTC(
        start.getUTCFullYear(),
        start.getUTCMonth(),
        start.getUTCDate() + i
      )
    );
    const dow = d.getUTCDay();
    cells.push({
      dateKey: toDateKey(d),
      dayNumber: d.getUTCDate(),
      isCurrentMonth: d.getUTCMonth() === month,
      isWeekend: dow === 0 || dow === 6,
    });
  }
  // Trim trailing all-other-month week if it adds nothing — keeps the
  // grid tight at 5 rows when February fits in 4 (or 5 in most months).
  if (cells.slice(35).every((c) => !c.isCurrentMonth)) {
    return cells.slice(0, 35);
  }
  return cells;
}

function toDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateKey(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
