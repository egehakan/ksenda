"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export interface RecipeForDeletion {
  id: string;
  code: string;
  name: string;
  isBuiltIn?: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  recipes: RecipeForDeletion[];
  isLoading?: boolean;
}

/**
 * Recipe-library delete confirmation. Handles single and bulk delete.
 * Lists every recipe being removed so the user sees exactly what's about
 * to disappear — useful when multi-selecting from the library grid.
 *
 * Built-ins are flagged with a "starter" tag in the list. They CAN be
 * deleted (only the per-user copy is removed); the user can re-seed them
 * later from `scripts/seed-built-in-recipes.ts`.
 */
export function RecipeDeleteDialog({
  isOpen,
  onClose,
  onConfirm,
  recipes,
  isLoading = false,
}: Props) {
  const builtInCount = recipes.filter((r) => r.isBuiltIn).length;
  const customCount = recipes.length - builtInCount;
  const isMulti = recipes.length > 1;

  const handleOpenChange = (open: boolean) => {
    if (!open && !isLoading) onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isMulti ? `Delete ${recipes.length} recipes` : "Delete recipe"}
          </DialogTitle>
          <DialogDescription>
            {isMulti
              ? "These recipes will be removed from your library."
              : "This recipe will be removed from your library."}{" "}
            {builtInCount > 0 && (
              <>
                <strong className="text-[var(--color-fg)]">
                  {builtInCount} built-in
                </strong>{" "}
                — you can re-seed built-ins from the CLI later if needed.
              </>
            )}
            {builtInCount > 0 && customCount > 0 && " "}
            {customCount > 0 && (
              <>
                <strong className="text-[var(--color-fg)]">
                  {customCount} custom
                </strong>{" "}
                — cannot be undone.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 max-h-[180px] overflow-y-auto border border-[var(--color-line-soft)] rounded-md">
          {recipes.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-line-soft)] last:border-b-0"
            >
              <span
                className="inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-mono font-semibold bg-[var(--color-panel)] text-[var(--color-fg)] shrink-0"
              >
                {r.code}
              </span>
              <span className="text-[12.5px] truncate text-[var(--color-fg)]">
                {r.name}
              </span>
              {r.isBuiltIn && (
                <span className="ml-auto text-[9.5px] uppercase tracking-wider text-[var(--color-fg-subtle)] shrink-0 font-mono">
                  starter
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Any CampaignDay rows pointing at a deleted recipe will reset to
            a skip day (savedSearchId becomes null). Worth flagging. */}
        <p className="text-[11.5px] text-[var(--color-fg-muted)] leading-snug">
          Scheduled days using these recipes will become skip days. You can
          re-assign them from the calendar afterward.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isLoading} variant="destructive">
            {isLoading ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Deleting
              </>
            ) : isMulti ? (
              `Delete ${recipes.length}`
            ) : (
              "Delete"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
