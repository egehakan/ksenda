"use client";

import {
  X,
  ExternalLink,
  Building2,
  Users,
  MapPin,
  Globe,
  Hash,
  Mail,
  Briefcase,
  Linkedin,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApolloPersonRow } from "@/store/people-search-store";

interface Props {
  person: ApolloPersonRow | null;
  isSelected: boolean;
  isAlreadyImported: boolean;
  onClose: () => void;
  onToggleSelect: () => void;
}

/**
 * Slide-in detail rail for an Apollo people search result. Shows person
 * + organization fields together, with explicit signals about email
 * availability and last-name obfuscation on free tier.
 */
export function PersonDetailRail({
  person,
  isSelected,
  isAlreadyImported,
  onClose,
  onToggleSelect,
}: Props) {
  if (!person) return null;

  const lastName = person.last_name || person.last_name_obfuscated || "";
  const lastNameIsObfuscated = !person.last_name && !!person.last_name_obfuscated;
  const fullName = `${person.first_name || ""} ${lastName}`.trim() || "Unknown";

  const org = person.organization;
  const orgDomain = org?.primary_domain || org?.domain || null;
  const orgWebsite = org?.website_url || (orgDomain ? `https://${orgDomain}` : null);
  const orgLocation = [org?.city, org?.state, org?.country].filter(Boolean).join(", ");
  const headcount = org?.employee_count ?? org?.organization_headcount;

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm flex"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="ml-auto h-full w-full max-w-[520px] bg-[var(--color-canvas)] border-l border-[var(--color-line)] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[var(--color-canvas)]/95 backdrop-blur-sm border-b border-[var(--color-line-soft)] px-4 sm:px-6 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Person
            </div>
            <h2 className="mt-0.5 text-xl font-semibold leading-tight tracking-tight text-[var(--color-fg)] truncate">
              {fullName}
            </h2>
            {person.title && (
              <p className="mt-0.5 text-sm text-muted-foreground truncate">
                {person.title}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-[var(--color-fg)] shrink-0 mt-1"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Status pills */}
        <div className="px-4 sm:px-6 pt-5 flex flex-wrap gap-2">
          {isAlreadyImported ? (
            <Pill tone="success" label="Already imported" />
          ) : (
            <Pill tone="accent" label="Available to import" />
          )}
          {person.email ? (
            <Pill tone="success" label="Email revealed" icon={Mail} />
          ) : person.has_email ? (
            <Pill tone="muted" label="Email will be enriched" icon={Mail} />
          ) : (
            <Pill tone="error" label="No email available" icon={AlertCircle} />
          )}
          {lastNameIsObfuscated && (
            <Pill tone="muted" label="Last name obfuscated (free tier)" />
          )}
        </div>

        {/* Person facts */}
        <div className="px-4 sm:px-6 py-5 space-y-4">
          {person.title && (
            <Field icon={Briefcase} label="Title" value={person.title} />
          )}
          {person.seniority && (
            <Field icon={Briefcase} label="Seniority" value={person.seniority} />
          )}
          {person.email && (
            <Field
              icon={Mail}
              label="Email"
              value={
                <a
                  href={`mailto:${person.email}`}
                  className="font-mono text-sm text-[var(--color-accent)] hover:underline break-all"
                >
                  {person.email}
                </a>
              }
            />
          )}
          {person.linkedin_url && (
            <Field
              icon={Linkedin}
              label="LinkedIn"
              value={
                <a
                  href={person.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline break-all"
                >
                  {person.linkedin_url.replace(/^https?:\/\//, "")}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              }
            />
          )}
          <Field
            icon={Hash}
            label="Apollo Person ID"
            value={
              <code className="text-xs font-mono text-muted-foreground break-all">
                {person.id}
              </code>
            }
          />
        </div>

        {/* Organization */}
        {org && (
          <div className="px-4 sm:px-6 pb-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 mt-2">
              Organization
            </div>
            <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] p-4 space-y-4">
              {org.name && (
                <Field icon={Building2} label="Name" value={org.name} />
              )}
              {org.industry && (
                <Field icon={Building2} label="Industry" value={org.industry} />
              )}
              {orgLocation && (
                <Field icon={MapPin} label="Location" value={orgLocation} />
              )}
              {headcount != null && (
                <Field
                  icon={Users}
                  label="Headcount"
                  value={`${headcount.toLocaleString()} employees`}
                />
              )}
              {orgWebsite && (
                <Field
                  icon={Globe}
                  label="Website"
                  value={
                    <a
                      href={orgWebsite}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline break-all"
                    >
                      {orgWebsite.replace(/^https?:\/\//, "")}
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  }
                />
              )}
              {(org.id || person.organization_id) && (
                <Field
                  icon={Hash}
                  label="Apollo Org ID"
                  value={
                    <code className="text-xs font-mono text-muted-foreground break-all">
                      {org.id || person.organization_id}
                    </code>
                  }
                />
              )}
            </div>
          </div>
        )}

        {/* Footer action */}
        <div className="sticky bottom-0 bg-[var(--color-canvas)]/95 backdrop-blur-sm border-t border-[var(--color-line-soft)] px-4 sm:px-6 py-4 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {!isAlreadyImported && (
            <Button onClick={onToggleSelect}>
              {isSelected ? "Deselect" : "Select for import"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="shrink-0 mt-0.5 flex h-8 w-8 items-center justify-center rounded-md bg-[var(--color-raised)] text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="mt-0.5 text-sm text-[var(--color-fg)]">{value}</div>
      </div>
    </div>
  );
}

function Pill({
  tone,
  label,
  icon: Icon,
}: {
  tone: "success" | "accent" | "muted" | "error";
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const styles = {
    success:
      "bg-[var(--color-status-success)]/15 text-[var(--color-status-success)]",
    accent: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
    muted: "bg-[var(--color-panel)] text-muted-foreground",
    error: "bg-[var(--color-status-error)]/15 text-[var(--color-status-error)]",
  }[tone];
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${styles}`}
    >
      {Icon ? <Icon className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {label}
    </div>
  );
}
