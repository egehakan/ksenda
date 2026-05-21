"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AutomationSettings {
  autoImportEnabled: boolean;
  autoApproveInitialDrafts: boolean;
  autoSendApprovedEmails: boolean;
  autoGenerateFollowUps: boolean;
  autoApproveFollowUps: boolean;
  dailyImportCap: number;
  dailySendCap: number;
  automationWindowStartHour: number;
  automationWindowEndHour: number;
  automationTimezone: string;
  savedSearchKind: "companies" | "people" | null;
  savedSearchFilters: Record<string, unknown> | null;
  automationLastRunAt: string | null;
  automationLastRunSummary: string | null;
}

interface RunResult {
  ran: boolean;
  skippedReason?: string;
  importedCount: number;
  generatedFollowUpCount: number;
  approvedExistingDrafts: number;
  sentInitial: number;
  sentFollowUp: number;
  errors: Array<{ stage: string; detail: string }>;
}

/**
 * Automation page content. Conventional shadcn layout: Card-grouped sections,
 * standard labels, switch toggles, normal form inputs. Five toggles for
 * hands-off operation; default state is review-first.
 */
export function AutomationSection() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AutomationSettings | null>(null);
  const [filtersText, setFiltersText] = useState<string>("");
  const [filtersError, setFiltersError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["automation-settings"],
    queryFn: async () => {
      const res = await fetch("/api/automation/settings");
      if (!res.ok) throw new Error("Failed to load");
      return res.json() as Promise<{ settings: AutomationSettings }>;
    },
    staleTime: 0,
  });

  useEffect(() => {
    if (data === undefined) return;
    if (form !== null) return;
    setForm(data.settings);
    setFiltersText(
      data.settings.savedSearchFilters
        ? JSON.stringify(data.settings.savedSearchFilters, null, 2)
        : ""
    );
  }, [data, form]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form) return;
      let parsedFilters: Record<string, unknown> | null = null;
      if (filtersText.trim()) {
        try {
          parsedFilters = JSON.parse(filtersText);
        } catch {
          throw new Error("Saved-search filters: invalid JSON");
        }
      }
      const payload = { ...form, savedSearchFilters: parsedFilters };
      const res = await fetch("/api/automation/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automation-settings"] });
      setFiltersError(null);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2400);
    },
    onError: (e: any) => {
      setFiltersError(e?.message || "Save failed");
    },
  });

  // The Run button moved to the Campaign panel's Today card. The "Last run"
  // summary below pulls from form.automationLastRunSummary which the
  // orchestrator persists on every run regardless of which UI button fired it.
  void setLastRun;
  void lastRun;

  if (isLoading || form === null) {
    return (
      <div className="flex items-center gap-3 py-12 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading automation settings…
      </div>
    );
  }

  const set = <K extends keyof AutomationSettings>(
    k: K,
    v: AutomationSettings[K]
  ) => setForm((p) => (p ? { ...p, [k]: v } : p));

  return (
    <div className="space-y-6">
      {/* Auto-progression toggles */}
      <Card>
        <CardHeader>
          <CardTitle>What runs automatically when you click Run today</CardTitle>
          <CardDescription>
            <strong>Run today</strong> (on the Today card above) always
            imports contacts and generates messages — emails for email
            recipes, LinkedIn DMs for LinkedIn recipes. These switches decide
            what happens <em>after</em> generation. All off by default = you
            review every draft before send. LinkedIn drafts are never auto-
            sent regardless of these switches; you paste them manually.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            checked={form.autoApproveInitialDrafts}
            onChange={(v) => set("autoApproveInitialDrafts", v)}
            title="Auto-approve new email drafts"
            subtitle="OFF (default): each generated email waits in Pipeline → Pending review for your approval. ON: emails are auto-approved and queued for sending."
          />
          <ToggleRow
            checked={form.autoSendApprovedEmails}
            onChange={(v) => set("autoSendApprovedEmails", v)}
            title="Auto-send approved emails"
            subtitle="OFF (default): you click Send in Pipeline for each approved email. ON: approved emails fire automatically inside the working-hours window. LinkedIn messages are excluded — they always wait for your manual paste from the LinkedIn modal."
          />
          <ToggleRow
            checked={form.autoGenerateFollowUps}
            onChange={(v) => set("autoGenerateFollowUps", v)}
            title="Auto-generate follow-ups when due"
            subtitle="OFF (default): click 'Run follow-ups now' in the Clients tab. ON: Day 3 / 7 / 14 drafts generate automatically whenever a client's follow-up is due. Works for both email and LinkedIn — only the sending stage treats them differently."
          />
          <ToggleRow
            checked={form.autoApproveFollowUps}
            onChange={(v) => set("autoApproveFollowUps", v)}
            title="Auto-send follow-ups (skip review)"
            subtitle="OFF (default): follow-up drafts wait for your review in the Clients detail rail. ON: they send automatically once generated. LinkedIn follow-ups are excluded — they always wait for your manual paste."
          />
          <ToggleRow
            checked={form.autoImportEnabled}
            onChange={(v) => set("autoImportEnabled", v)}
            title="Run on a daily schedule (cron)"
            subtitle="OFF (default): manual Run today only. ON (requires Vercel Cron deployment): the system runs today's plan automatically at the hour configured below. No effect on manual runs."
          />
        </CardContent>
      </Card>

      {/* Safety rails */}
      <Card>
        <CardHeader>
          <CardTitle>Safety rails</CardTitle>
          <CardDescription>
            Daily caps and the send window apply to every stage, regardless of
            which toggles are on. These keep deliverability healthy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="cap-import">Daily import cap</Label>
              <Input
                id="cap-import"
                type="number"
                value={form.dailyImportCap}
                onChange={(e) => set("dailyImportCap", parseInt(e.target.value, 10) || 0)}
                min={0}
                max={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cap-send">Daily send cap</Label>
              <Input
                id="cap-send"
                type="number"
                value={form.dailySendCap}
                onChange={(e) => set("dailySendCap", parseInt(e.target.value, 10) || 0)}
                min={0}
                max={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hour-start">Window start (hr)</Label>
              <Input
                id="hour-start"
                type="number"
                value={form.automationWindowStartHour}
                onChange={(e) =>
                  set("automationWindowStartHour", parseInt(e.target.value, 10) || 0)
                }
                min={0}
                max={23}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hour-end">Window end (hr)</Label>
              <Input
                id="hour-end"
                type="number"
                value={form.automationWindowEndHour}
                onChange={(e) =>
                  set("automationWindowEndHour", parseInt(e.target.value, 10) || 0)
                }
                min={1}
                max={24}
              />
            </div>
          </div>
          <div className="mt-4 space-y-1.5 max-w-sm">
            <Label htmlFor="tz">Timezone (IANA)</Label>
            <Input
              id="tz"
              value={form.automationTimezone}
              onChange={(e) => set("automationTimezone", e.target.value)}
              placeholder="Europe/Istanbul"
            />
            <p className="text-xs text-muted-foreground">
              e.g. Europe/Istanbul · America/New_York · UTC. The send window is
              applied in this timezone.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Save action — just Save, not Run (Run lives on the Today card above) */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {savedFlash && (
          <span className="text-sm text-[var(--color-status-success)] inline-flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            Saved
          </span>
        )}
        {filtersError && (
          <span className="text-sm text-[var(--color-status-error)] inline-flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4" />
            {filtersError}
          </span>
        )}
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            "Save settings"
          )}
        </Button>
      </div>

      {/* Run summary */}
      {(lastRun || form.automationLastRunSummary) && (
        <Card>
          <CardHeader>
            <CardTitle>
              {lastRun ? "This run" : "Last run"}
            </CardTitle>
            <CardDescription>
              {lastRun
                ? "Just completed."
                : `Completed ${formatTime(form.automationLastRunAt)}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {lastRun ? (
              <RunSummary result={lastRun} />
            ) : (
              <p className="text-sm font-mono text-muted-foreground">
                {form.automationLastRunSummary}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ToggleRow({
  checked,
  onChange,
  title,
  subtitle,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  subtitle: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 rounded-md border p-4 transition-colors",
        checked
          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
          : "border-[var(--color-line-soft)]"
      )}
    >
      <div className="space-y-0.5 min-w-0">
        <Label className="text-sm font-medium leading-none">{title}</Label>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {subtitle}
        </p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}

function RunSummary({ result }: { result: RunResult }) {
  if (!result.ran) {
    return (
      <p className="text-sm text-muted-foreground">
        Skipped: {result.skippedReason || "unknown"}.
      </p>
    );
  }
  const stats = [
    { label: "Imported", value: result.importedCount },
    { label: "Approved", value: result.approvedExistingDrafts },
    { label: "Initial sent", value: result.sentInitial },
    { label: "Follow-ups generated", value: result.generatedFollowUpCount },
    { label: "Follow-ups sent", value: result.sentFollowUp },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-md border border-[var(--color-line-soft)] p-3">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>
      {result.errors.length > 0 && (
        <div className="rounded-md border border-[var(--color-status-error)]/30 bg-[var(--color-status-error)]/5 p-3">
          <div className="text-xs font-medium text-[var(--color-status-error)] mb-1">
            {result.errors.length} issue{result.errors.length === 1 ? "" : "s"}
          </div>
          <ul className="text-xs text-muted-foreground space-y-0.5">
            {result.errors.map((e, i) => (
              <li key={i}>
                <span className="font-medium text-[var(--color-fg)]">
                  {e.stage}
                </span>
                : {e.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}
