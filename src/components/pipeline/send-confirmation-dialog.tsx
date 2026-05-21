"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface SendConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (recipientEmail: string, senderEmail: string) => Promise<void>;
  company: {
    name: string;
    targetContactEmail?: string | null;
    targetContactFirstName?: string | null;
    targetContactLastName?: string | null;
    targetContactTitle?: string | null;
    email?: {
      finalSubject?: string | null;
      subject?: string | null;
    } | null;
  } | null;
  isLoading?: boolean;
}

interface SettingsResponse {
  settings: {
    senderEmail: string | null;
    senderName: string | null;
  };
  userEmail: string | null;
  envFallback: {
    senderEmail: string | null;
  };
}

export function SendConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  company,
  isLoading = false,
}: SendConfirmationDialogProps) {
  const [recipientEmail, setRecipientEmail] = useState("");
  const [senderEmail, setSenderEmail] = useState("");

  const { data: settingsData } = useQuery<SettingsResponse>({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
    enabled: isOpen,
  });

  const defaultSenderEmail =
    settingsData?.settings?.senderEmail ||
    settingsData?.userEmail ||
    settingsData?.envFallback?.senderEmail ||
    "";

  useEffect(() => {
    if (isOpen) {
      if (company?.targetContactEmail) setRecipientEmail(company.targetContactEmail);
      if (defaultSenderEmail) setSenderEmail(defaultSenderEmail);
    }
  }, [isOpen, company?.targetContactEmail, defaultSenderEmail]);

  useEffect(() => {
    if (!isOpen) {
      setRecipientEmail("");
      setSenderEmail("");
    }
  }, [isOpen]);

  const handleConfirm = async () => {
    await onConfirm(recipientEmail, senderEmail);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && !isLoading) onClose();
  };

  const isValidRecipientEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail);
  const isValidSenderEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail);
  const canSend = isValidRecipientEmail && isValidSenderEmail && !isLoading;

  const subject = company?.email?.finalSubject || company?.email?.subject || "";

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send email</DialogTitle>
          <DialogDescription>
            Sending to <span className="font-medium">{company?.name}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Subject preview */}
          <div>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-muted)] mb-1.5">
              Subject
            </div>
            <div className="text-[14px] text-[var(--color-fg)] truncate">{subject}</div>
          </div>

          {/* Sender */}
          <div className="space-y-2">
            <Label htmlFor="sender-confirm">From</Label>
            <Input
              id="sender-confirm"
              type="email"
              value={senderEmail}
              onChange={(e) => setSenderEmail(e.target.value)}
              placeholder={defaultSenderEmail || "you@yourdomain.com"}
              className="font-mono text-[13px]"
              disabled={isLoading}
            />
            {!isValidSenderEmail && senderEmail && (
              <p className="text-[12px] text-[var(--color-status-error)]">
                Enter a valid email address.
              </p>
            )}
          </div>

          {/* Recipient */}
          <div className="space-y-2">
            <Label htmlFor="recipient-confirm">To</Label>
            {company?.targetContactFirstName && (
              <div className="text-[12px] text-[var(--color-fg-muted)]">
                {company.targetContactFirstName} {company.targetContactLastName}
                {company.targetContactTitle && (
                  <span className="text-[var(--color-fg-subtle)]"> · {company.targetContactTitle}</span>
                )}
              </div>
            )}
            <Input
              id="recipient-confirm"
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="contact@example.com"
              className="font-mono text-[13px]"
              disabled={isLoading}
            />
            {!isValidRecipientEmail && recipientEmail && (
              <p className="text-[12px] text-[var(--color-status-error)]">
                Enter a valid email address.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canSend}>
            {isLoading ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Sending
              </>
            ) : (
              "Send"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
