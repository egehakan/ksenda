"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Pencil, AlertCircle } from "lucide-react";
import { CategorizedTitlePicker } from "@/components/onboarding/title-picker";
import { TARGET_TITLE_CATEGORIES } from "@/lib/constants";

interface TargetTitle {
  id: string;
  title: string;
  priority: number;
  isActive: boolean;
}

/*
 * Target titles. The settings surface is read-only by design — the user sees
 * their current selection at a glance, and clicks "Edit titles" to open the
 * same categorized picker the onboarding flow uses. Bulk-replace via PUT,
 * one round-trip on save. Mirrors the spec's "see only / edit in modal" UX.
 */
export function TargetTitleManager() {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["targetTitles"],
    queryFn: async () => {
      const res = await fetch("/api/target-titles");
      if (!res.ok) throw new Error("Failed to fetch titles");
      return res.json() as Promise<{ titles: TargetTitle[] }>;
    },
  });

  const titles: TargetTitle[] = data?.titles || [];

  return (
    <section>
      <div className="mb-6 border-b border-[var(--color-line)] pb-3 flex items-baseline gap-3">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)] tabular-nums">
          06
        </span>
        <h2 className="text-[18px] font-medium leading-none tracking-tight text-[var(--color-fg)]">
          Target titles
        </h2>
        <span className="ml-auto font-mono text-[11px] text-[var(--color-fg-muted)] tabular-nums">
          {titles.length}
        </span>
      </div>

      <p className="mb-5 text-[13px] leading-relaxed text-[var(--color-fg-muted)]">
        Apollo will only return contacts whose title is in this list, in priority
        order top to bottom.
      </p>

      <div className="mb-5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditOpen(true)}
          disabled={isLoading}
        >
          <Pencil className="h-3 w-3" />
          {titles.length === 0 ? "Choose titles" : "Edit titles"}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-3 text-[var(--color-fg-muted)] font-mono text-[12px]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </div>
      ) : titles.length === 0 ? (
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)]">
          No titles yet. Click Choose titles to pick your ICP roles.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {titles.map((title) => (
            <span
              key={title.id}
              className="inline-flex items-center px-2 py-1 border border-[var(--color-line)] text-[12px] text-[var(--color-fg)]"
            >
              {title.title}
            </span>
          ))}
        </div>
      )}

      <EditTitlesDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        currentTitles={titles}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ["targetTitles"] });
          setEditOpen(false);
        }}
      />
    </section>
  );
}

function EditTitlesDialog({
  open,
  onOpenChange,
  currentTitles,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentTitles: TargetTitle[];
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState<string[]>([]);

  // Re-hydrate every time the dialog opens so cancel-then-reopen restores
  // the saved state rather than carrying over the user's discarded edits.
  useEffect(() => {
    if (!open) return;
    const catalogAll = new Set<string>(
      Object.values(TARGET_TITLE_CATEGORIES).flat()
    );
    const next = new Set<string>();
    const customList: string[] = [];
    for (const t of currentTitles) {
      if (catalogAll.has(t.title)) next.add(t.title);
      else customList.push(t.title);
    }
    setSelected(next);
    setCustom(customList);
  }, [open, currentTitles]);

  const totalSelected = selected.size + custom.length;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const ordered: string[] = [];
      // Catalog order first (preserves intentional priority), then any
      // custom titles the user typed in.
      for (const cat of Object.keys(TARGET_TITLE_CATEGORIES) as Array<
        keyof typeof TARGET_TITLE_CATEGORIES
      >) {
        for (const t of TARGET_TITLE_CATEGORIES[cat]) {
          if (selected.has(t)) ordered.push(t);
        }
      }
      for (const t of custom) ordered.push(t);

      const res = await fetch("/api/target-titles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titles: ordered }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => onSaved(),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-4 bg-[var(--color-panel)] border-[var(--color-line)]">
        <DialogHeader>
          <DialogTitle className="text-[var(--color-fg)]">Edit target titles</DialogTitle>
          <DialogDescription className="text-[var(--color-fg-muted)]">
            Pick the decision-maker roles Apollo will search for. Order
            follows the catalog — top of the list is highest priority.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
          <CategorizedTitlePicker
            selected={selected}
            onChange={setSelected}
            customTitles={custom}
            onCustomTitlesChange={setCustom}
            enableAiSuggest
          />
        </div>

        <DialogFooter className="border-t border-[var(--color-line-soft)] pt-4 -mx-4 sm:-mx-6 px-4 sm:px-6 -mb-4 sm:-mb-6 pb-4 sm:pb-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between sm:space-x-0">
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)]">
            {totalSelected} selected
          </span>
          <div className="flex items-center gap-3">
            {saveMutation.isError && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-status-error)]">
                <AlertCircle className="h-3 w-3" />
                {(saveMutation.error as Error).message}
              </span>
            )}
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={saveMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={totalSelected === 0 || saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Saving
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
