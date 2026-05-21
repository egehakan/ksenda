"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Search, Check, X, Sparkles, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TARGET_TITLE_CATEGORIES,
  TARGET_TITLE_ALIASES,
  type TargetTitleCategory,
} from "@/lib/constants";

const ALL_CATEGORIES = Object.keys(TARGET_TITLE_CATEGORIES) as TargetTitleCategory[];

/**
 * Builds a normalized search index once per render. Each canonical title
 * gets a single haystack string: lowercased title + each lowercased alias,
 * joined by spaces. The search box does a substring match against this so
 * "vp eng" finds "VP Engineering" even though the canonical name doesn't
 * contain "eng" as a separate token.
 */
function buildSearchIndex(): Map<string, string> {
  const idx = new Map<string, string>();
  for (const [category, titles] of Object.entries(TARGET_TITLE_CATEGORIES)) {
    void category;
    for (const title of titles) {
      const aliases = TARGET_TITLE_ALIASES[title] ?? [];
      const haystack = [title.toLowerCase(), ...aliases.map((a) => a.toLowerCase())].join(" ");
      idx.set(title, haystack);
    }
  }
  return idx;
}

const SEARCH_INDEX = buildSearchIndex();

interface CategorizedTitlePickerProps {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Extra titles the user typed in that aren't in the catalog. */
  customTitles?: string[];
  onCustomTitlesChange?: (titles: string[]) => void;
  /** If true, render the "Suggest with AI" affordance. The host page sets
   *  this only when the user has a Gemini key AND a company profile saved —
   *  the API will 400 otherwise. */
  enableAiSuggest?: boolean;
  /** Optional reason to disable the AI button with a tooltip — used when
   *  the Gemini key / company profile aren't ready yet. */
  aiSuggestDisabledReason?: string;
}

interface SuggestResponse {
  reasoning: string;
  titles: string[];
  custom: string[];
}

