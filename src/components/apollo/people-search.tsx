"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { usePeopleSearchStore, ApolloPersonRow } from "@/store/people-search-store";
import { cn } from "@/lib/utils";
import { pollJob } from "@/lib/poll-job";
import { PersonDetailRail } from "@/components/apollo/person-detail-rail";
import { AiStatusBadge, type AiBadgeConfidence } from "@/components/apollo/ai-status-badge";
import { AiFilterToggle } from "@/components/apollo/ai-filter-toggle";
import { ChannelToggle, type ChannelValue } from "@/components/apollo/channel-toggle";
import { useAccountBusy } from "@/hooks/use-account-busy";
import { Sparkles } from "lucide-react";

function normalizeDomain(d: string | undefined): string {
  if (!d) return "";
  return d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].trim();
}

interface ImportOptions {
  aiFilter?: "any" | "no_ai" | "has_ai";
  searchFilters?: Record<string, unknown>;
  target?: number;
  /** Outreach channel for the generated drafts. Defaults to 'email'. */
  channel?: ChannelValue;
}

interface PeopleSearchProps {
  onImport: (people: ApolloPersonRow[], opts?: ImportOptions) => Promise<void>;
}

/*
 * Direct decision-maker search. Same dense-row pattern as CompanySearch,
 * different fields, and imports a pre-selected target contact per row instead
 * of letting findBestContact pick one for you.
 */
/**
 * Apollo gates funding-range, technology-UID, and job-title filters behind
 * its paid plan. People search also gates verified-email-only on free tier.
 * Hitting them on the free tier returns HTTP 422.
 */
function PremiumNotice() {
  return (
    <div className="border-l-2 border-[var(--color-accent)] bg-[var(--color-panel)]/60 px-4 py-3">
      <p className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-accent)] mb-1.5">
        Apollo Basic required ($59/mo)
      </p>
      <p className="text-[12.5px] leading-relaxed text-[var(--color-fg-muted)]">
        Funding date, funding round size, tech stack, hiring-for, and the
        verified-email-only toggle are gated to paid plans. On the free tier
        these return a 422 error and the search will fail.{" "}
        <a
          href="https://app.apollo.io/#/settings/plans"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--color-accent)] hover:underline font-medium"
        >
          Upgrade
        </a>{" "}
        or leave them blank to stay on free-tier filters.
      </p>
    </div>
  );
}

