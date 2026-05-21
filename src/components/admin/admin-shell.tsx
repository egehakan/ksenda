import { AdminSidebar } from "./admin-sidebar";

interface AdminShellProps {
  adminEmail: string;
  children: React.ReactNode;
}

/**
 * Full-bleed admin layout. Sidebar on the left, scrolling main column on the
 * right. Mirrors the tenant shell but uses its own navigation and visual
 * identity (Admin eyebrow in the header) so the operator can never confuse
 * which realm they're in.
 */
export function AdminShell({ adminEmail, children }: AdminShellProps) {
  return (
    <div className="min-h-dvh flex bg-[var(--color-canvas)]">
      <AdminSidebar adminEmail={adminEmail} />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
