"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  Loader2,
  Menu,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

import { PipelineStats } from "@/components/pipeline/pipeline-stats";
import { CompanyCard } from "@/components/pipeline/company-card";
import { BatchActionBar } from "@/components/pipeline/batch-action-bar";
import { DeleteConfirmationDialog } from "@/components/pipeline/delete-confirmation-dialog";
import { SendConfirmationDialog } from "@/components/pipeline/send-confirmation-dialog";
import { BatchSendConfirmationDialog } from "@/components/pipeline/batch-send-confirmation-dialog";
import { LinkedInSendModal } from "@/components/pipeline/linkedin-send-modal";
import { EmailReviewModal } from "@/components/pipeline/email-review-modal";
import { PromptsManager } from "@/components/pipeline/prompts-manager";
import { CompanySearch } from "@/components/apollo/company-search";
import { PeopleSearch } from "@/components/apollo/people-search";
import { ClientsPage } from "@/components/clients/clients-page";
import { AutomationSection } from "@/components/settings/automation-section";
import { CampaignPanel } from "@/components/settings/campaign-panel";
import { TargetTitleManager } from "@/components/settings/target-title-manager";
import { AccountSettings } from "@/components/settings/account-settings";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { JobProgressWidget } from "@/components/layout/job-progress-widget";
import { PIPELINE_STATES, DEFAULT_SYSTEM_PROMPT } from "@/lib/constants";
import { pollJob } from "@/lib/poll-job";

type Company = {
  id: string;
  name: string;
  domain: string;
  website?: string | null;
  industry?: string | null;
  location?: string | null;
  employeeCount?: number | null;
  pipelineState: string;
  targetContactFirstName?: string | null;
  targetContactLastName?: string | null;
  targetContactEmail?: string | null;
  targetContactTitle?: string | null;
  targetContactLinkedinUrl?: string | null;
  notGeneratedReason?: any;
  email?: {
    id: string;
    channel?: string | null;
    subject?: string | null;
    body: string;
    editedSubject?: string | null;
    editedBody?: string | null;
    finalSubject?: string | null;
    finalBody?: string | null;
    sentTo?: string | null;
  } | null;
};

const TAB_LABELS: Record<string, string> = {
  dashboard: "Pipeline",
  search: "Companies",
  people: "People",
  clients: "Clients",
  automation: "Automation",
  prompts: "Prompts",
  titles: "Settings",
};

const TAB_SUBTITLES: Record<string, string> = {
  dashboard: "Review, approve, and send drafts.",
  search: "Find target companies on Apollo and import them.",
  people: "Find decision-makers directly across companies.",
  clients: "Track every contact post-send. Run follow-ups when you're ready.",
  automation: "Build your outbound schedule on the calendar, then click Run today.",
  prompts: "Edit the system prompt and the three follow-up prompts.",
  titles: "Account, API keys, email provider, sender identity, target titles.",
};

