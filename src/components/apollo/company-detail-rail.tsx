"use client";

import { X, ExternalLink, Building2, Users, MapPin, Globe, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApolloCompany } from "@/store/company-search-store";

interface Props {
  company: ApolloCompany | null;
  isSelected: boolean;
  isAlreadyImported: boolean;
  onClose: () => void;
  onToggleSelect: () => void;
}

/**
 * Slide-in detail rail for an Apollo company search result. Shows every
 * field on the row plus deep links and import status. Mirrors the
 * Client detail rail's interaction model (click outside or X to dismiss,
 * Esc to close).
 */
export function CompanyDetailRail({
  company,
  isSelected,
  isAlreadyImported,
  onClose,
  onToggleSelect,
}: Props) {
  if (!company) return null;

  const domain = company.primary_domain || company.domain || null;
  const website = company.website_url || (domain ? `https://${domain}` : null);
  const location = [company.city, company.state, company.country]
    .filter(Boolean)
    .join(", ");

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
              Company
            </div>
            <h2 className="mt-0.5 text-xl font-semibold leading-tight tracking-tight text-[var(--color-fg)] truncate">
              {company.name}
            </h2>
            {domain && (
              <p className="mt-0.5 text-sm font-mono text-muted-foreground truncate">
                {domain}
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

        {/* Status pill */}
        <div className="px-4 sm:px-6 pt-5">
          {isAlreadyImported ? (
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-status-success)]/15 px-3 py-1 text-xs font-medium text-[var(--color-status-success)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-status-success)]" />
              Already imported
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent-soft)] px-3 py-1 text-xs font-medium text-[var(--color-accent)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
              Available to import
            </div>
          )}
        </div>

        {/* Facts */}
        <div className="px-4 sm:px-6 py-5 space-y-4">
          {company.industry && (
            <Field icon={Building2} label="Industry" value={company.industry} />
          )}
          {location && (
            <Field icon={MapPin} label="Location" value={location} />
          )}
          {company.employee_count != null && (
            <Field
              icon={Users}
              label="Headcount"
              value={`${company.employee_count.toLocaleString()} employees`}
            />
          )}
          {website && (
            <Field
              icon={Globe}
              label="Website"
              value={
                <a
                  href={website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline break-all"
                >
                  {website.replace(/^https?:\/\//, "")}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              }
            />
          )}
          {company.organization_id && (
            <Field
              icon={Hash}
              label="Apollo ID"
              value={
                <code className="text-xs font-mono text-muted-foreground break-all">
                  {company.organization_id}
                </code>
              }
            />
          )}
        </div>

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
      <div className="shrink-0 mt-0.5 flex h-8 w-8 items-center justify-center rounded-md bg-[var(--color-panel)] text-muted-foreground">
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