export function PeopleSearch({ onImport }: PeopleSearchProps) {
  const {
    filters,
    setFilters,
    currentPage,
    setCurrentPage,
    pagination,
    selectedPeople,
    togglePerson,
    selectAll,
    clearSelection,
    isSearching,
    setIsSearching,
    error,
    setError,
    setSearchResults,
    getDisplayablePeople,
    markPeopleAsImported,
    isHydrated,
    aiDetection,
    setAiDetectionBatch,
    clearAiDetection,
    channel,
    setChannel,
  } = usePeopleSearchStore();

  // A search / generation / automation job already in flight disables
  // search + paging (the API also hard-blocks with 409).
  const { busy: accountBusy } = useAccountBusy();

  const [isImporting, setIsImporting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [previewPerson, setPreviewPerson] = useState<ApolloPersonRow | null>(null);
  // Client-side filter over the returned rows by AI verdict. Only useful
  // after an AI-gated search (which attaches per-domain detections).
  const [resultFilter, setResultFilter] = useState<
    "all" | "has_ai" | "no_ai" | "unknown"
  >("all");
  const displayable = getDisplayablePeople();

  const aiBucket = (
    p: ApolloPersonRow
  ): "has_ai" | "no_ai" | "unknown" => {
    const dom = normalizeDomain(
      p.organization?.primary_domain || p.organization?.domain || ""
    );
    const ai = dom ? aiDetection[dom] : undefined;
    if (!ai || ai.confidence === "unknown") return "unknown";
    if (ai.confidence === "confirmed_has_ai") return "has_ai";
    return "no_ai"; // probably_no_ai | definitely_no_ai
  };
  const hasDetections = Object.keys(aiDetection).length > 0;
  const aiCounts = hasDetections
    ? displayable.reduce(
        (acc, p) => {
          acc[aiBucket(p)]++;
          return acc;
        },
        { has_ai: 0, no_ai: 0, unknown: 0 } as Record<string, number>
      )
    : null;
  const visiblePeople =
    !hasDetections || resultFilter === "all"
      ? displayable
      : displayable.filter((p) => aiBucket(p) === resultFilter);

  const handleSearch = async (page: number = 1) => {
    setIsSearching(true);
    setError(null);
    // Clear stale rows + badges up front so a fewer-result response
    // doesn't appear to leave previous rows behind.
    setSearchResults([], null);
    clearSelection();
    clearAiDetection();
    try {
      const res = await fetch("/api/people/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiFilter: filters.aiFilter !== "any" ? filters.aiFilter : undefined,
          target: filters.aiFilter !== "any" ? 10 : undefined,
          filters: {
            titles: csv(filters.titles),
            seniorities: csv(filters.seniorities),
            organizationLocations: csv(filters.organizationLocations),
            personLocations: csv(filters.personLocations),
            employeeCountMin: filters.employeeCountMin?.trim()
              ? parseInt(filters.employeeCountMin)
              : undefined,
            employeeCountMax: filters.employeeCountMax?.trim()
              ? parseInt(filters.employeeCountMax)
              : undefined,
            industries: csv(filters.industries),
            technologies: filters.technologies?.trim()
              ? filters.technologies
                  .split(",")
                  .map((s) => s.trim().toLowerCase().replace(/[.\s]/g, "_"))
                  .filter(Boolean)
              : undefined,
            keywords: csv(filters.keywords),
            jobTitles: csv(filters.jobTitles),
            fundingDateMin: filters.fundingDateMin?.trim() || undefined,
            fundingDateMax: filters.fundingDateMax?.trim() || undefined,
            fundingAmountMin: filters.fundingAmountMin?.trim()
              ? parseInt(filters.fundingAmountMin)
              : undefined,
            fundingAmountMax: filters.fundingAmountMax?.trim()
              ? parseInt(filters.fundingAmountMax)
              : undefined,
            emailVerifiedOnly: filters.emailVerifiedOnly,
            includeSimilarTitles: filters.includeSimilarTitles,
          },
          page,
          perPage: 50,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Search failed");
        setSearchResults([], null);
        return;
      }

      const applyAiDetections = (aiDetections: unknown): void => {
        if (!aiDetections || typeof aiDetections !== "object") return;
        const merged: Record<
          string,
          { hasAi: boolean; confidence: AiBadgeConfidence; summary: string }
        > = {};
        for (const [dom, raw] of Object.entries(
          aiDetections as Record<
            string,
            { hasAi: boolean; confidence: AiBadgeConfidence; summary: string }
          >
        )) {
          merged[dom.toLowerCase()] = {
            hasAi: !!raw.hasAi,
            confidence: raw.confidence,
            summary: raw.summary,
          };
        }
        setAiDetectionBatch(merged);
      };

      // Async path — AI-gated people search dispatches to Inngest.
      if (data.mode === "ai_gated_queued" && data.jobId) {
        const finalJob = await pollJob(data.jobId);
        if (finalJob.status === "failed") {
          setError(finalJob.error || "AI search failed");
          setSearchResults([], null);
          return;
        }
        const meta = finalJob.metadata as
          | { checked?: ApolloPersonRow[]; aiDetections?: unknown }
          | null;
        const checked = meta?.checked || [];
        setSearchResults(checked, {
          page: 1,
          per_page: checked.length,
          total_entries: checked.length,
          total_pages: 1,
        });
        setCurrentPage(1);
        clearSelection();
        applyAiDetections(meta?.aiDetections);
        return;
      }

      // Sync path — preserved.
      setSearchResults(data.people || [], data.pagination || null);
      setCurrentPage(data.pagination?.page || page);
      clearSelection();
      applyAiDetections(data.aiDetections);
    } catch (e) {
      console.error(e);
      setError("Network error.");
    } finally {
      setIsSearching(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || (pagination?.total_pages && newPage > pagination.total_pages)) return;
    handleSearch(newPage);
  };

  const toggleAll = () => {
    const allVisibleSelected =
      visiblePeople.length > 0 &&
      visiblePeople.every((p) => selectedPeople.has(p.id));
    if (allVisibleSelected) clearSelection();
    else selectAll(visiblePeople.map((p) => p.id));
  };

  const handleImport = async () => {
    const selected = displayable.filter((p) => selectedPeople.has(p.id));
    if (selected.length === 0) return;
    setIsImporting(true);
    try {
      const orgIds = selected
        .map((p) => p.organization?.id || p.organization_id)
        .filter((id): id is string => !!id);
      markPeopleAsImported(orgIds);
      await onImport(selected, { channel });
    } catch (e) {
      // Stay on this page on failure; the job widget shows the reason too.
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="border-b border-[var(--color-line)] pb-3 flex items-baseline gap-3 flex-wrap">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)]">
          Apollo
        </span>
        <h1 className="text-[22px] font-medium leading-tight tracking-tight text-[var(--color-fg)]">
          People search
        </h1>
        <span className="ml-auto font-mono text-[11px] text-[var(--color-fg-subtle)] hidden lg:inline">
          Direct buyer-persona search across companies
        </span>
        <div className="self-center lg:ml-2">
          <ChannelToggle
            value={channel}
            onChange={setChannel}
            disabled={isImporting || accountBusy}
          />
        </div>
      </div>

      {/* Filters — basic */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-x-6 gap-y-6">
        <div className="space-y-2 col-span-2 lg:col-span-1">
          <Label htmlFor="p-titles">Titles</Label>
          <Input
            id="p-titles"
            value={filters.titles}
            onChange={(e) => setFilters({ titles: e.target.value })}
            placeholder="CTO, Head of AI, VP Engineering"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="p-seniorities">Seniorities</Label>
          <Input
            id="p-seniorities"
            value={filters.seniorities}
            onChange={(e) => setFilters({ seniorities: e.target.value })}
            placeholder="c_suite, vp, head"
            className="font-mono text-[12px]"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="p-orglocs">Org locations</Label>
          <Input
            id="p-orglocs"
            value={filters.organizationLocations}
            onChange={(e) => setFilters({ organizationLocations: e.target.value })}
            placeholder="United States"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="p-emin">Min headcount</Label>
          <Input
            id="p-emin"
            type="number"
            value={filters.employeeCountMin}
            onChange={(e) => setFilters({ employeeCountMin: e.target.value })}
            className="font-mono text-[13px]"
            placeholder="11"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="p-emax">Max headcount</Label>
          <Input
            id="p-emax"
            type="number"
            value={filters.employeeCountMax}
            onChange={(e) => setFilters({ employeeCountMax: e.target.value })}
            className="font-mono text-[13px]"
            placeholder="200"
          />
        </div>
      </div>

      {/* Filters — advanced */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="font-mono text-[11px] uppercase tracking-[0.10em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors inline-flex items-center gap-1.5"
        >
          {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          Signals — funding · hiring · tech · keywords
        </button>

        {showAdvanced && (
          <div className="mt-5 space-y-6 border-l border-[var(--color-line)] pl-5">
            <PremiumNotice />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-6">
              <div className="space-y-2">
                <Label htmlFor="p-fmin">Funding date from</Label>
                <Input
                  id="p-fmin"
                  type="date"
                  value={filters.fundingDateMin}
                  onChange={(e) => setFilters({ fundingDateMin: e.target.value })}
                  className="font-mono text-[12px]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-fmax">Funding date to</Label>
                <Input
                  id="p-fmax"
                  type="date"
                  value={filters.fundingDateMax}
                  onChange={(e) => setFilters({ fundingDateMax: e.target.value })}
                  className="font-mono text-[12px]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-fam-min">Min round (USD)</Label>
                <Input
                  id="p-fam-min"
                  type="number"
                  value={filters.fundingAmountMin}
                  onChange={(e) => setFilters({ fundingAmountMin: e.target.value })}
                  className="font-mono text-[12px]"
                  placeholder="5000000"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-fam-max">Max round (USD)</Label>
                <Input
                  id="p-fam-max"
                  type="number"
                  value={filters.fundingAmountMax}
                  onChange={(e) => setFilters({ fundingAmountMax: e.target.value })}
                  className="font-mono text-[12px]"
                  placeholder="60000000"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-6">
              <div className="space-y-2">
                <Label htmlFor="p-jobs">Org is hiring (titles)</Label>
                <Input
                  id="p-jobs"
                  value={filters.jobTitles}
                  onChange={(e) => setFilters({ jobTitles: e.target.value })}
                  placeholder="AI Engineer, ML Engineer"
                />
                <p className="font-mono text-[10.5px] text-[var(--color-fg-subtle)]">
                  Budget signal. Forces a 2-step search through org gate first.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-tech">Org tech stack</Label>
                <Input
                  id="p-tech"
                  value={filters.technologies}
                  onChange={(e) => setFilters({ technologies: e.target.value })}
                  placeholder="openai, langchain, pinecone"
                  className="font-mono text-[13px]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-ind">Org industries</Label>
                <Input
                  id="p-ind"
                  value={filters.industries}
                  onChange={(e) => setFilters({ industries: e.target.value })}
                  placeholder="SaaS, Fintech, HealthTech"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-kw">Keywords</Label>
                <Input
                  id="p-kw"
                  value={filters.keywords}
                  onChange={(e) => setFilters({ keywords: e.target.value })}
                  placeholder="agents, RAG, voice AI"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-plocs">Person locations</Label>
                <Input
                  id="p-plocs"
                  value={filters.personLocations}
                  onChange={(e) => setFilters({ personLocations: e.target.value })}
                  placeholder="San Francisco, New York"
                />
              </div>
            </div>

            <div className="flex items-center gap-6 pt-2">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={filters.emailVerifiedOnly}
                  onChange={(e) => setFilters({ emailVerifiedOnly: e.target.checked })}
                  className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                />
                <span className="font-mono text-[12px] text-[var(--color-fg-muted)]">
                  Verified emails only
                </span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={filters.includeSimilarTitles}
                  onChange={(e) => setFilters({ includeSimilarTitles: e.target.checked })}
                  className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                />
                <span className="font-mono text-[12px] text-[var(--color-fg-muted)]">
                  Include similar titles (default on)
                </span>
              </label>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <Button
          onClick={() => handleSearch(1)}
          disabled={isSearching || accountBusy}
          title={
            accountBusy
              ? "A job is already running for this account."
              : undefined
          }
        >
          {isSearching ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              {filters.aiFilter === "any" ? "Searching" : "Searching + AI check"}
            </>
          ) : filters.aiFilter === "any" ? (
            "Search"
          ) : (
            <>
              <Sparkles className="h-3 w-3" />
              {`Search (${filters.aiFilter === "no_ai" ? "no AI" : "has AI"} only)`}
            </>
          )}
        </Button>
        <AiFilterToggle
          value={filters.aiFilter}
          onChange={(next) => setFilters({ aiFilter: next })}
          disabled={isSearching || accountBusy}
          helper={
            filters.aiFilter === "any"
              ? "Skip detection. Show every Apollo match."
              : filters.aiFilter === "no_ai"
              ? "Search dedupes by org domain + runs cheap AI check. Returns up to 10 NEW contacts whose company has NO AI. Skips orgs already in your pipeline; cache hits are free. Cap: 100 fresh Gemini calls."
              : "Same flow, but only NEW contacts whose company already deploys AI."
          }
        />
        {error && (
          <span className="text-[13px] text-[var(--color-status-error)]">{error}</span>
        )}
      </div>

      {/* Results — same table for any / no_ai / has_ai. AI-gated mode
          returns up to 50 matches in a single page; rows get AI badges
          from the aiDetections map. */}
      {isHydrated && pagination && (
        <div>
          <div className="flex items-baseline justify-between border-b border-[var(--color-line)] pb-3 mb-0">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)]">
                Results
              </span>
              <span className="font-mono text-[12px] tabular-nums text-[var(--color-fg)]">
                {visiblePeople.length}
                <span className="text-[var(--color-fg-subtle)]">
                  {" / "}
                  {(pagination?.total_entries || displayable.length).toLocaleString()}
                </span>
              </span>
              {pagination?.total_pages && pagination.total_pages > 1 && (
                <span className="font-mono text-[11px] text-[var(--color-fg-muted)] tabular-nums">
                  page {pagination.page || 1} / {pagination.total_pages}
                </span>
              )}
              {hasDetections && aiCounts && (
                <div className="inline-flex w-fit overflow-hidden rounded-md border border-[var(--color-line)]">
                  {(
                    [
                      ["all", "All", displayable.length],
                      ["has_ai", "Has AI", aiCounts.has_ai],
                      ["no_ai", "No AI", aiCounts.no_ai],
                      ["unknown", "Unknown", aiCounts.unknown],
                    ] as const
                  ).map(([key, label, n]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setResultFilter(key)}
                      className={cn(
                        "text-[11px] leading-none px-2.5 py-1.5 border-l border-[var(--color-line)] first:border-l-0 transition-colors whitespace-nowrap",
                        resultFilter === key
                          ? "bg-[var(--color-accent)]/12 text-[var(--color-accent)]"
                          : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-panel)]"
                      )}
                    >
                      {label}{" "}
                      <span className="tabular-nums opacity-70">{n}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {visiblePeople.length > 0 && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={toggleAll}
                  className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors"
                >
                  {visiblePeople.length > 0 &&
                  visiblePeople.every((p) => selectedPeople.has(p.id))
                    ? "Deselect all"
                    : "Select all"}
                </button>
                <Button
                  size="sm"
                  onClick={handleImport}
                  disabled={selectedPeople.size === 0 || isImporting}
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Generating
                    </>
                  ) : channel === "linkedin" ? (
                    `Generate ${selectedPeople.size} LinkedIn message${
                      selectedPeople.size === 1 ? "" : "s"
                    }`
                  ) : (
                    `Generate ${selectedPeople.size} email${
                      selectedPeople.size === 1 ? "" : "s"
                    }`
                  )}
                </Button>
              </div>
            )}
          </div>

          {visiblePeople.length === 0 ? (
            <div className="border-t border-[var(--color-line)] py-12 text-center">
              <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)]">
                {hasDetections && resultFilter !== "all"
                  ? "No people match this filter."
                  : "Every person on this page is already in the pipeline."}
              </p>
            </div>
          ) : (
            <div>
              {visiblePeople.map((person) => {
                const isSelected = selectedPeople.has(person.id);
                const lastName = person.last_name || person.last_name_obfuscated || "";
                const orgName = person.organization?.name || "—";
                const orgDomain = person.organization?.primary_domain || person.organization?.domain || "";
                const aiDom = normalizeDomain(orgDomain);
                const ai = aiDom ? aiDetection[aiDom] : undefined;
                const headcount =
                  person.organization?.employee_count ??
                  person.organization?.organization_headcount;
                const orgLocation = [
                  person.organization?.city,
                  person.organization?.country,
                ]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <div
                    key={person.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setPreviewPerson(person)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        setPreviewPerson(person);
                      }
                      if (e.key === " ") {
                        e.preventDefault();
                        togglePerson(person.id);
                      }
                    }}
                    className={cn(
                      "group grid items-center gap-x-2 sm:gap-x-4",
                      "grid-cols-[16px_minmax(0,1.4fr)_minmax(0,1fr)]",
                      "md:grid-cols-[16px_minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,140px)]",
                      "px-3 sm:px-5 py-3 border-b border-[var(--color-line)] cursor-pointer",
                      "transition-colors duration-150",
                      "hover:bg-[var(--color-panel)]",
                      isSelected && "bg-[var(--color-panel)]"
                    )}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => togglePerson(person.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${person.first_name} ${lastName}`}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-[14px] leading-tight font-medium text-[var(--color-fg)]">
                        {person.first_name || "—"} {lastName}
                      </div>
                      <div className="mt-1 truncate font-mono text-[12px] text-[var(--color-fg-muted)]">
                        {person.title || "—"}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate text-[13px] text-[var(--color-fg)]">
                          {orgName}
                        </span>
                        {ai && (
                          <AiStatusBadge
                            hasAi={ai.hasAi}
                            confidence={ai.confidence}
                            title={ai.summary}
                            className="shrink-0"
                          />
                        )}
                      </div>
                      <div className="mt-1 truncate font-mono text-[11.5px] text-[var(--color-fg-muted)]">
                        {orgDomain || "—"}
                      </div>
                    </div>
                    <div className="hidden md:block text-right font-mono text-[11px] tabular-nums text-[var(--color-fg-muted)]">
                      {orgLocation}
                      {headcount && (
                        <span className="ml-2 text-[var(--color-fg-subtle)]">
                          {headcount.toLocaleString()}
                        </span>
                      )}
                      {person.email ? (
                        <div className="mt-1 text-[var(--color-accent)] tracking-tight">email ✓</div>
                      ) : person.has_email ? (
                        <div className="mt-1 text-[var(--color-fg-subtle)]">enrich on import</div>
                      ) : (
                        <div className="mt-1 text-[var(--color-fg-subtle)]">no email</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {pagination && (
            <div className="flex items-center justify-between pt-4">
              <span className="font-mono text-[11px] text-[var(--color-fg-muted)] tabular-nums">
                {pagination.total_entries
                  ? `${pagination.total_entries.toLocaleString()} total`
                  : null}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="iconSm"
                  onClick={() => handlePageChange(1)}
                  disabled={currentPage === 1 || isSearching || accountBusy}
                >
                  <ChevronsLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="iconSm"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1 || isSearching || accountBusy}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="px-3 font-mono text-[12px] text-[var(--color-fg)] tabular-nums">
                  {currentPage}
                  <span className="text-[var(--color-fg-subtle)]">
                    {" / "}
                    {pagination.total_pages}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="iconSm"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage >= (pagination.total_pages || 1) || isSearching || accountBusy}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="iconSm"
                  onClick={() => handlePageChange(pagination.total_pages || 1)}
                  disabled={currentPage >= (pagination.total_pages || 1) || isSearching || accountBusy}
                >
                  <ChevronsRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Detail rail */}
      <PersonDetailRail
        person={previewPerson}
        isSelected={previewPerson ? selectedPeople.has(previewPerson.id) : false}
        isAlreadyImported={false}
        onClose={() => setPreviewPerson(null)}
        onToggleSelect={() => {
          if (previewPerson) togglePerson(previewPerson.id);
        }}
      />
    </div>
  );
}

function csv(s: string): string[] | undefined {
  if (!s?.trim()) return undefined;
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}
