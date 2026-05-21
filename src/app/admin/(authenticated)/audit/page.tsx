import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getAuditLogsPaged, type ActivityRow } from "@/lib/admin/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface SearchParams {
  entityType?: string;
  action?: string;
  userEmail?: string;
  performedBy?: string;
  from?: string;
  to?: string;
  page?: string;
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const page = Math.max(parseInt(sp.page ?? "1", 10) || 1, 1);

  const result = await getAuditLogsPaged({
    entityType: sp.entityType || undefined,
    action: sp.action || undefined,
    userEmail: sp.userEmail || undefined,
    performedBy: sp.performedBy || undefined,
    from: sp.from ? new Date(sp.from) : undefined,
    to: sp.to ? new Date(sp.to + "T23:59:59.999Z") : undefined,
    page,
    pageSize: 50,
  });

  const hasFilters = !!(
    sp.entityType ||
    sp.action ||
    sp.userEmail ||
    sp.performedBy ||
    sp.from ||
    sp.to
  );

  return (
    <div className="px-8 py-8 space-y-6 max-w-[1400px] mx-auto">
      <div>
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--color-fg-muted)]">
          Audit
        </div>
        <h1 className="mt-2 text-[26px] font-medium tracking-tight text-[var(--color-fg)]">
          Activity log
        </h1>
        <p className="mt-1 text-[13px] text-[var(--color-fg-muted)]">
          {result.total.toLocaleString()} total events across all tenants. Filters compose; URL is shareable.
        </p>
      </div>

      <FilterForm
        sp={sp}
        entityTypes={result.entityTypes}
        actions={result.actions}
        hasFilters={hasFilters}
      />

      <AuditTable rows={result.rows} />

      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        currentParams={sp}
      />
    </div>
  );
}

function FilterForm({
  sp,
  entityTypes,
  actions,
  hasFilters,
}: {
  sp: SearchParams;
  entityTypes: string[];
  actions: string[];
  hasFilters: boolean;
}) {
  return (
    <form
      action="/admin/audit"
      method="get"
      className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] p-5"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
        <SelectField
          name="entityType"
          label="Entity type"
          value={sp.entityType ?? ""}
          options={entityTypes}
        />
        <SelectField
          name="action"
          label="Action"
          value={sp.action ?? ""}
          options={actions}
        />
        <TextField
          name="userEmail"
          label="Tenant email"
          value={sp.userEmail ?? ""}
          placeholder="exact match"
        />
        <TextField
          name="performedBy"
          label="Performed by"
          value={sp.performedBy ?? ""}
          placeholder="contains…"
        />
        <DateField name="from" label="From" value={sp.from ?? ""} />
        <DateField name="to" label="To" value={sp.to ?? ""} />
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button type="submit" size="sm">
          Apply filters
        </Button>
        {hasFilters && (
          <Link href="/admin/audit" prefetch={false}>
            <Button type="button" variant="ghost" size="sm">
              Clear
            </Button>
          </Link>
        )}
      </div>
    </form>
  );
}

function SelectField({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: string[];
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)]">
        {label}
      </Label>
      <select
        name={name}
        defaultValue={value}
        className={cn(
          "flex h-9 w-full rounded-md border bg-[var(--color-canvas)] border-[var(--color-line)] px-3 py-1 text-sm",
          "text-[var(--color-fg)] shadow-sm transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        )}
      >
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextField({
  name,
  label,
  value,
  placeholder,
}: {
  name: string;
  label: string;
  value: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)]">
        {label}
      </Label>
      <Input
        name={name}
        defaultValue={value}
        placeholder={placeholder}
        className="font-mono text-[12.5px]"
      />
    </div>
  );
}

function DateField({
  name,
  label,
  value,
}: {
  name: string;
  label: string;
  value: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)]">
        {label}
      </Label>
      <Input name={name} type="date" defaultValue={value} className="font-mono text-[12.5px]" />
    </div>
  );
}

function AuditTable({ rows }: { rows: ActivityRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] p-12 text-center text-[13px] text-[var(--color-fg-muted)]">
        No events match these filters.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] overflow-hidden">
      <div className="grid grid-cols-[170px_140px_1fr_180px_160px] px-5 py-2 border-b border-[var(--color-line-soft)] text-[10.5px] font-mono uppercase tracking-[0.10em] text-[var(--color-fg-muted)]">
        <div>When</div>
        <div>Type</div>
        <div>Action</div>
        <div>Entity ID</div>
        <div>Tenant / by</div>
      </div>
      <div className="divide-y divide-[var(--color-line-soft)]">
        {rows.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-[170px_140px_1fr_180px_160px] px-5 py-2.5 text-[12.5px] items-center hover:bg-[var(--color-raised)]/40 transition-colors"
          >
            <span className="font-mono text-[11.5px] tabular-nums text-[var(--color-fg-muted)]">
              {new Date(r.performedAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] bg-[var(--color-raised)] px-1.5 py-0.5 rounded w-fit">
              {r.entityType}
            </span>
            <div className="min-w-0">
              <span className="font-medium text-[var(--color-fg)]">
                {r.action.replaceAll("_", " ")}
              </span>
              {r.fromState && r.toState && (
                <span className="ml-2 font-mono text-[11px] text-[var(--color-fg-subtle)]">
                  {r.fromState} → {r.toState}
                </span>
              )}
            </div>
            <span className="font-mono text-[11px] text-[var(--color-fg-subtle)] truncate">
              {r.entityId}
            </span>
            <div className="flex flex-col leading-tight min-w-0">
              <span className="font-mono text-[11.5px] text-[var(--color-fg-muted)] truncate">
                {r.userEmail || "—"}
              </span>
              {r.performedBy && (
                <span className="text-[10.5px] text-[var(--color-fg-subtle)] truncate">
                  by {r.performedBy}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Pagination({
  page,
  pageCount,
  total,
  currentParams,
}: {
  page: number;
  pageCount: number;
  total: number;
  currentParams: SearchParams;
}) {
  if (pageCount <= 1) return null;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(currentParams)) {
    if (v && k !== "page") params.set(k, v);
  }
  const baseQs = params.toString();
  const withPage = (p: number) =>
    `/admin/audit?${baseQs ? `${baseQs}&` : ""}page=${p}`;

  return (
    <div className="flex items-center justify-between text-[12px] text-[var(--color-fg-muted)]">
      <span>
        Page {page} of {pageCount} · {total.toLocaleString()} events
      </span>
      <div className="flex items-center gap-1">
        <Link
          href={withPage(Math.max(1, page - 1))}
          prefetch={false}
          className={cn(
            "grid h-7 w-7 place-items-center rounded-md hover:bg-[var(--color-raised)]",
            page <= 1 && "opacity-40 pointer-events-none"
          )}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Link>
        <Link
          href={withPage(Math.min(pageCount, page + 1))}
          prefetch={false}
          className={cn(
            "grid h-7 w-7 place-items-center rounded-md hover:bg-[var(--color-raised)]",
            page >= pageCount && "opacity-40 pointer-events-none"
          )}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
