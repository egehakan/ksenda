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

interface BatchSendConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  count: number;
  isLoading?: boolean;
}

export function BatchSendConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  count,
  isLoading = false,
}: BatchSendConfirmationDialogProps) {
  const handleConfirm = async () => {
    await onConfirm();
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && !isLoading) onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {count === 1 ? "Send email" : `Send ${count} emails`}
          </DialogTitle>
          <DialogDescription>
            {count === 1
              ? "This email will be sent to its target contact. This can't be undone."
              : `${count} emails will be sent to their target contacts. This can't be undone.`}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Sending
              </>
            ) : count === 1 ? (
              "Send"
            ) : (
              `Send ${count}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
