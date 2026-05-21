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
import { useCompanySearchStore, ApolloCompany } from "@/store/company-search-store";
import { cn } from "@/lib/utils";
import { pollJob } from "@/lib/poll-job";
import { CompanyDetailRail } from "@/components/apollo/company-detail-rail";
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
  /**
   * When aiFilter is 'no_ai' or 'has_ai', the import flow page-walks Apollo
   * with these filters rather than using the (possibly empty) selection list.
   */
  searchFilters?: Record<string, unknown>;
  /** How many matches to accumulate. Only used in page-walk mode. */
  target?: number;
  /** Outreach channel for the generated drafts. Defaults to 'email'. */
  channel?: ChannelValue;
}

interface CompanySearchProps {
  onImport: (companies: ApolloCompany[], opts?: ImportOptions) => Promise<void>;
}

/*
 * Lead search. Top filter row stays tight (5 fields + a Search button on a
 * single line at lg). Results render as the same dense-row pattern used by
 * the pipeline. Pagination is mono and inline at the bottom.
 */
/**
 * Apollo gates funding-range, technology-UID, and job-title filters behind
 * its paid plan. Hitting them on the free tier returns HTTP 422.
 * This is a static notice rendered inside the advanced "Signals" panel.
 */
function PremiumNotice({ scope }: { scope: "company" | "people" }) {
  const fields =
    scope === "company"
      ? "Funding date, funding round size, tech stack, and hiring-for"
      : "Funding date, funding round size, tech stack, hiring-for, and verified-email-only";
  return (
    <div className="border-l-2 border-[var(--color-accent)] bg-[var(--color-panel)]/60 px-4 py-3">
      <p className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-accent)] mb-1.5">
        Apollo Basic required ($59/mo)
      </p>
      <p className="text-[12.5px] leading-relaxed text-[var(--color-fg-muted)]">
        {fields} filters are gated to paid plans. On the free tier these return
        a 422 error and the search will fail.{" "}
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

