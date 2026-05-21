"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Linkedin, ExternalLink } from "lucide-react";

interface EmailReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  company: {
    id: string;
    name: string;
    domain: string;
    pipelineState: string;
    targetContactEmail?: string | null;
    targetContactLinkedinUrl?: string | null;
    targetContactFirstName?: string | null;
    targetContactLastName?: string | null;
    targetContactTitle?: string | null;
    email?: {
      id: string;
      channel?: string | null;
      subject?: string | null;
      body: string;
      editedSubject?: string | null;
      editedBody?: string | null;
      finalSubject?: string | null;
      finalBody?: string | null;
    } | null;
  } | null;
  onSave: (emailId: string, subject: string, body: string, recipientEmail?: string) => Promise<void>;
  onApprove: (emailId: string, subject: string, body: string) => Promise<void>;
  onSend?: (emailId: string, recipientEmail: string, senderEmail: string, subject: string, body: string) => Promise<void>;
  /** LinkedIn manual-send: open the URL + flip the row sent. */
  onMarkLinkedInSent?: (companyId: string) => Promise<void>;
  onRegenerate?: (companyId: string) => Promise<void>;
}

interface SettingsResponse {
  settings: {
    senderEmail: string | null;
    senderName: string | null;
    signature: string | null;
  };
  userEmail: string | null;
  envFallback: {
    senderEmail: string | null;
  };
}

