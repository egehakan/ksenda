import { AlertTriangle } from "lucide-react";
import { getImpersonatingAdminId } from "@/lib/admin/impersonation";
import { getAuthFromCookies } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { ReturnToAdminButton } from "./return-to-admin-button";

/**
 * Strip rendered above the tenant app when the current session is an admin
 * impersonating a tenant. Non-dismissible by design — the operator must
 * explicitly return to admin to drop the borrowed session.
 */
export async function ImpersonationBanner() {
  const adminUserId = await getImpersonatingAdminId();
  if (!adminUserId) return null;

  const tenant = await getAuthFromCookies();
  if (!tenant) return null;

  const [adminRow, tenantRow] = await Promise.all([
    prisma.user.findUnique({
      where: { id: adminUserId },
      select: { email: true, role: true },
    }),
    prisma.user.findUnique({
      where: { id: tenant.userId },
      select: { email: true, id: true },
    }),
  ]);

  // Defensive: if the admin record is gone or no longer ADMIN, hide the banner
  // and let middleware/requireAdmin catch the next admin action.
  if (!adminRow || adminRow.role !== "ADMIN" || !tenantRow) return null;

  return (
    <div className="sticky top-0 z-50 w-full bg-[color-mix(in_oklch,var(--color-status-error)_85%,black)] text-white">
      <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-2 text-[12.5px]">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="font-semibold">Impersonating</span>{" "}
          <span className="font-mono">{tenantRow.email}</span>
          <span className="ml-2 text-white/75">
            · admin actions are real and audited
          </span>
        </div>
        <span className="hidden sm:inline-block font-mono text-[11px] text-white/75">
          {adminRow.email}
        </span>
        <ReturnToAdminButton formerTargetIdHref={`/admin/users/${tenantRow.id}`} />
      </div>
    </div>
  );
}