export function CompanySearch({ onImport }: CompanySearchProps) {
  const {
    filters,
    setFilters,
    currentPage,
    setCurrentPage,
    pagination,
    selectedCompanies,
    toggleCompany,
    selectAll,
    clearSelection,
    isSearching,
    setIsSearching,
    error,
    setError,
    setSearchResults,
    getDisplayableCompanies,
    markCompaniesAsGenerated,
    isHydrated,
    aiDetection,
    setAiDetectionBatch,
    clearAiDetection,
    channel,
    setChannel,
  } = useCompanySearchStore();

  // A search / generation / automation job already in flight disables
  // search + paging (the API also hard-blocks with 409).
  const { busy: accountBusy } = useAccountBusy();

  const [isImporting, setIsImporting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [previewCompany, setPreviewCompany] = useState<ApolloCompany | null>(null);
  // Client-side filter over the returned rows by AI verdict. Only useful
  // after an AI-gated search (which attaches per-domain detections).
  const [resultFilter, setResultFilter] = useState<
    "all" | "has_ai" | "no_ai" | "unknown"
  >("all");
  const displayableCompanies = getDisplayableCompanies();

  const aiBucket = (c: ApolloCompany): "has_ai" | "no_ai" | "unknown" => {
    const dom = normalizeDomain(c.domain || c.primary_domain);
    const ai = dom ? aiDetection[dom] : undefined;
    if (!ai || ai.confidence === "unknown") return "unknown";
    if (ai.confidence === "confirmed_has_ai") return "has_ai";
    return "no_ai"; // probably_no_ai | definitely_no_ai
  };
  const hasDetections = Object.keys(aiDetection).length > 0;
  const aiCounts = hasDetections
    ? displayableCompanies.reduce(
        (acc, c) => {
          acc[aiBucket(c)]++;
          return acc;
        },
        { has_ai: 0, no_ai: 0, unknown: 0 } as Record<string, number>
      )
    : null;
  const visibleCompanies =
    !hasDetections || resultFilter === "all"
      ? displayableCompanies
      : displayableCompanies.filter((c) => aiBucket(c) === resultFilter);

  const buildApolloFiltersBody = () => ({
    locations: filters.locations?.trim()
      ? filters.locations.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined,
    employeeCountMin: filters.employeeCountMin?.trim()
      ? parseInt(filters.employeeCountMin)
      : undefined,
    employeeCountMax: filters.employeeCountMax?.trim()
      ? parseInt(filters.employeeCountMax)
      : undefined,
    industries: filters.industries?.trim()
      ? filters.industries.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined,
    keywords: filters.keywords?.trim()
      ? filters.keywords.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined,
    jobTitles: filters.jobTitles?.trim()
      ? filters.jobTitles.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined,
    technologies: filters.technologies?.trim()
      ? filters.technologies
          .split(",")
          .map((s) => s.trim().toLowerCase().replace(/[.\s]/g, "_"))
          .filter(Boolean)
      : undefined,
    fundingDateMin: filters.fundingDateMin?.trim() || undefined,
    fundingDateMax: filters.fundingDateMax?.trim() || undefined,
    fundingAmountMin: filters.fundingAmountMin?.trim()
      ? parseInt(filters.fundingAmountMin)
      : undefined,
    fundingAmountMax: filters.fundingAmountMax?.trim()
      ? parseInt(filters.fundingAmountMax)
      : undefined,
  });

  const applyAiDetections = (
    aiDetections: unknown
  ): void => {
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

  const handleSearch = async (page: number = 1) => {
    setIsSearching(true);
    setError(null);
    // Clear stale results + AI badges the moment a new search starts so the
    // user never sees the previous list while the new one is in flight.
    setSearchResults([], null);
    clearSelection();
    clearAiDetection();
    try {
      const response = await fetch("/api/companies/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters: buildApolloFiltersBody(),
          page,
          perPage: 50,
          aiFilter: filters.aiFilter !== "any" ? filters.aiFilter : undefined,
          target: filters.aiFilter !== "any" ? 10 : undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Search failed");
        setSearchResults([], null);
        return;
      }

      // ── Async path: AI-gated searches now dispatch to Inngest. Poll
      // /api/jobs/[id] until it completes, then read matches from metadata.
      if (data.mode === "ai_gated_queued" && data.jobId) {
        const jobId = data.jobId as string;
        const finalJob = await pollJob(jobId, (running) => {
          // Optional: surface in-progress count from currentLabel; ignored
          // here for simplicity — the global jobs widget already shows it.
          void running;
        });
        if (finalJob.status === "failed") {
          setError(finalJob.error || "AI search failed");
          setSearchResults([], null);
          return;
        }
        const meta = finalJob.metadata as
          | { checked?: unknown[]; aiDetections?: unknown }
          | null;
        const checked = (meta?.checked as typeof displayableCompanies) || [];
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

      // ── Sync path (no AI filter): preserved as before.
      setSearchResults(data.companies || [], data.pagination || null);
      setCurrentPage(data.pagination?.page || page);
      clearSelection();
      applyAiDetections(data.aiDetections);
    } catch (err) {
      console.error(err);
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
    // Select-all acts on the currently-visible (filtered) rows.
    const allVisibleSelected =
      visibleCompanies.length > 0 &&
      visibleCompanies.every((c) => selectedCompanies.has(c.id));
    if (allVisibleSelected) {
      clearSelection();
    } else {
      selectAll(visibleCompanies.map((c) => c.id));
    }
  };

  const handleImport = async () => {
    const selected = displayableCompanies.filter((c) => selectedCompanies.has(c.id));
    if (selected.length === 0) return;
    setIsImporting(true);
    try {
      const orgIds = selected.map((c) => c.organization_id || c.id);
      markCompaniesAsGenerated(orgIds);
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
          Lead search
        </h1>
        <div className="ml-auto self-center">
          <ChannelToggle
            value={channel}
            onChange={setChannel}
            disabled={isImporting || accountBusy}
          />
        </div>
      </div>

      {/* Filters — basic row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-x-6 gap-y-6">
        <div className="space-y-2 col-span-2 lg:col-span-1">
          <Label htmlFor="locations">Locations</Label>
          <Input
            id="locations"
            value={filters.locations}
            onChange={(e) => setFilters({ locations: e.target.value })}
            placeholder="United States, Berlin"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="employeeMin">Min headcount</Label>
          <Input
            id="employeeMin"
            type="number"
            value={filters.employeeCountMin}
            onChange={(e) => setFilters({ employeeCountMin: e.target.value })}
            className="font-mono text-[13px]"
            placeholder="11"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="employeeMax">Max headcount</Label>
          <Input
            id="employeeMax"
            type="number"
            value={filters.employeeCountMax}
            onChange={(e) => setFilters({ employeeCountMax: e.target.value })}
            className="font-mono text-[13px]"
            placeholder="200"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="industries">Industries</Label>
          <Input
            id="industries"
            value={filters.industries}
            onChange={(e) => setFilters({ industries: e.target.value })}
            placeholder="SaaS, Fintech"
          />
        </div>
        <div className="space-y-2 col-span-2 lg:col-span-1">
          <Label htmlFor="keywords">Keywords</Label>
          <Input
            id="keywords"
            value={filters.keywords}
            onChange={(e) => setFilters({ keywords: e.target.value })}
            placeholder="AI, agents"
          />
        </div>
      </div>

      {/* Filters — advanced (collapsible) */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="font-mono text-[11px] uppercase tracking-[0.10em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors inline-flex items-center gap-1.5"
        >
          {showAdvanced ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          Signals — funding · hiring · tech stack
        </button>

        {showAdvanced && (
          <div className="mt-5 space-y-6 border-l border-[var(--color-line)] pl-5">
            <PremiumNotice scope="company" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-6">
              <div className="space-y-2">
                <Label htmlFor="fundingDateMin">Funding date from</Label>
                <Input
                  id="fundingDateMin"
                  type="date"
                  value={filters.fundingDateMin}
                  onChange={(e) => setFilters({ fundingDateMin: e.target.value })}
                  className="font-mono text-[12px]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fundingDateMax">Funding date to</Label>
                <Input
                  id="fundingDateMax"
                  type="date"
                  value={filters.fundingDateMax}
                  onChange={(e) => setFilters({ fundingDateMax: e.target.value })}
                  className="font-mono text-[12px]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fundingAmountMin">Min round (USD)</Label>
                <Input
                  id="fundingAmountMin"
                  type="number"
                  value={filters.fundingAmountMin}
                  onChange={(e) => setFilters({ fundingAmountMin: e.target.value })}
                  className="font-mono text-[12px]"
                  placeholder="5000000"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fundingAmountMax">Max round (USD)</Label>
                <Input
                  id="fundingAmountMax"
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
                <Label htmlFor="jobTitles">Hiring for (job titles)</Label>
                <Input
                  id="jobTitles"
                  value={filters.jobTitles}
                  onChange={(e) => setFilters({ jobTitles: e.target.value })}
                  placeholder="AI Engineer, ML Engineer, Head of AI"
                />
                <p className="font-mono text-[10.5px] text-[var(--color-fg-subtle)]">
                  Companies with at least one matching open role. Budget signal.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="technologies">Tech stack</Label>
                <Input
                  id="technologies"
                  value={filters.technologies}
                  onChange={(e) => setFilters({ technologies: e.target.value })}
                  placeholder="openai, anthropic, langchain, pinecone"
                  className="font-mono text-[13px]"
                />
                <p className="font-mono text-[10.5px] text-[var(--color-fg-subtle)]">
                  Apollo UIDs (lowercase, underscores). Fit signal.
                </p>
              </div>
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
              ? "Search runs page-walk + cheap AI check, returns up to 10 NEW companies WITHOUT AI. Skips orgs already in your pipeline; cache hits are free. Cap: 100 fresh Gemini calls."
              : "Same flow, but returns only NEW companies that ALREADY use AI."
          }
        />
        {error && (
          <span className="text-[13px] text-[var(--color-status-error)]">{error}</span>
        )}
      </div>

      {/* Results — same table for any/no_ai/has_ai. AI-gated searches return
          up to 50 matches in a single page; rows get AI badges from the
          aiDetections map the search route attached. */}
      {isHydrated && pagination && (
        <div>
          <div className="flex items-baseline justify-between border-b border-[var(--color-line)] pb-3 mb-0">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)]">
                Results
              </span>
              <span className="font-mono text-[12px] tabular-nums text-[var(--color-fg)]">
                {visibleCompanies.length}
                <span className="text-[var(--color-fg-subtle)]">
                  {" / "}
                  {(pagination?.total_entries || displayableCompanies.length).toLocaleString()}
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
                      ["all", "All", displayableCompanies.length],
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
            {visibleCompanies.length > 0 && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={toggleAll}
                  className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors"
                >
                  {visibleCompanies.length > 0 &&
                  visibleCompanies.every((c) => selectedCompanies.has(c.id))
                    ? "Deselect all"
                    : "Select all"}
                </button>
                <Button
                  size="sm"
                  onClick={handleImport}
                  disabled={selectedCompanies.size === 0 || isImporting}
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Generating
                    </>
                  ) : channel === "linkedin" ? (
                    `Generate ${selectedCompanies.size} LinkedIn message${
                      selectedCompanies.size === 1 ? "" : "s"
                    }`
                  ) : (
                    `Generate ${selectedCompanies.size} email${
                      selectedCompanies.size === 1 ? "" : "s"
                    }`
                  )}
                </Button>
              </div>
            )}
          </div>

          {visibleCompanies.length === 0 ? (
            <div className="border-t border-[var(--color-line)] py-12 text-center">
              <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)]">
                {hasDetections && resultFilter !== "all"
                  ? "No companies match this filter."
                  : "Every company on this page is already imported."}
              </p>
            </div>
          ) : (
            <div>
              {visibleCompanies.map((company) => {
                const isSelected = selectedCompanies.has(company.id);
                const dom = normalizeDomain(company.domain || company.primary_domain);
                const ai = dom ? aiDetection[dom] : undefined;
                return (
                  <div
                    key={company.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setPreviewCompany(company)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        setPreviewCompany(company);
                      }
                      if (e.key === " ") {
                        e.preventDefault();
                        toggleCompany(company.id);
                      }
                    }}
                    className={cn(
                      "group grid items-center gap-x-2 sm:gap-x-4",
                      "grid-cols-[16px_minmax(0,1fr)]",
                      "sm:grid-cols-[16px_minmax(0,1fr)_minmax(0,140px)]",
                      "md:grid-cols-[16px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,140px)]",
                      "px-3 sm:px-5 py-3 border-b border-[var(--color-line)] cursor-pointer",
                      "transition-colors duration-150",
                      "hover:bg-[var(--color-panel)]",
                      isSelected && "bg-[var(--color-panel)]"
                    )}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleCompany(company.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${company.name}`}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate text-[14px] leading-tight font-medium text-[var(--color-fg)]">
                          {company.name}
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
                      <div className="mt-1 truncate font-mono text-[12px] text-[var(--color-fg-muted)]">
                        {company.domain || company.primary_domain || "—"}
                      </div>
                    </div>
                    <div className="hidden md:block min-w-0 truncate text-[12px] text-[var(--color-fg-muted)]">
                      {company.industry || "—"}
                    </div>
                    <div className="hidden sm:block text-right font-mono text-[11px] tabular-nums text-[var(--color-fg-muted)]">
                      {[company.city, company.country].filter(Boolean).join(", ") || ""}
                      {company.employee_count && (
                        <span className="ml-2 text-[var(--color-fg-subtle)]">
                          {company.employee_count.toLocaleString()}
                        </span>
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
      <CompanyDetailRail
        company={previewCompany}
        isSelected={previewCompany ? selectedCompanies.has(previewCompany.id) : false}
        isAlreadyImported={false}
        onClose={() => setPreviewCompany(null)}
        onToggleSelect={() => {
          if (previewCompany) toggleCompany(previewCompany.id);
        }}
      />
    </div>
  );
}
