"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Inbox,
  Search,
  Users,
  UserCheck,
  Sparkles,
  FileText,
  Settings as SettingsIcon,
  LogOut,
  ChevronLeft,
  Zap,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/ui/brand-logo";

export interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
}

interface AppSidebarProps {
  active: string;
  onSelect: (id: string) => void;
  pendingReviewCount?: number;
  /** Mobile drawer open state (ignored at lg+, where the rail is persistent). */
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
}

/**
 * Navigation rail. At lg+ it's a persistent sticky sidebar that the user can
 * collapse to an icon rail. Below lg it becomes an off-canvas drawer toggled
 * by the header hamburger, with a tap-to-dismiss backdrop — collapse is a
 * desktop-only affordance, so the drawer always renders fully expanded.
 */
export function AppSidebar({
  active,
  onSelect,
  pendingReviewCount,
  mobileOpen = false,
  onMobileOpenChange,
}: AppSidebarProps) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  // Track viewport so the drawer ignores the desktop collapse state.
  const [isMobile, setIsMobile] = useState(false);

  // Persist collapse state to localStorage so it survives reloads.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem("sidebarCollapsed");
    if (stored === "1") setCollapsed(true);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("sidebarCollapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // On the mobile drawer, never render the icon-only collapsed layout.
  const effectiveCollapsed = isMobile ? false : collapsed;

  const { data: meData } = useQuery({
    queryKey: ["currentUser"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
  });

  const items: NavItem[] = [
    { id: "dashboard", label: "Pipeline", icon: Inbox, badge: pendingReviewCount },
    { id: "search", label: "Companies", icon: Search },
    { id: "people", label: "People", icon: Users },
    { id: "clients", label: "Clients", icon: UserCheck },
    { id: "automation", label: "Automation", icon: Zap },
    { id: "prompts", label: "Prompts", icon: FileText },
    { id: "titles", label: "Settings", icon: SettingsIcon },
  ];

  const handleSelect = (id: string) => {
    onSelect(id);
    // Dismiss the drawer after navigating on mobile.
    onMobileOpenChange?.(false);
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <>
      {/* Backdrop — mobile only, when the drawer is open. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => onMobileOpenChange?.(false)}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          // Off-canvas drawer below lg, persistent sticky rail at lg+.
          "fixed lg:sticky top-0 left-0 z-50 lg:z-auto h-dvh flex flex-col shrink-0 border-r",
          "transition-transform duration-200 lg:transition-[width]",
          "bg-[var(--color-sidebar)] border-[var(--color-line-soft)]",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
          // Always full width as a drawer; collapse only applies at lg+.
          "w-[244px]",
          collapsed ? "lg:w-[64px]" : "lg:w-[244px]"
        )}
      >
        {/* Brand */}
        <div
          className={cn(
            "h-[60px] flex items-center px-4 border-b border-[var(--color-line-soft)]",
            effectiveCollapsed && "justify-center px-0"
          )}
        >
          {effectiveCollapsed ? (
            <div className="w-9 h-9 rounded-md bg-[var(--color-raised)] grid place-items-center text-[var(--color-accent)]">
              <Sparkles className="h-4 w-4" />
            </div>
          ) : (
            <BrandLogo height={26} priority />
          )}
          {/* Close button — mobile drawer only. */}
          <button
            type="button"
            onClick={() => onMobileOpenChange?.(false)}
            className="ml-auto lg:hidden text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {items.map((item) => {
            const isActive = item.id === active;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 rounded-md text-[13px] font-medium",
                  "transition-colors duration-150 text-left",
                  effectiveCollapsed ? "h-9 justify-center px-0" : "h-9 px-3",
                  isActive
                    ? "bg-[var(--color-sidebar-active)] text-[var(--color-fg)]"
                    : "text-[var(--color-fg-muted)] hover:bg-[var(--color-sidebar-hover)] hover:text-[var(--color-fg)]"
                )}
                title={effectiveCollapsed ? item.label : undefined}
              >
                <span
                  className={cn(
                    "relative inline-flex items-center justify-center",
                    isActive && !effectiveCollapsed && "text-[var(--color-accent)]"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {isActive && !effectiveCollapsed && (
                    <span className="absolute -left-3 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-full bg-[var(--color-accent)]" />
                  )}
                </span>
                {!effectiveCollapsed && (
                  <span className="flex-1 truncate">{item.label}</span>
                )}
                {!effectiveCollapsed && item.badge != null && item.badge !== 0 && (
                  <span className="ml-auto font-mono text-[10.5px] tabular-nums px-1.5 py-0.5 rounded bg-[var(--color-accent-soft)] text-[var(--color-fg)]">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div
          className={cn(
            "border-t border-[var(--color-line-soft)] p-2 space-y-1",
            effectiveCollapsed && "px-0"
          )}
        >
          {!effectiveCollapsed && meData?.user?.email && (
            <div className="px-3 py-2 text-[11.5px] text-[var(--color-fg-subtle)] truncate font-mono">
              {meData.user.email}
            </div>
          )}
          <button
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className={cn(
              "w-full flex items-center gap-3 rounded-md text-[13px]",
              "text-[var(--color-fg-muted)] hover:bg-[var(--color-sidebar-hover)] hover:text-[var(--color-fg)]",
              "transition-colors duration-150",
              effectiveCollapsed ? "h-9 justify-center" : "h-9 px-3"
            )}
            title={effectiveCollapsed ? "Sign out" : undefined}
          >
            <LogOut className="h-4 w-4" />
            {!effectiveCollapsed && <span>Sign out</span>}
          </button>
          {/* Collapse toggle — desktop only. */}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className={cn(
              "hidden lg:flex w-full items-center gap-3 rounded-md text-[11px]",
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
              <span className="font-mono uppercase tracking-[0.08em]">Collapse</span>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
