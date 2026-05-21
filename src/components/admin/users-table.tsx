"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DataTable } from "./data-table";
import type { UserListRow } from "@/lib/admin/queries";

interface UsersTableProps {
  rows: UserListRow[];
}

export function UsersTable({ rows }: UsersTableProps) {
  const router = useRouter();

  const columns = useMemo<ColumnDef<UserListRow, unknown>[]>(
    () => [
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => (
          <div className="flex flex-col leading-tight">
            <span className="font-mono text-[12.5px] text-[var(--color-fg)] truncate max-w-[260px]">
              {row.original.email}
            </span>
            {row.original.name && (
              <span className="text-[11.5px] text-[var(--color-fg-muted)]">
                {row.original.name}
              </span>
            )}
          </div>
        ),
      },
      {
        accessorKey: "companyName",
        header: "Company",
        cell: ({ row }) => (
          <span className="text-[var(--color-fg-muted)]">
            {row.original.companyName || "—"}
          </span>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "Joined",
        cell: ({ row }) => (
          <span className="font-mono text-[11.5px] tabular-nums text-[var(--color-fg-muted)]">
            {formatDate(row.original.createdAt)}
          </span>
        ),
        sortingFn: "datetime",
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => <StatusChips row={row.original} />,
        enableSorting: false,
      },
      {
        id: "keys",
        header: "Integrations",
        cell: ({ row }) => <KeysChips row={row.original} />,
        enableSorting: false,
      },
      {
        id: "automation",
        header: "Automation",
        cell: ({ row }) => <AutomationDots row={row.original} />,
        enableSorting: false,
      },
      {
        accessorKey: "companiesCount",
        header: "Companies",
        cell: ({ row }) => (
          <span className="font-mono tabular-nums text-[var(--color-fg)]">
            {row.original.companiesCount.toLocaleString()}
          </span>
        ),
      },
      {
        accessorKey: "emailsSentCount",
        header: "Sent",
        cell: ({ row }) => (
          <span className="font-mono tabular-nums text-[var(--color-fg)]">
            {row.original.emailsSentCount.toLocaleString()}
          </span>
        ),
      },
      {
        accessorKey: "lastActivityAt",
        header: "Last activity",
        cell: ({ row }) => (
          <span className="font-mono text-[11.5px] tabular-nums text-[var(--color-fg-muted)]">
            {row.original.lastActivityAt
              ? formatRelative(row.original.lastActivityAt)
              : "—"}
          </span>
        ),
        sortingFn: (a, b) => {
          const av = a.original.lastActivityAt
            ? new Date(a.original.lastActivityAt).getTime()
            : 0;
          const bv = b.original.lastActivityAt
            ? new Date(b.original.lastActivityAt).getTime()
            : 0;
          return av - bv;
        },
      },
    ],
    []
  );

  return (
    <DataTable
      data={rows}
      columns={columns}
      searchColumnId="email"
      searchPlaceholder="Search by email…"
      pageSize={25}
      onRowClick={(row) => router.push(`/admin/users/${row.id}`)}
      emptyMessage="No tenants yet."
    />
  );
}

function StatusChips({ row }: { row: UserListRow }) {
  return (
    <div className="flex items-center gap-1.5">
      <Chip
        ok={!!row.emailVerifiedAt}
        label={row.emailVerifiedAt ? "verified" : "unverified"}
      />
      <Chip
        ok={!!row.onboardingCompletedAt}
        label={
          row.onboardingCompletedAt
            ? "onboarded"
            : row.onboardingStep
              ? `step:${row.onboardingStep}`
              : "no setup"
        }
      />
    </div>
  );
}

function KeysChips({ row }: { row: UserListRow }) {
  return (
    <div className="flex items-center gap-1">
      <KeyDot label="A" present={row.hasApollo} title="Apollo API key" />
      <KeyDot label="G" present={row.hasGemini} title="Gemini API key" />
      <KeyDot label="S" present={row.hasSmtp} title="SMTP credentials" />
    </div>
  );
}

function AutomationDots({ row }: { row: UserListRow }) {
  const flags = row.automationFlags;
  return (
    <div className="flex items-center gap-1">
      <Dot label="Imp" on={flags.autoImport} title="Auto import" />
      <Dot label="Apr" on={flags.autoApproveInitial} title="Auto approve initial" />
      <Dot label="Snd" on={flags.autoSend} title="Auto send" />
      <Dot label="F/u" on={flags.autoFollowUp} title="Auto follow-up" />
      <Dot label="AF" on={flags.autoApproveFollowUp} title="Auto approve follow-up" />
    </div>
  );
}

function Chip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-mono uppercase tracking-[0.06em]",
        ok
          ? "bg-[color-mix(in_oklch,var(--color-status-success)_18%,transparent)] text-[var(--color-status-success)]"
          : "bg-[var(--color-raised)] text-[var(--color-fg-muted)]"
      )}
    >
      {ok ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}

function KeyDot({
  label,
  present,
  title,
}: {
  label: string;
  present: boolean;
  title: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "grid h-5 w-5 place-items-center rounded font-mono text-[10px] font-medium",
        present
          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
          : "bg-[var(--color-raised)] text-[var(--color-fg-subtle)]"
      )}
    >
      {label}
    </span>
  );
}

function Dot({
  label,
  on,
  title,
}: {
  label: string;
  on: boolean;
  title: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-block rounded px-1 py-0.5 font-mono text-[10px]",
        on
          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
          : "bg-[var(--color-raised)] text-[var(--color-fg-subtle)]"
      )}
    >
      {label}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelative(iso: string): string {
  const diffSec = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  );
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 30) return `${Math.round(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
