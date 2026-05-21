"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, X, AlertCircle, Sparkles, Mail, Linkedin } from "lucide-react";
import { cn } from "@/lib/utils";
import { AiFilterToggle } from "@/components/apollo/ai-filter-toggle";

/**
 * RecipeBuilderDialog — form-based create/edit for SavedSearch recipes.
 *
 * Two modes:
 *   - Simple: named fields for the common Apollo filters (locations,
 *     headcount, titles, seniorities, keywords, etc.). Premium fields are
 *     marked with a paid-tier badge.
 *   - Advanced: raw JSON for power users who need filters the simple form
 *     doesn't expose.
 *
 * Built-in recipes get filters-only editing (kind / code / name locked).
 * Custom recipes are fully editable.
 */

export interface RecipeBuilderRecipe {
  id?: string;
  code: string;
  name: string;
  description?: string | null;
  kind: "companies" | "people";
  filters: Record<string, unknown>;
  defaultDailyCap: number;
  isBuiltIn?: boolean;
  /** Pre-import AI gate. Defaults to 'any'. */
  aiFilter?: "any" | "no_ai" | "has_ai";
  /** Outreach channel. Defaults to 'email'. */
  channel?: "email" | "linkedin";
}

interface Props {
  open: boolean;
  initial?: RecipeBuilderRecipe | null;
  onClose: () => void;
  onSaved: () => void;
}

type FormState = {
  code: string;
  name: string;
  description: string;
  kind: "companies" | "people";
  defaultDailyCap: number;

  // Common (free-tier) fields
  locations: string;
  organizationLocations: string;
  personLocations: string;
  industries: string;
  keywords: string;
  employeeCountMin: string;
  employeeCountMax: string;
  titles: string; // people only
  seniorities: string; // people only — CSV of c_suite, vp, head, director, manager, senior, founder, owner
  includeSimilarTitles: boolean; // people only
  emailVerifiedOnly: boolean; // people only

  // Premium fields (Apollo Basic+)
  fundingDateMin: string;
  fundingDateMax: string;
  fundingAmountMin: string;
  fundingAmountMax: string;
  technologies: string;
  jobTitles: string; // org-level "is hiring for"

  // Advanced JSON override
  advancedJson: string;
  useAdvancedJson: boolean;

  // Recipe-level AI presence gate (per the import-time page-walk loop).
  aiFilter: "any" | "no_ai" | "has_ai";

  // Outreach channel the recipe drives.
  channel: "email" | "linkedin";
};

const EMPTY_FORM: FormState = {
  code: "",
  name: "",
  description: "",
  kind: "people",
  defaultDailyCap: 25,
  locations: "",
  organizationLocations: "",
  personLocations: "",
  industries: "",
  keywords: "",
  employeeCountMin: "",
  employeeCountMax: "",
  titles: "",
  seniorities: "",
  includeSimilarTitles: true,
  emailVerifiedOnly: false,
  fundingDateMin: "",
  fundingDateMax: "",
  fundingAmountMin: "",
  fundingAmountMax: "",
  technologies: "",
  jobTitles: "",
  advancedJson: "",
  useAdvancedJson: false,
  aiFilter: "any",
  channel: "email",
};

function csvFromArray(v: unknown): string {
  return Array.isArray(v) ? v.join(", ") : "";
}

function numFromVal(v: unknown): string {
  return typeof v === "number" ? String(v) : "";
}