export default function Dashboard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [activeState, setActiveState] = useState<string | null>(
    PIPELINE_STATES.PENDING_REVIEW
  );

  useEffect(() => {
    const savedTab = localStorage.getItem("activeTab");
    if (savedTab) setActiveTab(savedTab);
  }, []);

  useEffect(() => {
    localStorage.setItem("activeTab", activeTab);
  }, [activeTab]);

  const [reviewingCompany, setReviewingCompany] = useState<Company | null>(null);
  const [customPrompt, setCustomPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTargetIds, setDeleteTargetIds] = useState<string[]>([]);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendingCompany, setSendingCompany] = useState<Company | null>(null);
  const [batchSendDialogOpen, setBatchSendDialogOpen] = useState(false);
  const [sendTargetIds, setSendTargetIds] = useState<string[]>([]);
  const [channelFilter, setChannelFilter] = useState<"all" | "email" | "linkedin">("all");
  const [pipelinePage, setPipelinePage] = useState(1);
  const PIPELINE_PER_PAGE = 50;
  // Single + batch LinkedIn manual-send modal targets. Drives <LinkedInSendModal>.
  const [linkedinSendTargets, setLinkedinSendTargets] = useState<Company[]>([]);
  const [linkedinModalOpen, setLinkedinModalOpen] = useState(false);

  useEffect(() => {
    setSelectedCompanyIds(new Set());
    setPipelinePage(1);
  }, [activeState, channelFilter]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch (error) {
      console.error("Logout failed:", error);
    } finally {
      setIsLoggingOut(false);
    }
  };

  const { data: meData } = useQuery({
    queryKey: ["currentUser"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
  });

  // Send fresh registrations through the onboarding flow before they see
  // an empty dashboard. The middleware can't gate this without a per-request
  // DB lookup, so we do the redirect client-side. Pre-launch accounts have
  // `onboardingCompletedAt` backfilled to their createdAt by the migration
  // script, so they skip straight through.
  useEffect(() => {
    if (!meData?.user) return;
    if (!meData.user.onboardingCompletedAt) {
      router.replace("/onboarding");
    }
  }, [meData?.user, router]);

  const { data: promptData, isLoading: isPromptLoading } = useQuery({
    queryKey: ["active-prompt"],
    queryFn: async () => {
      const res = await fetch("/api/prompts/active");
      if (!res.ok) throw new Error("Failed to fetch prompt");
      return res.json();
    },
    staleTime: 0,
  });

  useEffect(() => {
    if (promptData?.prompt?.content) setCustomPrompt(promptData.prompt.content);
  }, [promptData]);

  const savePromptMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch("/api/prompts/active", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error("Failed to save prompt");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active-prompt"] });
    },
  });

  const { data: statsData, refetch: refetchStats } = useQuery({
    queryKey: ["pipeline-stats"],
    queryFn: async () => {
      const res = await fetch("/api/pipeline/stats");
      return res.json();
    },
    staleTime: 0,
  });

  const { data: companiesData, refetch: refetchCompanies, isLoading: isLoadingCompanies } = useQuery({
    queryKey: ["companies", activeState, channelFilter, pipelinePage],
    queryFn: async () => {
      if (!activeState) return { companies: [], total: 0 };
      const url = new URL("/api/pipeline/companies", window.location.origin);
      url.searchParams.set("state", activeState);
      url.searchParams.set("channel", channelFilter);
      url.searchParams.set("limit", String(PIPELINE_PER_PAGE));
      url.searchParams.set("offset", String((pipelinePage - 1) * PIPELINE_PER_PAGE));
      const res = await fetch(url);
      return res.json();
    },
    enabled: !!activeState,
    staleTime: 0,
  });

  const saveReviewMutation = useMutation({
    mutationFn: async ({ emailId, subject, body, recipientEmail }: { emailId: string; subject: string; body: string; recipientEmail?: string }) => {
      const res = await fetch(`/api/emails/${emailId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editedSubject: subject, editedBody: body, recipientEmail }),
      });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => refetchCompanies(),
  });

  const approveMutation = useMutation({
    mutationFn: async ({ emailId, subject, body }: { emailId: string; subject?: string; body?: string }) => {
      if (subject && body) {
        await fetch(`/api/emails/${emailId}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ editedSubject: subject, editedBody: body }),
        });
      }
      const res = await fetch(`/api/emails/${emailId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Approve failed");
      return res.json();
    },
    onSuccess: () => {
      refetchCompanies();
      refetchStats();
    },
  });

  const regenerateEmailMutation = useMutation({
    mutationFn: async (companyId: string) => {
      const res = await fetch(`/api/companies/${companyId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customPrompt }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Regeneration failed");
      return data;
    },
    onSuccess: () => {
      refetchCompanies();
      refetchStats();
    },
  });

  const retryEmailMutation = useMutation({
    mutationFn: async (companyId: string) => {
      const res = await fetch(`/api/companies/${companyId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customPrompt }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Retry failed");
      return data;
    },
    onSuccess: () => {
      refetchCompanies();
      refetchStats();
    },
  });

  const resetCompanyMutation = useMutation({
    mutationFn: async (companyId: string) => {
      const res = await fetch(`/api/companies/${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineState: PIPELINE_STATES.PENDING_GENERATION,
          notGeneratedReason: null,
        }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Reset failed");
      }
      return res.json();
    },
    onSuccess: () => {
      refetchCompanies();
      refetchStats();
    },
  });

  const sendMutation = useMutation({
    mutationFn: async ({ emailId, recipientEmail, senderEmail }: { emailId: string; recipientEmail: string; senderEmail?: string }) => {
      const res = await fetch(`/api/emails/${emailId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientEmail, senderEmail }),
      });
      if (!res.ok) throw new Error("Send failed");
      return res.json();
    },
    onSuccess: () => {
      refetchCompanies();
      refetchStats();
    },
  });

  const findContactMutation = useMutation({
    mutationFn: async (companyId: string) => {
      const res = await fetch(`/api/companies/${companyId}/find-contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Contact lookup failed");
      return data;
    },
    onSuccess: () => {
      refetchCompanies();
      refetchStats();
    },
  });

  const importMutation = useMutation({
    mutationFn: async ({
      companies,
      channel,
    }: {
      companies: unknown[];
      channel?: "email" | "linkedin";
    }) => {
      const res = await fetch("/api/companies/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companies,
          customPrompt: customPrompt !== DEFAULT_SYSTEM_PROMPT ? customPrompt : undefined,
          channel: channel ?? "email",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.details || "Import failed");
      }
      const data = (await res.json()) as { jobId?: string };
      // Stay on the search page with the button in its loading state
      // until the background generation job actually finishes.
      if (data.jobId) {
        const job = await pollJob(data.jobId, undefined, {
          timeoutMs: 60 * 60 * 1000,
        });
        if (job.status === "failed") {
          throw new Error(job.error || "Generation failed");
        }
      }
      return data;
    },
    onSuccess: () => {
      setActiveTab("dashboard");
      setActiveState(PIPELINE_STATES.PENDING_REVIEW);
      refetchStats();
      queryClient.invalidateQueries({ queryKey: ["companies"] });
    },
  });

  const importPeopleMutation = useMutation({
    mutationFn: async ({
      people,
      channel,
    }: {
      people: unknown[];
      channel?: "email" | "linkedin";
    }) => {
      const res = await fetch("/api/people/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          people,
          customPrompt: customPrompt !== DEFAULT_SYSTEM_PROMPT ? customPrompt : undefined,
          channel: channel ?? "email",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.details || "Import failed");
      }
      const data = (await res.json()) as { jobId?: string };
      // Stay on the search page with the button in its loading state
      // until the background generation job actually finishes.
      if (data.jobId) {
        const job = await pollJob(data.jobId, undefined, {
          timeoutMs: 60 * 60 * 1000,
        });
        if (job.status === "failed") {
          throw new Error(job.error || "Generation failed");
        }
      }
      return data;
    },
    onSuccess: () => {
      setActiveTab("dashboard");
      setActiveState(PIPELINE_STATES.PENDING_REVIEW);
      refetchStats();
      queryClient.invalidateQueries({ queryKey: ["companies"] });
    },
  });

  const batchApproveMutation = useMutation({
    mutationFn: async (companyIds: string[]) => {
      const res = await fetch("/api/pipeline/batch-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyIds }),
      });
      if (!res.ok) throw new Error("Batch approve failed");
      return res.json();
    },
    onSuccess: (data) => {
      setSelectedCompanyIds(new Set());
      refetchStats();
      refetchCompanies();
      if (data.approved > 0) setActiveState(PIPELINE_STATES.APPROVED_TO_SEND);
    },
  });

  const batchDeleteMutation = useMutation({
    mutationFn: async ({ companyIds, alsoDeleteFromFetched }: { companyIds: string[]; alsoDeleteFromFetched: boolean }) => {
      const res = await fetch("/api/pipeline/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyIds, alsoDeleteFromFetched }),
      });
      if (!res.ok) throw new Error("Batch delete failed");
      return res.json();
    },
    onSuccess: () => {
      setSelectedCompanyIds(new Set());
      setDeleteDialogOpen(false);
      setDeleteTargetIds([]);
      refetchStats();
      refetchCompanies();
    },
  });

  const batchSendMutation = useMutation({
    mutationFn: async (companyIds: string[]) => {
      const res = await fetch("/api/pipeline/batch-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyIds }),
      });
      if (!res.ok) throw new Error("Batch send failed");
      return res.json();
    },
    onSuccess: (data) => {
      setSelectedCompanyIds(new Set());
      refetchStats();
      refetchCompanies();
      if (data.sent > 0) setActiveState(PIPELINE_STATES.SENT);
    },
  });

  const batchRetryMutation = useMutation({
    mutationFn: async (companyIds: string[]) => {
      const res = await fetch("/api/pipeline/batch-retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyIds, customPrompt }),
      });
      if (!res.ok) throw new Error("Batch retry failed");
      return res.json();
    },
    onSuccess: (data) => {
      setSelectedCompanyIds(new Set());
      refetchStats();
      refetchCompanies();
      if (data.generated > 0) setActiveState(PIPELINE_STATES.PENDING_REVIEW);
    },
  });

  const stats = statsData?.stats || {
    total: 0,
    byState: { email_not_generated: 0, pending_review: 0, approved_to_send: 0, sent: 0 },
  };

  const companies: Company[] = companiesData?.companies || [];
  const totalCompaniesAtState: number = companiesData?.total ?? companies.length;
  const totalPages = Math.max(1, Math.ceil(totalCompaniesAtState / PIPELINE_PER_PAGE));

  const selectedCompanies: Company[] = companies.filter((c) =>
    selectedCompanyIds.has(c.id)
  );
  const selectedChannels = new Set(
    selectedCompanies.map((c) => (c.email?.channel || "email") as "email" | "linkedin")
  );
  const isMixedChannelSelection =
    selectedChannels.has("email") && selectedChannels.has("linkedin");
  const isLinkedInOnlySelection =
    selectedChannels.size === 1 && selectedChannels.has("linkedin");

  const handleStateClick = (state: string) => {
    setActiveState(state === activeState ? null : state);
  };

  const toggleSelection = (companyId: string) => {
    setSelectedCompanyIds((prev) => {
      const next = new Set(prev);
      next.has(companyId) ? next.delete(companyId) : next.add(companyId);
      return next;
    });
  };
  const selectAll = () => setSelectedCompanyIds(new Set(companies.map((c) => c.id)));
  const clearSelection = () => setSelectedCompanyIds(new Set());

  const allSelected = selectedCompanyIds.size > 0 && selectedCompanyIds.size === companies.length;

  // Sidebar now owns logout — keep refs alive to avoid unused-var TS warnings.
  void handleLogout;
  void isLoggingOut;

  return (
    <div className="min-h-dvh flex bg-[var(--color-canvas)]">
      <AppSidebar
        active={activeTab}
        onSelect={setActiveTab}
        pendingReviewCount={stats.byState?.pending_review}
        mobileOpen={sidebarOpen}
        onMobileOpenChange={setSidebarOpen}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Page header */}
        <header className="sticky top-0 z-20 border-b border-[var(--color-line-soft)] bg-[var(--color-canvas)]/95 backdrop-blur-sm">
          <div className="px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-3 sm:gap-6">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden -ml-1 p-1.5 rounded-md text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-raised)] transition-colors duration-150 shrink-0"
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <h1 className="text-[17px] sm:text-[20px] font-semibold tracking-tight text-[var(--color-fg)] leading-tight truncate">
                  {TAB_LABELS[activeTab] ?? "—"}
                </h1>
                <p className="mt-0.5 text-[12px] sm:text-[13px] text-[var(--color-fg-muted)] truncate">
                  {TAB_SUBTITLES[activeTab] || ""}
                </p>
              </div>
            </div>
            {meData?.user?.email && (
              <span className="hidden md:inline text-[12px] text-[var(--color-fg-subtle)] truncate">
                {meData.user.email}
              </span>
            )}
          </div>
        </header>

        <main className="flex-1 min-w-0 pb-24 overflow-x-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          {/* Pipeline */}
          <TabsContent value="dashboard">
            <PipelineStats
              stats={stats}
              onStateClick={handleStateClick}
              activeState={activeState || undefined}
            />

            {activeState ? (
              <section>
                <div className="px-4 sm:px-6 lg:px-8 pt-8 pb-5 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight text-[var(--color-fg)]">
                      {prettyState(activeState)}
                    </h2>
                    <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
                      {totalCompaniesAtState}{" "}
                      {totalCompaniesAtState === 1 ? "company" : "companies"}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Channel filter — all / email / linkedin */}
                    <div
                      role="radiogroup"
                      aria-label="Channel filter"
                      className="inline-flex w-fit overflow-hidden rounded-md border border-[var(--color-line)]"
                    >
                      {(
                        [
                          ["all", "All"],
                          ["email", "Email"],
                          ["linkedin", "LinkedIn"],
                        ] as const
                      ).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          role="radio"
                          aria-checked={channelFilter === key}
                          onClick={() => setChannelFilter(key)}
                          className={
                            "inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] leading-none transition-colors px-3 py-1.5 border-l border-[var(--color-line)] first:border-l-0 " +
                            (channelFilter === key
                              ? "bg-[var(--color-accent)]/12 text-[var(--color-accent)]"
                              : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-panel)]")
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {companies.length > 0 && (
                      <button
                        type="button"
                        onClick={allSelected ? clearSelection : selectAll}
                        className="text-sm text-muted-foreground hover:text-[var(--color-fg)] transition-colors duration-150"
                      >
                        {allSelected ? "Deselect all" : "Select all"}
                      </button>
                    )}
                  </div>
                </div>

                {isLoadingCompanies ? (
                  <div className="px-4 sm:px-6 lg:px-8 py-12 flex items-center gap-3 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading…
                  </div>
                ) : companies.length === 0 ? (
                  <EmptyRow state={activeState} />
                ) : (
                  <>
                  <div className="mx-4 sm:mx-6 lg:mx-8 rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] overflow-hidden shadow-sm divide-y divide-[var(--color-line-soft)]">
                    {companies.map((company) => (
                      <CompanyCard
                        key={company.id}
                        company={company}
                        isSelected={selectedCompanyIds.has(company.id)}
                        onSelect={toggleSelection}
                        onFindContact={async (id) => {
                          await findContactMutation.mutateAsync(id);
                        }}
                        onReview={(id) => {
                          const c = companies.find((c) => c.id === id);
                          if (c) setReviewingCompany(c);
                        }}
                        onApprove={async (id) => {
                          const c = companies.find((c) => c.id === id);
                          if (c?.email) await approveMutation.mutateAsync({ emailId: c.email.id });
                        }}
                        onSend={(id) => {
                          const c = companies.find((c) => c.id === id);
                          if (!c) return;
                          if ((c.email?.channel || "email") === "linkedin") {
                            setLinkedinSendTargets([c]);
                            setLinkedinModalOpen(true);
                          } else {
                            setSendingCompany(c);
                            setSendDialogOpen(true);
                          }
                        }}
                        onRetry={async (id) => {
                          await retryEmailMutation.mutateAsync(id);
                        }}
                        onReset={async (id) => {
                          await resetCompanyMutation.mutateAsync(id);
                        }}
                      />
                    ))}
                  </div>
                  {totalCompaniesAtState > PIPELINE_PER_PAGE && (
                    <div className="mx-4 sm:mx-6 lg:mx-8 mt-4 flex items-center justify-between gap-3 font-mono text-[11px] text-[var(--color-fg-muted)]">
                      <span className="tabular-nums">
                        {(pipelinePage - 1) * PIPELINE_PER_PAGE + 1}
                        {"–"}
                        {Math.min(pipelinePage * PIPELINE_PER_PAGE, totalCompaniesAtState)}
                        {" of "}
                        {totalCompaniesAtState}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setPipelinePage(1)}
                          disabled={pipelinePage <= 1}
                          className="p-1 rounded hover:bg-[var(--color-panel)] disabled:opacity-30 disabled:cursor-not-allowed"
                          aria-label="First page"
                        >
                          <ChevronsLeft className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPipelinePage((p) => Math.max(1, p - 1))}
                          disabled={pipelinePage <= 1}
                          className="p-1 rounded hover:bg-[var(--color-panel)] disabled:opacity-30 disabled:cursor-not-allowed"
                          aria-label="Previous page"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <span className="tabular-nums px-2">
                          page {pipelinePage} / {totalPages}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPipelinePage((p) => Math.min(totalPages, p + 1))}
                          disabled={pipelinePage >= totalPages}
                          className="p-1 rounded hover:bg-[var(--color-panel)] disabled:opacity-30 disabled:cursor-not-allowed"
                          aria-label="Next page"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPipelinePage(totalPages)}
                          disabled={pipelinePage >= totalPages}
                          className="p-1 rounded hover:bg-[var(--color-panel)] disabled:opacity-30 disabled:cursor-not-allowed"
                          aria-label="Last page"
                        >
                          <ChevronsRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                  </>
                )}
              </section>
            ) : (
              <div className="px-4 sm:px-6 lg:px-8 pt-12">
                <p className="text-sm text-muted-foreground">
                  Pick a state above to view companies.
                </p>
              </div>
            )}
          </TabsContent>

          {/* Companies */}
          <TabsContent value="search">
            <div className="px-4 sm:px-6 pt-8">
              <CompanySearch
                onImport={async (cs, opts) => {
                  await importMutation.mutateAsync({ companies: cs, channel: opts?.channel });
                }}
              />
            </div>
          </TabsContent>

          {/* People */}
          <TabsContent value="people">
            <div className="px-4 sm:px-6 pt-8">
              <PeopleSearch
                onImport={async (ps, opts) => {
                  await importPeopleMutation.mutateAsync({ people: ps, channel: opts?.channel });
                }}
              />
            </div>
          </TabsContent>

          {/* Clients */}
          <TabsContent value="clients">
            <div className="px-4 sm:px-6 pt-8">
              <ClientsPage />
            </div>
          </TabsContent>

          {/* Automation — calendar-first flow: how it works, today, calendar, recipes, options. */}
          <TabsContent value="automation">
            <div className="px-4 sm:px-6 lg:px-8 pt-8 pb-16 max-w-[1100px] space-y-10">
              {/* How-it-works explainer */}
              <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] p-6 shadow-sm">
                <h2 className="text-base font-semibold tracking-tight text-[var(--color-fg)]">
                  How automation works
                </h2>
                <ol className="mt-4 space-y-3">
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-xs font-semibold text-[var(--color-accent)]">
                      1
                    </span>
                    <p className="text-sm text-[var(--color-fg-muted)]">
                      <strong className="text-[var(--color-fg)]">Plan your days.</strong>{" "}
                      Click any day on the calendar below to add a card.
                      Each card pins a recipe (who to target) and a daily
                      cap. A single day can hold one email card, one LinkedIn
                      card, or both — they run independently.
                    </p>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-xs font-semibold text-[var(--color-accent)]">
                      2
                    </span>
                    <p className="text-sm text-[var(--color-fg-muted)]">
                      <strong className="text-[var(--color-fg)]">Click Run today.</strong>{" "}
                      Imports contacts matching today's recipe(s) and drafts a
                      personalized message for each — an email body for email
                      recipes, a short DM for LinkedIn recipes. By default
                      every draft waits in Pipeline → Pending review.
                    </p>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-xs font-semibold text-[var(--color-accent)]">
                      3
                    </span>
                    <p className="text-sm text-[var(--color-fg-muted)]">
                      <strong className="text-[var(--color-fg)]">Review and send</strong>{" "}
                      from the Pipeline tab. Emails fire via SMTP on approve —
                      auto-send is available behind the switch below.
                      LinkedIn messages always wait for your manual paste from
                      the LinkedIn modal; auto-send never touches them.
                    </p>
                  </li>
                </ol>
              </div>

              {/* Today + calendar + recipes (CampaignPanel) */}
              <CampaignPanel />

              {/* Auto-progression options */}
              <section>
                <div className="mb-4">
                  <h2 className="text-lg font-semibold tracking-tight text-[var(--color-fg)]">
                    Automation level
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Decide what runs automatically after Run today. All
                    optional — leave them off if you want to review every
                    email.
                  </p>
                </div>
                <AutomationSection />
              </section>
            </div>
          </TabsContent>

          {/* Prompts (initial + 3 follow-ups) */}
          <TabsContent value="prompts">
            <div className="px-4 sm:px-6 pt-8">
              <PromptsManager />
            </div>
          </TabsContent>

          {/* Settings */}
          <TabsContent value="titles">
            <div className="px-4 sm:px-6 pt-8 pb-16">
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-x-12 gap-y-12">
                <div className="min-w-0">
                  <AccountSettings />
                </div>
                <aside className="min-w-0">
                  <TargetTitleManager />
                </aside>
              </div>
            </div>
          </TabsContent>
        </Tabs>
        </main>
      </div>

      {/* Modals + rails (root level so they don't get clipped by the main column) */}
      <EmailReviewModal
        isOpen={!!reviewingCompany}
        onClose={() => setReviewingCompany(null)}
        company={reviewingCompany}
        onSave={async (emailId, subject, body, recipientEmail) => {
          await saveReviewMutation.mutateAsync({ emailId, subject, body, recipientEmail });
        }}
        onApprove={async (emailId, subject, body) => {
          await approveMutation.mutateAsync({ emailId, subject, body });
        }}
        onSend={async (emailId, recipientEmail, senderEmail, subject, body) => {
          await saveReviewMutation.mutateAsync({ emailId, subject, body, recipientEmail });
          await sendMutation.mutateAsync({ emailId, recipientEmail, senderEmail });
        }}
        onMarkLinkedInSent={async (companyId) => {
          const c =
            reviewingCompany && reviewingCompany.id === companyId
              ? reviewingCompany
              : companies.find((c) => c.id === companyId);
          if (c?.targetContactLinkedinUrl) {
            window.open(c.targetContactLinkedinUrl, "_blank", "noopener,noreferrer");
          }
          const res = await fetch("/api/pipeline/batch-mark-sent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ companyIds: [companyId] }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "Failed to mark sent");
          }
          refetchCompanies();
          refetchStats();
          setActiveState(PIPELINE_STATES.SENT);
        }}
        onRegenerate={async (companyId) => {
          const wasApproved = reviewingCompany?.pipelineState === PIPELINE_STATES.APPROVED_TO_SEND;
          await regenerateEmailMutation.mutateAsync(companyId);
          if (wasApproved) setActiveState(PIPELINE_STATES.PENDING_REVIEW);
        }}
      />

      <SendConfirmationDialog
        isOpen={sendDialogOpen}
        onClose={() => {
          setSendDialogOpen(false);
          setSendingCompany(null);
        }}
        company={sendingCompany}
        onConfirm={async (recipientEmail, senderEmail) => {
          if (sendingCompany?.email) {
            await sendMutation.mutateAsync({
              emailId: sendingCompany.email.id,
              recipientEmail,
              senderEmail,
            });
            setSendDialogOpen(false);
            setSendingCompany(null);
          }
        }}
        isLoading={sendMutation.isPending}
      />

      <BatchActionBar
        selectedCount={selectedCompanyIds.size}
        totalCount={companies.length}
        pipelineState={activeState}
        onApprove={() => batchApproveMutation.mutate([...selectedCompanyIds])}
        onDelete={() => {
          setDeleteTargetIds([...selectedCompanyIds]);
          setDeleteDialogOpen(true);
        }}
        onSend={() => {
          if (isLinkedInOnlySelection) {
            setLinkedinSendTargets(selectedCompanies);
            setLinkedinModalOpen(true);
          } else {
            setSendTargetIds([...selectedCompanyIds]);
            setBatchSendDialogOpen(true);
          }
        }}
        onRetry={() => batchRetryMutation.mutate([...selectedCompanyIds])}
        onClear={clearSelection}
        isLoading={{
          approve: batchApproveMutation.isPending,
          delete: batchDeleteMutation.isPending,
          send: batchSendMutation.isPending,
          retry: batchRetryMutation.isPending,
        }}
        sendLabel={
          isLinkedInOnlySelection
            ? `Open LinkedIn ${selectedCompanyIds.size}`
            : undefined
        }
        sendDisabled={isMixedChannelSelection}
        sendDisabledReason={
          isMixedChannelSelection
            ? "Email and LinkedIn must be sent separately"
            : undefined
        }
      />

      <DeleteConfirmationDialog
        isOpen={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false);
          setDeleteTargetIds([]);
        }}
        onConfirm={async (alsoDeleteFromFetched) => {
          await batchDeleteMutation.mutateAsync({
            companyIds: deleteTargetIds,
            alsoDeleteFromFetched,
          });
        }}
        count={deleteTargetIds.length}
        isLoading={batchDeleteMutation.isPending}
      />

      <BatchSendConfirmationDialog
        isOpen={batchSendDialogOpen}
        onClose={() => {
          setBatchSendDialogOpen(false);
          setSendTargetIds([]);
        }}
        onConfirm={async () => {
          await batchSendMutation.mutateAsync(sendTargetIds);
          setBatchSendDialogOpen(false);
          setSendTargetIds([]);
        }}
        count={sendTargetIds.length}
        isLoading={batchSendMutation.isPending}
      />

      <LinkedInSendModal
        isOpen={linkedinModalOpen}
        onClose={() => {
          setLinkedinModalOpen(false);
          setLinkedinSendTargets([]);
        }}
        rows={linkedinSendTargets.map((c) => ({
          id: c.id,
          contactName:
            [c.targetContactFirstName, c.targetContactLastName].filter(Boolean).join(" ") ||
            "Contact",
          subline:
            [c.targetContactTitle, c.name].filter(Boolean).join(" · ") || c.name,
          linkedinUrl: c.targetContactLinkedinUrl ?? null,
          message: c.email?.finalBody || c.email?.editedBody || c.email?.body || "",
        }))}
        source="pipeline"
        onSuccess={() => {
          setSelectedCompanyIds(new Set());
          refetchStats();
          refetchCompanies();
          setActiveState(PIPELINE_STATES.SENT);
        }}
      />

      {/* Global progress widget — fixed bottom-right, surfaces in-flight work */}
      <JobProgressWidget />
    </div>
  );
}

function prettyState(state: string): string {
  switch (state) {
    case PIPELINE_STATES.PENDING_GENERATION:
      return "Pending generation";
    case PIPELINE_STATES.EMAIL_NOT_GENERATED:
      return "Generation failed";
    case PIPELINE_STATES.PENDING_REVIEW:
      return "Pending review";
    case PIPELINE_STATES.APPROVED_TO_SEND:
      return "Approved to send";
    case PIPELINE_STATES.SENT:
      return "Sent";
    default:
      return state;
  }
}

function EmptyRow({ state }: { state: string }) {
  const message = (() => {
    switch (state) {
      case PIPELINE_STATES.PENDING_REVIEW:
        return "Nothing to review.";
      case PIPELINE_STATES.APPROVED_TO_SEND:
        return "Nothing approved.";
      case PIPELINE_STATES.SENT:
        return "Nothing sent yet.";
      case PIPELINE_STATES.EMAIL_NOT_GENERATED:
        return "No failed drafts.";
      default:
        return "Nothing here.";
    }
  })();
  return (
    <div className="mx-4 sm:mx-6 lg:mx-8 rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] py-16 px-6 text-center shadow-sm">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
