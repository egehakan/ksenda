"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface DeleteConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (alsoDeleteFromFetched: boolean) => Promise<void>;
  count: number;
  isLoading?: boolean;
}

export function DeleteConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  count,
  isLoading = false,
}: DeleteConfirmationDialogProps) {
  const [alsoDeleteFromFetched, setAlsoDeleteFromFetched] = useState(false);

  const handleConfirm = async () => {
    await onConfirm(alsoDeleteFromFetched);
    setAlsoDeleteFromFetched(false);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && !isLoading) {
      setAlsoDeleteFromFetched(false);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {count === 1 ? "Delete company" : `Delete ${count} companies`}
          </DialogTitle>
          <DialogDescription>
            {count === 1
              ? "This can't be undone."
              : `Permanent. ${count} companies will be removed.`}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <label
            htmlFor="delete-from-fetched"
            className="flex items-start gap-3 cursor-pointer select-none"
          >
            <Checkbox
              id="delete-from-fetched"
              checked={alsoDeleteFromFetched}
              onCheckedChange={(checked) =>
                setAlsoDeleteFromFetched(checked === true)
              }
              disabled={isLoading}
              className="mt-0.5"
            />
            <div className="space-y-1">
              <Label
                htmlFor="delete-from-fetched"
                className="text-[13px] font-medium normal-case tracking-normal text-[var(--color-fg)]"
              >
                Also remove from search history
              </Label>
              <p className="text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
                If checked, these companies can show up in future Apollo searches again.
                If unchecked, they stay excluded.
              </p>
            </div>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isLoading}
            variant="destructive"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Deleting
              </>
            ) : (
              "Delete"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