function strFromVal(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function csvToArray(s: string): string[] | undefined {
  const trimmed = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return trimmed.length > 0 ? trimmed : undefined;
}

function intOrUndef(s: string): number | undefined {
  if (!s.trim()) return undefined;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

function formToFilters(f: FormState): Record<string, unknown> {
  if (f.useAdvancedJson) {
    return JSON.parse(f.advancedJson);
  }
  const obj: Record<string, unknown> = {};
  if (f.kind === "companies") {
    if (csvToArray(f.locations)) obj.locations = csvToArray(f.locations);
    if (csvToArray(f.industries)) obj.industries = csvToArray(f.industries);
  } else {
    if (csvToArray(f.titles)) obj.titles = csvToArray(f.titles);
    if (csvToArray(f.seniorities)) obj.seniorities = csvToArray(f.seniorities);
    if (csvToArray(f.organizationLocations)) {
      obj.organizationLocations = csvToArray(f.organizationLocations);
    }
    if (csvToArray(f.personLocations)) {
      obj.personLocations = csvToArray(f.personLocations);
    }
    if (csvToArray(f.industries)) obj.industries = csvToArray(f.industries);
    obj.includeSimilarTitles = f.includeSimilarTitles;
    if (f.emailVerifiedOnly) obj.emailVerifiedOnly = true;
  }
  if (csvToArray(f.keywords)) obj.keywords = csvToArray(f.keywords);
  const eMin = intOrUndef(f.employeeCountMin);
  const eMax = intOrUndef(f.employeeCountMax);
  if (eMin !== undefined) obj.employeeCountMin = eMin;
  if (eMax !== undefined) obj.employeeCountMax = eMax;

  // Premium fields
  if (csvToArray(f.technologies)) obj.technologies = csvToArray(f.technologies);
  if (csvToArray(f.jobTitles)) obj.jobTitles = csvToArray(f.jobTitles);
  if (f.fundingDateMin) obj.fundingDateMin = f.fundingDateMin;
  if (f.fundingDateMax) obj.fundingDateMax = f.fundingDateMax;
  const fmin = intOrUndef(f.fundingAmountMin);
  const fmax = intOrUndef(f.fundingAmountMax);
  if (fmin !== undefined) obj.fundingAmountMin = fmin;
  if (fmax !== undefined) obj.fundingAmountMax = fmax;

  return obj;
}

function filtersToForm(
  filters: Record<string, unknown>,
  kind: "companies" | "people"
): Partial<FormState> {
  return {
    locations: csvFromArray(filters.locations),
    organizationLocations: csvFromArray(filters.organizationLocations),
    personLocations: csvFromArray(filters.personLocations),
    industries: csvFromArray(filters.industries),
    keywords: csvFromArray(filters.keywords),
    employeeCountMin: numFromVal(filters.employeeCountMin),
    employeeCountMax: numFromVal(filters.employeeCountMax),
    titles: csvFromArray(filters.titles),
    seniorities: csvFromArray(filters.seniorities),
    includeSimilarTitles:
      typeof filters.includeSimilarTitles === "boolean"
        ? (filters.includeSimilarTitles as boolean)
        : kind === "people",
    emailVerifiedOnly:
      typeof filters.emailVerifiedOnly === "boolean"
        ? (filters.emailVerifiedOnly as boolean)
        : false,
    fundingDateMin: strFromVal(filters.fundingDateMin),
    fundingDateMax: strFromVal(filters.fundingDateMax),
    fundingAmountMin: numFromVal(filters.fundingAmountMin),
    fundingAmountMax: numFromVal(filters.fundingAmountMax),
    technologies: csvFromArray(filters.technologies),
    jobTitles: csvFromArray(filters.jobTitles),
  };
}

export function RecipeBuilderDialog({ open, initial, onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!initial?.id;
  const isBuiltIn = !!initial?.isBuiltIn;

  // Reset form when dialog opens with new initial.
  useEffect(() => {
    if (!open) return;
    if (initial) {
      const base: FormState = {
        ...EMPTY_FORM,
        code: initial.code,
        name: initial.name,
        description: initial.description || "",
        kind: initial.kind,
        defaultDailyCap: initial.defaultDailyCap,
        aiFilter: initial.aiFilter ?? "any",
        channel: initial.channel ?? "email",
      };
      const patch = filtersToForm(initial.filters, initial.kind);
      setForm({ ...base, ...patch });
    } else {
      setForm(EMPTY_FORM);
    }
    setError(null);
  }, [open, initial]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      let filters: Record<string, unknown>;
      try {
        filters = formToFilters(form);
      } catch (e: any) {
        throw new Error(
          form.useAdvancedJson
            ? `Advanced JSON is not valid: ${e?.message || "parse error"}`
            : "Could not build filters object"
        );
      }
      const payload: Record<string, unknown> = {
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        kind: form.kind,
        defaultDailyCap: form.defaultDailyCap,
        filters,
        aiFilter: form.aiFilter,
        channel: form.channel,
      };

      const url = isEdit
        ? `/api/automation/recipes/${initial!.id}`
        : "/api/automation/recipes";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipes"] });
      queryClient.invalidateQueries({ queryKey: ["campaign-schedule"] });
      onSaved();
    },
    onError: (e: any) => {
      setError(e?.message || "Save failed");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!initial?.id) return;
      const res = await fetch(`/api/automation/recipes/${initial.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error || "Delete failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipes"] });
      onSaved();
    },
    onError: (e: any) => {
      setError(e?.message || "Delete failed");
    },
  });

  const previewJson = useMemo(() => {
    try {
      return JSON.stringify(formToFilters(form), null, 2);
    } catch {
      return "// invalid";
    }
  }, [form]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl my-8 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-[var(--color-line-soft)]">
          <div>
            <h3 className="text-lg font-semibold tracking-tight">
              {isEdit ? "Edit recipe" : "New recipe"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {isBuiltIn
                ? "Built-in recipe — code, name, and kind are locked. You can edit filters and the default cap."
                : "Save an Apollo search as a reusable recipe. Use it in your campaign schedule or run it ad-hoc."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-[var(--color-fg)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 max-h-[calc(100vh-200px)] overflow-y-auto">
          {/* Identity */}
          <Section title="Identity">
            <div className="grid grid-cols-1 sm:grid-cols-[120px_minmax(0,1fr)] gap-4">
              <Field label="Code" required>
                <Input
                  value={form.code}
                  onChange={(e) => set("code", e.target.value)}
                  disabled={isBuiltIn}
                  placeholder="e.g. CTO-FINTECH"
                  className="font-mono uppercase"
                />
                <Hint>Short ID. Letters/digits/dashes. A1-B5 reserved.</Hint>
              </Field>
              <Field label="Name" required>
                <Input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  disabled={isBuiltIn}
                  placeholder="e.g. Heads of Compliance at US banks"
                />
              </Field>
              <Field label="Daily cap">
                <Input
                  type="number"
                  value={form.defaultDailyCap}
                  onChange={(e) =>
                    set("defaultDailyCap", parseInt(e.target.value, 10) || 0)
                  }
                  min={0}
                  max={500}
                />
                {/* Keep this hint short so the row stays one-line tall
                    regardless of channel — the per-channel cap guidance
                    lives under the Channel toggle below. */}
                <Hint>
                  {form.channel === "linkedin"
                    ? "Default 15/day for LinkedIn (manual paste)."
                    : "Default cap when this recipe is scheduled."}
                </Hint>
              </Field>
              <Field label="Description">
                <Input
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  disabled={isBuiltIn}
                  placeholder="What this recipe targets, in plain English"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Channel">
                  <div
                    role="radiogroup"
                    aria-label="Outreach channel"
                    className={cn(
                      // Match AiFilterToggle's stacked variant exactly so
                      // the two segmented controls in this section read as
                      // a pair.
                      "inline-flex w-fit max-w-full overflow-hidden rounded-md border border-[var(--color-line)]",
                      isBuiltIn && "opacity-60 cursor-not-allowed"
                    )}
                  >
                    {(
                      [
                        { value: "email", label: "Email", Icon: Mail },
                        { value: "linkedin", label: "LinkedIn", Icon: Linkedin },
                      ] as const
                    ).map((opt) => {
                      const isActive = form.channel === opt.value;
                      const Icon = opt.Icon;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="radio"
                          aria-checked={isActive}
                          disabled={isBuiltIn}
                          onClick={() => set("channel", opt.value)}
                          className={cn(
                            "inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] leading-none transition-colors px-2.5 py-2 border-l border-[var(--color-line)] first:border-l-0",
                            isActive
                              ? "bg-[var(--color-accent)]/12 text-[var(--color-accent)]"
                              : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-panel)]",
                            isBuiltIn && "cursor-not-allowed"
                          )}
                        >
                          <Icon className="h-3 w-3 shrink-0" />
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <Hint>
                    {form.channel === "linkedin"
                      ? "LinkedIn DMs are sent manually (excluded from auto-send). 15–25/day is sustainable; 50+ risks LinkedIn flagging your account. Channel changes only affect newly-scheduled days."
                      : "Email auto-sends via SMTP after approval. Changing the channel only affects newly-scheduled days — existing campaign days keep their original channel."}
                  </Hint>
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="AI presence gate">
                  <AiFilterToggle
                    variant="stacked"
                    value={form.aiFilter}
                    onChange={(next) => set("aiFilter", next)}
                  />
                </Field>
              </div>
            </div>
          </Section>

          {/* Kind picker */}
          <Section title="Search type">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(["people", "companies"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={isBuiltIn}
                  onClick={() => set("kind", k)}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors",
                    form.kind === k
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                      : "border-[var(--color-line)] hover:bg-[var(--color-raised)]",
                    isBuiltIn && "cursor-not-allowed opacity-60"
                  )}
                >
                  <span className="text-sm font-medium capitalize">{k}</span>
                  <span className="text-xs text-muted-foreground">
                    {k === "people"
                      ? "Find decision-makers directly. Best for finding specific titles across many orgs."
                      : "Find target organizations. The pipeline auto-finds a contact at each."}
                  </span>
                </button>
              ))}
            </div>
          </Section>

          {/* Toggle: simple vs advanced */}
          <div className="flex items-center justify-between rounded-md border border-[var(--color-line-soft)] p-3">
            <div>
              <Label className="text-sm">Advanced (raw JSON)</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Edit filters as JSON. Skips the simple form below.
              </p>
            </div>
            <Switch
              checked={form.useAdvancedJson}
              onCheckedChange={(v) => {
                if (v) {
                  // entering advanced — seed JSON from current form
                  try {
                    set("advancedJson", JSON.stringify(formToFilters({ ...form, useAdvancedJson: false }), null, 2));
                  } catch {
                    set("advancedJson", "{}");
                  }
                }
                set("useAdvancedJson", v);
              }}
            />
          </div>

          {form.useAdvancedJson ? (
            <Section title="Filters (JSON)">
              <textarea
                value={form.advancedJson}
                onChange={(e) => set("advancedJson", e.target.value)}
                className="flex min-h-[260px] w-full rounded-md border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2 text-xs font-mono leading-relaxed shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-1"
                spellCheck={false}
              />
              <Hint>
                Same shape the {form.kind} search route accepts. See an existing
                recipe's filters as a template.
              </Hint>
            </Section>
          ) : (
            <SimpleForm form={form} set={set} />
          )}

          {/* Live preview */}
          {!form.useAdvancedJson && (
            <Section title="Preview">
              <pre className="rounded-md border border-[var(--color-line-soft)] bg-[var(--color-canvas)] p-3 text-xs font-mono leading-relaxed overflow-x-auto max-h-[200px] text-muted-foreground">
                {previewJson}
              </pre>
              <Hint>What the search route will receive. Read-only.</Hint>
            </Section>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-[var(--color-status-error)]/40 bg-[var(--color-status-error)]/5 p-3">
              <AlertCircle className="h-4 w-4 text-[var(--color-status-error)] shrink-0 mt-0.5" />
              <p className="text-sm text-[var(--color-status-error)]">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 p-6 border-t border-[var(--color-line-soft)]">
          {isEdit && !isBuiltIn ? (
            <Button
              variant="destructive"
              onClick={() => {
                if (confirm(`Delete recipe ${initial!.code}? This can't be undone.`)) {
                  deleteMutation.mutate();
                }
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete recipe"
              )}
            </Button>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !form.code || !form.name}
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : isEdit ? (
                "Save changes"
              ) : (
                "Create recipe"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SimpleForm({
  form,
  set,
}: {
  form: FormState;
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
}) {
  return (
    <>
      {/* Common filters */}
      <Section title="Common filters (free tier)">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {form.kind === "people" ? (
            <>
              <Field label="Titles">
                <Input
                  value={form.titles}
                  onChange={(e) => set("titles", e.target.value)}
                  placeholder="CTO, Head of AI, VP Engineering"
                />
                <Hint>Comma-separated. include_similar_titles is on by default.</Hint>
              </Field>
              <Field label="Seniorities">
                <Input
                  value={form.seniorities}
                  onChange={(e) => set("seniorities", e.target.value)}
                  placeholder="c_suite, vp, head, director"
                  className="font-mono"
                />
                <Hint>
                  Options: c_suite, vp, head, director, manager, senior, founder, owner.
                </Hint>
              </Field>
              <Field label="Org locations">
                <Input
                  value={form.organizationLocations}
                  onChange={(e) => set("organizationLocations", e.target.value)}
                  placeholder="United States, United Kingdom"
                />
              </Field>
              <Field label="Person locations (optional)">
                <Input
                  value={form.personLocations}
                  onChange={(e) => set("personLocations", e.target.value)}
                  placeholder="San Francisco, New York"
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="Locations">
                <Input
                  value={form.locations}
                  onChange={(e) => set("locations", e.target.value)}
                  placeholder="United States, Canada"
                />
                <Hint>HQ locations. Comma-separated.</Hint>
              </Field>
              <Field label="Industries">
                <Input
                  value={form.industries}
                  onChange={(e) => set("industries", e.target.value)}
                  placeholder="SaaS, Fintech, HealthTech"
                />
              </Field>
            </>
          )}

          <Field label="Min headcount">
            <Input
              type="number"
              value={form.employeeCountMin}
              onChange={(e) => set("employeeCountMin", e.target.value)}
              placeholder="11"
            />
          </Field>
          <Field label="Max headcount">
            <Input
              type="number"
              value={form.employeeCountMax}
              onChange={(e) => set("employeeCountMax", e.target.value)}
              placeholder="200"
            />
          </Field>
          <Field label="Keywords">
            <Input
              value={form.keywords}
              onChange={(e) => set("keywords", e.target.value)}
              placeholder="artificial intelligence, agents"
            />
            <Hint>Free-text industry keywords.</Hint>
          </Field>
          {form.kind === "people" && (
            <Field label="Include similar titles">
              <div className="h-9 flex items-center gap-3">
                <Switch
                  checked={form.includeSimilarTitles}
                  onCheckedChange={(v) => set("includeSimilarTitles", v)}
                />
                <span className="text-sm text-muted-foreground">
                  {form.includeSimilarTitles ? "On" : "Off"}
                </span>
              </div>
            </Field>
          )}
        </div>
      </Section>

      {/* Premium filters */}
      <Section title="Signal filters" badge="Apollo Basic ($59/mo)">
        <p className="text-xs text-muted-foreground -mt-2 mb-3">
          These return HTTP 422 on the free tier. Leave blank if you haven't
          upgraded yet.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Funding from">
            <Input
              type="date"
              value={form.fundingDateMin}
              onChange={(e) => set("fundingDateMin", e.target.value)}
            />
          </Field>
          <Field label="Funding to">
            <Input
              type="date"
              value={form.fundingDateMax}
              onChange={(e) => set("fundingDateMax", e.target.value)}
            />
          </Field>
          <Field label="Min round (USD)">
            <Input
              type="number"
              value={form.fundingAmountMin}
              onChange={(e) => set("fundingAmountMin", e.target.value)}
              placeholder="3000000"
            />
          </Field>
          <Field label="Max round (USD)">
            <Input
              type="number"
              value={form.fundingAmountMax}
              onChange={(e) => set("fundingAmountMax", e.target.value)}
              placeholder="25000000"
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <Field label="Tech stack">
            <Input
              value={form.technologies}
              onChange={(e) => set("technologies", e.target.value)}
              placeholder="openai, anthropic, langchain"
              className="font-mono"
            />
            <Hint>Apollo UIDs (lowercase, underscores).</Hint>
          </Field>
          <Field label="Hiring for">
            <Input
              value={form.jobTitles}
              onChange={(e) => set("jobTitles", e.target.value)}
              placeholder="AI Engineer, ML Engineer"
            />
            <Hint>Org-level filter. Companies with these open job postings.</Hint>
          </Field>
        </div>
        {form.kind === "people" && (
          <div className="mt-3">
            <Field label="Verified emails only">
              <div className="h-9 flex items-center gap-3">
                <Switch
                  checked={form.emailVerifiedOnly}
                  onCheckedChange={(v) => set("emailVerifiedOnly", v)}
                />
                <span className="text-sm text-muted-foreground">
                  {form.emailVerifiedOnly ? "On" : "Off"}
                </span>
              </div>
              <Hint>Also paid-tier.</Hint>
            </Field>
          </div>
        )}
      </Section>
    </>
  );
}

function Section({
  title,
  children,
  badge,
}: {
  title: string;
  children: React.ReactNode;
  badge?: string;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <h4 className="text-sm font-semibold text-[var(--color-fg)]">{title}</h4>
        {badge && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-accent)]">
            <Sparkles className="h-3 w-3" />
            {badge}
          </span>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
  required,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label}
        {required && <span className="ml-0.5 text-[var(--color-accent)]">*</span>}
      </Label>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-muted-foreground">{children}</p>;
}
