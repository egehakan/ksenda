"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Users,
  Workflow,
  Trophy,
  Zap,
  Activity,
  ScrollText,
  ArrowLeft,
  LogOut,
  ShieldCheck,
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AdminNavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
}

const NAV: AdminNavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/pipeline", label: "Pipeline", icon: Workflow },
  { href: "/admin/outcomes", label: "Outcomes", icon: Trophy },
  { href: "/admin/automation", label: "Automation", icon: Zap },
  { href: "/admin/system", label: "System", icon: Activity },
  { href: "/admin/audit", label: "Audit", icon: ScrollText },
];

interface AdminSidebarProps {
  adminEmail: string;
}

export function AdminSidebar({ adminEmail }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem("adminSidebarCollapsed");
    if (stored === "1") setCollapsed(true);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("adminSidebarCollapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  const isActive = (item: AdminNavItem) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await fetch("/api/admin/auth/logout", { method: "POST" });
      router.push("/admin/login");
      router.refresh();
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <aside
      className={cn(
        "sticky top-0 h-dvh flex flex-col shrink-0 border-r transition-[width] duration-150",
        "bg-[var(--color-sidebar)] border-[var(--color-line-soft)]",
        collapsed ? "w-[64px]" : "w-[244px]"
      )}
    >
      <div
        className={cn(
          "h-[60px] flex items-center gap-2 px-4 border-b border-[var(--color-line-soft)]",
          collapsed && "justify-center px-0"
        )}
      >
        <div className="grid h-8 w-8 place-items-center rounded-md bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <ShieldCheck className="h-4 w-4" />
        </div>
        {!collapsed && (
          <div className="flex flex-col leading-tight">
            <span className="text-[13px] font-semibold text-[var(--color-fg)]">
              Ksenda
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)]">
              Admin
            </span>
          </div>
        )}
      </div>

      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {NAV.map((item) => {
          const active = isActive(item);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              className={cn(
                "w-full flex items-center gap-3 rounded-md text-[13px] font-medium",
                "transition-colors duration-150 text-left",
                collapsed ? "h-9 justify-center px-0" : "h-9 px-3",
                active
                  ? "bg-[var(--color-sidebar-active)] text-[var(--color-fg)]"
                  : "text-[var(--color-fg-muted)] hover:bg-[var(--color-sidebar-hover)] hover:text-[var(--color-fg)]"
              )}
              title={collapsed ? item.label : undefined}
            >
              <span
                className={cn(
                  "relative inline-flex items-center justify-center",
                  active && !collapsed && "text-[var(--color-accent)]"
                )}
              >
                <Icon className="h-4 w-4" />
                {active && !collapsed && (
                  <span className="absolute -left-3 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-full bg-[var(--color-accent)]" />
                )}
              </span>
              {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div
        className={cn(
          "border-t border-[var(--color-line-soft)] p-2 space-y-1",
          collapsed && "px-0"
        )}
      >
        {!collapsed && (
          <div className="px-3 py-2 text-[11.5px] text-[var(--color-fg-subtle)] truncate font-mono">
            {adminEmail}
          </div>
        )}
        <Link
          href="/"
          className={cn(
            "w-full flex items-center gap-3 rounded-md text-[13px]",
            "text-[var(--color-fg-muted)] hover:bg-[var(--color-sidebar-hover)] hover:text-[var(--color-fg)]",
            "transition-colors duration-150",
            collapsed ? "h-9 justify-center" : "h-9 px-3"
          )}
          title={collapsed ? "Back to app" : undefined}
        >
          <ArrowLeft className="h-4 w-4" />
          {!collapsed && <span>Back to app</span>}
        </Link>
        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          className={cn(
            "w-full flex items-center gap-3 rounded-md text-[13px]",
            "text-[var(--color-fg-muted)] hover:bg-[var(--color-sidebar-hover)] hover:text-[var(--color-fg)]",
            "transition-colors duration-150",
            collapsed ? "h-9 justify-center" : "h-9 px-3"
          )}
          title={collapsed ? "Sign out" : undefined}
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span>Sign out</span>}
        </button>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className={cn(
            "w-full flex items-center gap-3 rounded-md text-[11px]",
            "text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-muted)]",
            "transition-colors duration-150",
            collapsed ? "h-7 justify-center" : "h-7 px-3"
          )}
          title={collapsed ? "Expand" : "Collapse"}
        >
          <ChevronLeft
            className={cn(
              "h-3 w-3 transition-transform duration-150",
              collapsed && "rotate-180"
            )}
          />
          {!collapsed && (
            <span className="font-mono uppercase tracking-[0.08em]">
              Collapse
            </span>
          )}
        </button>
      </div>
    </aside>
  );
}