export function EmailReviewModal({
  isOpen,
  onClose,
  company,
  onSave,
  onApprove,
  onSend,
  onMarkLinkedInSent,
  onRegenerate,
}: EmailReviewModalProps) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const isApproved = company?.pipelineState === "approved_to_send";
  // Sent emails are immutable history — render the modal read-only.
  const isSent = company?.pipelineState === "sent";
  // Approved + sent both reflect the finalized (sent) copy, not the draft.
  const useFinalCopy = isApproved || isSent;
  const isLinkedIn = (company?.email?.channel || "email") === "linkedin";

  // Always fetch when the modal is open (not just on approved state). The
  // signature preview is rendered for every pipeline tab so authors see
  // what recipients see, regardless of whether the email is yet sendable.
  const { data: settingsData } = useQuery<SettingsResponse>({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
    enabled: isOpen,
  });

  const signatureHtml = settingsData?.settings?.signature || "";

  const defaultSenderEmail =
    settingsData?.settings?.senderEmail ||
    settingsData?.userEmail ||
    settingsData?.envFallback?.senderEmail ||
    "";

  useEffect(() => {
    if (isOpen && isApproved && defaultSenderEmail && !senderEmail) {
      setSenderEmail(defaultSenderEmail);
    }
  }, [isOpen, isApproved, defaultSenderEmail, senderEmail]);

  useEffect(() => {
    if (company?.email) {
      const initialSubject = useFinalCopy
        ? company.email.finalSubject || company.email.editedSubject || company.email.subject || ""
        : company.email.editedSubject || company.email.subject || "";
      const initialBody = useFinalCopy
        ? company.email.finalBody || company.email.editedBody || company.email.body
        : company.email.editedBody || company.email.body;
      setSubject(initialSubject);
      setBody(initialBody);
      setHasChanges(false);
    }
    if (company?.targetContactEmail) {
      setRecipientEmail(company.targetContactEmail);
    }
  }, [company, useFinalCopy]);

  useEffect(() => {
    if (!isOpen) setSenderEmail("");
  }, [isOpen]);

  useEffect(() => {
    if (company?.email) {
      const originalSubject = useFinalCopy
        ? company.email.finalSubject || company.email.editedSubject || company.email.subject || ""
        : company.email.editedSubject || company.email.subject || "";
      const originalBody = useFinalCopy
        ? company.email.finalBody || company.email.editedBody || company.email.body
        : company.email.editedBody || company.email.body;
      const originalRecipient = company.targetContactEmail || "";

      const hasContentChanges = subject !== originalSubject || body !== originalBody;
      const hasRecipientChange = isApproved && recipientEmail !== originalRecipient;

      setHasChanges(hasContentChanges || hasRecipientChange);
    }
  }, [subject, body, recipientEmail, company, isApproved, useFinalCopy]);

  const handleSave = async () => {
    if (!company?.email) return;
    setIsSaving(true);
    try {
      await onSave(company.email.id, subject, body, isApproved ? recipientEmail : undefined);
    } finally {
      setIsSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!company?.email) return;
    setIsApproving(true);
    try {
      await onApprove(company.email.id, subject, body);
      onClose();
    } finally {
      setIsApproving(false);
    }
  };

  const handleSend = async () => {
    if (!company?.email || !onSend || !recipientEmail || !senderEmail) return;
    setIsSending(true);
    try {
      await onSend(company.email.id, recipientEmail, senderEmail, subject, body);
      onClose();
    } finally {
      setIsSending(false);
    }
  };

  const handleRegenerate = async () => {
    if (!company?.id || !onRegenerate) return;
    setIsRegenerating(true);
    try {
      await onRegenerate(company.id);
      onClose();
    } finally {
      setIsRegenerating(false);
    }
  };

  const isValidRecipientEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail);
  const isValidSenderEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail);

  if (!company?.email) return null;

  const wordCount = body.split(/\s+/).filter(Boolean).length;
  const charCount = body.length;
  const isAnyLoading = isSaving || isApproving || isSending || isRegenerating;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>
                {isLinkedIn
                  ? isSent
                    ? "Sent LinkedIn message"
                    : "Review LinkedIn message"
                  : isSent
                    ? "Sent email"
                    : "Review email"}
              </DialogTitle>
              <DialogDescription className="font-mono text-[12px] text-[var(--color-fg-muted)] mt-1">
                {company.name} <span className="text-[var(--color-fg-subtle)]">·</span> {company.domain}
              </DialogDescription>
            </div>
            {hasChanges && !isSent && (
              <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-accent)]">
                Unsaved
              </span>
            )}
          </div>
        </DialogHeader>

        <div className="border-t border-[var(--color-line)] my-4" />

        <ScrollArea className="flex-1 min-h-0 pr-4">
          <div className="space-y-7">
            {isLinkedIn && (
              <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-accent)]">
                <Linkedin className="h-3 w-3" />
                LinkedIn message — sent manually from your account
              </div>
            )}

            {/* Pending-review recipient block. The approved + sent states have
                their own richer recipient sections below; here we just surface
                the contact + a clickable LinkedIn URL so the reviewer can open
                the prospect's profile while editing. */}
            {!isApproved && !isSent && (
              <div className="space-y-2">
                <Label>{isLinkedIn ? "LinkedIn profile" : "Recipient"}</Label>
                {(company.targetContactFirstName || company.targetContactTitle) && (
                  <div className="text-[12px] text-[var(--color-fg-muted)]">
                    {company.targetContactFirstName} {company.targetContactLastName}
                    {company.targetContactTitle && (
                      <span className="text-[var(--color-fg-subtle)]">
                        {" "}
                        · {company.targetContactTitle}
                      </span>
                    )}
                  </div>
                )}
                {isLinkedIn ? (
                  company.targetContactLinkedinUrl ? (
                    <a
                      href={company.targetContactLinkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 font-mono text-[12px] text-[var(--color-accent)] hover:underline break-all"
                    >
                      {company.targetContactLinkedinUrl}
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  ) : (
                    <p className="font-mono text-[12px] text-[var(--color-status-error)]">
                      No LinkedIn URL on file for this contact.
                    </p>
                  )
                ) : (
                  <div className="font-mono text-[12px] text-[var(--color-fg-muted)] break-all">
                    {company.targetContactEmail || "—"}
                  </div>
                )}
              </div>
            )}

            {isApproved && !isLinkedIn && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="sender">From</Label>
                  <Input
                    id="sender"
                    type="email"
                    value={senderEmail}
                    onChange={(e) => setSenderEmail(e.target.value)}
                    placeholder={defaultSenderEmail || "you@yourdomain.com"}
                    className="font-mono text-[13px]"
                  />
                  {!isValidSenderEmail && senderEmail && (
                    <p className="text-[12px] text-[var(--color-status-error)]">
                      Enter a valid email address.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="recipient">To</Label>
                  {company.targetContactFirstName && (
                    <div className="text-[12px] text-[var(--color-fg-muted)]">
                      {company.targetContactFirstName} {company.targetContactLastName}
                      {company.targetContactTitle && (
                        <span className="text-[var(--color-fg-subtle)]"> · {company.targetContactTitle}</span>
                      )}
                    </div>
                  )}
                  <Input
                    id="recipient"
                    type="email"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    placeholder="contact@example.com"
                    className="font-mono text-[13px]"
                  />
                  {!isValidRecipientEmail && recipientEmail && (
                    <p className="text-[12px] text-[var(--color-status-error)]">
                      Enter a valid email address.
                    </p>
                  )}
                </div>
              </>
            )}

            {isApproved && isLinkedIn && (
              <div className="space-y-2">
                <Label>Recipient</Label>
                {company.targetContactFirstName && (
                  <div className="text-[12px] text-[var(--color-fg-muted)]">
                    {company.targetContactFirstName} {company.targetContactLastName}
                    {company.targetContactTitle && (
                      <span className="text-[var(--color-fg-subtle)]"> · {company.targetContactTitle}</span>
                    )}
                  </div>
                )}
                {company.targetContactLinkedinUrl ? (
                  <a
                    href={company.targetContactLinkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-mono text-[12px] text-[var(--color-accent)] hover:underline truncate"
                  >
                    {company.targetContactLinkedinUrl}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ) : (
                  <p className="font-mono text-[12px] text-[var(--color-status-error)]">
                    No LinkedIn URL on file for this contact.
                  </p>
                )}
              </div>
            )}

            {isSent && (
              <div className="space-y-2">
                <Label>{isLinkedIn ? "LinkedIn profile" : "To"}</Label>
                {company.targetContactFirstName && (
                  <div className="text-[12px] text-[var(--color-fg-muted)]">
                    {company.targetContactFirstName} {company.targetContactLastName}
                    {company.targetContactTitle && (
                      <span className="text-[var(--color-fg-subtle)]"> · {company.targetContactTitle}</span>
                    )}
                  </div>
                )}
                <div className="font-mono text-[13px] text-[var(--color-fg)] rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2 break-all">
                  {isLinkedIn
                    ? company.targetContactLinkedinUrl || "—"
                    : recipientEmail || company.targetContactEmail || "—"}
                </div>
              </div>
            )}

            {!isLinkedIn && (
              <div className="space-y-2">
                <Label htmlFor="subject">Subject</Label>
                {isSent ? (
                  <div className="text-[15px] text-[var(--color-fg)] rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2">
                    {subject}
                  </div>
                ) : (
                  <>
                    <Input
                      id="subject"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="Subject line"
                      className="text-[15px]"
                    />
                    <p className="font-mono text-[11px] text-[var(--color-fg-muted)] tabular-nums">
                      {subject.length} chars
                      <span className="text-[var(--color-fg-subtle)]"> · keep under 60 for deliverability</span>
                    </p>
                  </>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="body">{isLinkedIn ? "Message" : "Body"}</Label>
              {isSent ? (
                <div className="min-h-[320px] font-mono text-[13px] leading-[1.6] text-[var(--color-fg)] rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-3 whitespace-pre-wrap">
                  {body}
                </div>
              ) : (
                <>
                  <Textarea
                    id="body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={isLinkedIn ? "LinkedIn DM" : "Email body"}
                    className={
                      isLinkedIn
                        ? "min-h-[200px] font-mono text-[13px] leading-[1.6]"
                        : "min-h-[320px] font-mono text-[13px] leading-[1.6]"
                    }
                  />
                  <div className="flex justify-between font-mono text-[11px] text-[var(--color-fg-muted)] tabular-nums">
                    <span>
                      {wordCount} words <span className="text-[var(--color-fg-subtle)]">·</span> {charCount} chars
                    </span>
                    {isLinkedIn ? (
                      <span
                        className={
                          charCount > 600 ? "text-[var(--color-status-error)]" : ""
                        }
                      >
                        {charCount > 600 ? "Too long" : "Target 50–90 words"}
                      </span>
                    ) : (
                      <span className={charCount > 2000 ? "text-[var(--color-status-error)]" : ""}>
                        {charCount > 2000 ? "Too long" : "Target 150–250 words"}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>

            {!isLinkedIn && signatureHtml ? (
              <div className="space-y-2">
                <Label>Signature</Label>
                {/* Read-only — edit at Settings → Signature. White
                    background so the all-black HTML signature renders the
                    way recipients see it in Gmail / Outlook / Apple Mail. */}
                <div className="border border-[var(--color-line)] rounded-md overflow-hidden">
                  <div className="px-3 py-1.5 bg-[var(--color-panel)] border-b border-[var(--color-line)] font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)] flex items-center justify-between">
                    <span>Appended on send · read-only</span>
                    <span className="text-[var(--color-fg-muted)] normal-case tracking-normal">
                      Edit in Settings
                    </span>
                  </div>
                  <div
                    className="bg-white p-4 select-text"
                    style={{ color: "#000000" }}
                  >
                    <div
                      className="max-w-none"
                      style={{ color: "#000000" }}
                      dangerouslySetInnerHTML={{ __html: signatureHtml }}
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </ScrollArea>

        <div className="border-t border-[var(--color-line)] my-4" />

        <DialogFooter className="flex-shrink-0">
          {isSent ? (
            <div className="flex justify-end w-full">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          ) : (
          <div className="flex items-center justify-between w-full">
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose} disabled={isAnyLoading}>
                Cancel
              </Button>
              {onRegenerate && (
                <Button variant="outline" onClick={handleRegenerate} disabled={isAnyLoading}>
                  {isRegenerating && <Loader2 className="h-3 w-3 animate-spin" />}
                  Regenerate
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {isApproved ? (
                isLinkedIn ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={handleSave}
                      disabled={isAnyLoading || !hasChanges}
                    >
                      {isSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                      Save
                    </Button>
                    <Button
                      onClick={async () => {
                        if (!company.email) return;
                        if (hasChanges) {
                          await onSave(company.email.id, subject, body);
                        }
                        if (onMarkLinkedInSent) {
                          setIsSending(true);
                          try {
                            await onMarkLinkedInSent(company.id);
                            onClose();
                          } finally {
                            setIsSending(false);
                          }
                        }
                      }}
                      disabled={isAnyLoading || !body.trim() || !company.targetContactLinkedinUrl}
                    >
                      {isSending && <Loader2 className="h-3 w-3 animate-spin" />}
                      Open LinkedIn & mark sent
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      onClick={handleSave}
                      disabled={isAnyLoading || !hasChanges}
                    >
                      {isSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                      Save
                    </Button>
                    <Button
                      onClick={handleSend}
                      disabled={
                        isAnyLoading ||
                        !subject.trim() ||
                        !body.trim() ||
                        !isValidRecipientEmail ||
                        !isValidSenderEmail
                      }
                    >
                      {isSending && <Loader2 className="h-3 w-3 animate-spin" />}
                      Send
                    </Button>
                  </>
                )
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={handleSave}
                    disabled={isAnyLoading || !hasChanges}
                  >
                    {isSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                    Save draft
                  </Button>
                  <Button
                    onClick={handleApprove}
                    disabled={
                      isAnyLoading ||
                      (!isLinkedIn && !subject.trim()) ||
                      !body.trim()
                    }
                  >
                    {isApproving && <Loader2 className="h-3 w-3 animate-spin" />}
                    Approve
                  </Button>
                </>
              )}
            </div>
          </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