export function CategorizedTitlePicker({
  selected,
  onChange,
  customTitles = [],
  onCustomTitlesChange,
  enableAiSuggest = false,
  aiSuggestDisabledReason,
}: CategorizedTitlePickerProps) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<TargetTitleCategory | "all">("all");
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestReasoning, setSuggestReasoning] = useState<string | null>(null);

  const toggle = (title: string) => {
    const next = new Set(selected);
    if (next.has(title)) next.delete(title);
    else next.add(title);
    onChange(next);
  };

  const setAllInCategory = (cat: TargetTitleCategory, on: boolean) => {
    const next = new Set(selected);
    for (const t of TARGET_TITLE_CATEGORIES[cat]) {
      if (on) next.add(t);
      else next.delete(t);
    }
    onChange(next);
  };

  const matches = (title: string) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase().trim();
    const haystack = SEARCH_INDEX.get(title) ?? title.toLowerCase();
    return haystack.includes(q);
  };

  // Build the visible set of (category, [titles]) tuples respecting both
  // the active-category chip and the search query.
  const visibleGroups = useMemo(() => {
    const groups: Array<{ category: TargetTitleCategory; titles: readonly string[] }> = [];
    for (const cat of ALL_CATEGORIES) {
      if (activeCategory !== "all" && activeCategory !== cat) continue;
      const titles = TARGET_TITLE_CATEGORIES[cat].filter(matches);
      if (titles.length === 0) continue;
      groups.push({ category: cat, titles });
    }
    return groups;
  }, [query, activeCategory]);

  const totalMatches = visibleGroups.reduce((sum, g) => sum + g.titles.length, 0);
  const selectedCount = selected.size + customTitles.length;

  // Custom-title input handlers. Only shown when the host page wires up the
  // onCustomTitlesChange prop, so the picker stays read-only by default.
  const [customDraft, setCustomDraft] = useState("");
  const addCustom = () => {
    const trimmed = customDraft.trim();
    if (!trimmed) return;
    // Skip if it's already in the catalog under any case.
    const lower = trimmed.toLowerCase();
    const inCatalog = ALL_CATEGORIES.some((cat) =>
      TARGET_TITLE_CATEGORIES[cat].some((t) => t.toLowerCase() === lower)
    );
    if (inCatalog) {
      const canonical = ALL_CATEGORIES.flatMap((cat) => TARGET_TITLE_CATEGORIES[cat]).find(
        (t) => t.toLowerCase() === lower
      )!;
      const next = new Set(selected);
      next.add(canonical);
      onChange(next);
      setCustomDraft("");
      return;
    }
    if (customTitles.some((t) => t.toLowerCase() === lower)) {
      setCustomDraft("");
      return;
    }
    onCustomTitlesChange?.([...customTitles, trimmed]);
    setCustomDraft("");
  };

  const removeCustom = (title: string) => {
    onCustomTitlesChange?.(customTitles.filter((t) => t !== title));
  };

  const runSuggest = async () => {
    setSuggestLoading(true);
    setSuggestError(null);
    setSuggestReasoning(null);
    // 45-second ceiling. The server route uses gemini-3.1-flash-lite which
    // typically lands in 3-10s with grounding tools; anything past 45s is
    // almost certainly a stuck call.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45_000);
    try {
      const res = await fetch("/api/target-titles/suggest", {
        method: "POST",
        signal: controller.signal,
      });
      const json = (await res.json()) as
        | (SuggestResponse & { error?: undefined })
        | { error: string };
      if (!res.ok || "error" in json) {
        setSuggestError(("error" in json && json.error) || "AI suggestion failed");
        return;
      }
      // Merge suggested catalog titles INTO the current selection rather than
      // replacing it — the user may have already picked some, and the AI's
      // job is to expand/refine, not wipe their work.
      const nextSelected = new Set(selected);
      for (const t of json.titles) nextSelected.add(t);
      onChange(nextSelected);

      // Custom titles from Gemini get appended to the user's custom list
      // (deduped against existing entries).
      if (onCustomTitlesChange && json.custom.length > 0) {
        const existing = new Set(customTitles.map((t) => t.toLowerCase()));
        const merged = [...customTitles];
        for (const c of json.custom) {
          if (!existing.has(c.toLowerCase())) merged.push(c);
        }
        onCustomTitlesChange(merged);
      }

      setSuggestReasoning(json.reasoning || null);
    } catch (e: any) {
      if (e?.name === "AbortError") {
        setSuggestError(
          "AI suggestion timed out after 45 seconds. Check that your Gemini API key is valid and try again."
        );
      } else {
        setSuggestError(e?.message || "AI suggestion failed");
      }
    } finally {
      clearTimeout(timeoutId);
      setSuggestLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* AI suggest banner — only when the host opts in. Pre-fills the
          selection from Gemini's reading of the user's company. */}
      {enableAiSuggest && (
        <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] p-4 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[13.5px] font-medium text-[var(--color-fg)] flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                Suggest titles for my ICP
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-fg-muted)] max-w-[58ch]">
                Gemini will read your company website and check recent news, then
                pre-select the decision-maker titles most likely to buy from you.
              </p>
            </div>
            <button
              type="button"
              onClick={runSuggest}
              disabled={suggestLoading || !!aiSuggestDisabledReason}
              title={aiSuggestDisabledReason || undefined}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium transition-colors shrink-0",
                aiSuggestDisabledReason
                  ? "border-[var(--color-line)] text-[var(--color-fg-subtle)] cursor-not-allowed"
                  : "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-fg)] hover:bg-[var(--color-accent-hover)] disabled:opacity-60 disabled:cursor-wait"
              )}
            >
              {suggestLoading ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Thinking…
                </>
              ) : (
                <>
                  <Sparkles className="h-3 w-3" />
                  Suggest with AI
                </>
              )}
            </button>
          </div>
          {aiSuggestDisabledReason && !suggestLoading && (
            <p className="text-[12px] leading-relaxed text-[var(--color-fg-subtle)]">
              {aiSuggestDisabledReason}
            </p>
          )}
          {suggestLoading && (
            <p className="font-mono text-[11px] leading-relaxed text-[var(--color-fg-subtle)]">
              Fetching your site + searching the web. Usually 5–15 seconds.
            </p>
          )}
          {suggestError && (
            <p className="inline-flex items-start gap-1.5 text-[12px] leading-relaxed text-[var(--color-status-error)]">
              <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
              <span>{suggestError}</span>
            </p>
          )}
          {suggestReasoning && (
            <div className="border-t border-[var(--color-line-soft)] pt-3">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)] mb-1.5">
                Why these titles
              </p>
              <p className="text-[12.5px] leading-relaxed text-[var(--color-fg-muted)]">
                {suggestReasoning}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Search + count */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-fg-subtle)]" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles — try “vp eng”, “csm”, “growth lead”…"
          className="pl-9"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)]">
        <span>
          {totalMatches} {totalMatches === 1 ? "title" : "titles"} shown
        </span>
        <span className="text-[var(--color-fg)]">{selectedCount} selected</span>
      </div>

      {/* Category chips */}
      <div className="-mx-1 flex flex-wrap gap-1.5">
        <CategoryChip
          label="All"
          active={activeCategory === "all"}
          onClick={() => setActiveCategory("all")}
          count={Object.values(TARGET_TITLE_CATEGORIES).flat().length}
        />
        {ALL_CATEGORIES.map((cat) => (
          <CategoryChip
            key={cat}
            label={cat}
            active={activeCategory === cat}
            onClick={() => setActiveCategory(cat)}
            count={TARGET_TITLE_CATEGORIES[cat].length}
            selectedCount={
              TARGET_TITLE_CATEGORIES[cat].filter((t) => selected.has(t)).length
            }
          />
        ))}
      </div>

      {/* Grouped results */}
      <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)]">
        <div className="max-h-[460px] overflow-y-auto">
          {visibleGroups.length === 0 ? (
            <div className="px-5 py-10 text-center font-mono text-[12px] text-[var(--color-fg-muted)]">
              No titles match “{query}”.
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-line-soft)]">
              {visibleGroups.map(({ category, titles }) => {
                const totalInCategory = TARGET_TITLE_CATEGORIES[category].length;
                const selectedInCategory = TARGET_TITLE_CATEGORIES[category].filter((t) =>
                  selected.has(t)
                ).length;
                const allSelected = selectedInCategory === totalInCategory;
                return (
                  <div key={category} className="px-4 py-3">
                    <div className="mb-2.5 flex items-center justify-between gap-3">
                      <div className="flex items-baseline gap-2.5">
                        <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)]">
                          {category}
                        </span>
                        <span className="font-mono text-[10.5px] tabular-nums text-[var(--color-fg-subtle)]">
                          {selectedInCategory}/{totalInCategory}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAllInCategory(category, !allSelected)}
                        className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] hover:text-[var(--color-accent)]"
                      >
                        {allSelected ? "Clear" : "Select all"}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {titles.map((title) => {
                        const on = selected.has(title);
                        return (
                          <button
                            key={title}
                            type="button"
                            onClick={() => toggle(title)}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] transition-colors",
                              on
                                ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-fg)]"
                                : "border-[var(--color-line)] bg-transparent text-[var(--color-fg-muted)] hover:border-[var(--color-line-strong)] hover:text-[var(--color-fg)]"
                            )}
                          >
                            {on && <Check className="h-3 w-3 text-[var(--color-accent)]" />}
                            <span>{title}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Custom titles */}
      {onCustomTitlesChange && (
        <div className="space-y-3">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)]">
            Don't see it? Add your own
          </p>
          <div className="flex gap-2">
            <Input
              value={customDraft}
              onChange={(e) => setCustomDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustom();
                }
              }}
              placeholder="e.g. VP of Customer Reliability"
            />
            <button
              type="button"
              onClick={addCustom}
              disabled={!customDraft.trim()}
              className="inline-flex h-9 items-center rounded-md border border-[var(--color-line)] bg-transparent px-3 text-sm text-[var(--color-fg)] hover:bg-[var(--color-panel)] disabled:opacity-50"
            >
              Add
            </button>
          </div>
          {customTitles.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {customTitles.map((title) => (
                <span
                  key={title}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-2.5 py-1 text-[12px] text-[var(--color-fg)]"
                >
                  {title}
                  <button
                    type="button"
                    onClick={() => removeCustom(title)}
                    className="text-[var(--color-fg-muted)] hover:text-[var(--color-status-error)]"
                    aria-label={`Remove ${title}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
  count,
  selectedCount,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count: number;
  selectedCount?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-[12px] transition-colors",
        active
          ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
          : "border-[var(--color-line)] bg-transparent text-[var(--color-fg-muted)] hover:border-[var(--color-line-strong)] hover:text-[var(--color-fg)]"
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "font-mono tabular-nums text-[10.5px]",
          active ? "text-[var(--color-accent-fg)] opacity-70" : "text-[var(--color-fg-subtle)]"
        )}
      >
        {selectedCount != null ? `${selectedCount}/${count}` : count}
      </span>
    </button>
  );
}
