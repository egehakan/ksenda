"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Eye, KeyRound, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface UserActionButtonsProps {
  userId: string;
  userEmail: string;
}

export function UserActionButtons({ userId, userEmail }: UserActionButtonsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ImpersonateButton userId={userId} userEmail={userEmail} />
      <ResetPasswordButton userId={userId} userEmail={userEmail} />
      <DeleteUserButton userId={userId} userEmail={userEmail} />
    </div>
  );
}

function ImpersonateButton({
  userId,
  userEmail,
}: {
  userId: string;
  userEmail: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const handleImpersonate = async () => {
    setPending(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/users/${userId}/impersonate`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="default" size="sm" onClick={() => setOpen(true)}>
        <Eye className="h-3.5 w-3.5" />
        Impersonate
      </Button>
      <DialogContent className="border-[var(--color-line)] bg-[var(--color-panel)]">
        <DialogHeader>
          <DialogTitle>Impersonate this tenant?</DialogTitle>
          <DialogDescription className="text-[var(--color-fg-muted)]">
            You will see <span className="font-mono">{userEmail}</span>&apos;s
            dashboard exactly as they do. Any action you take — including
            sending real emails through their SMTP — will be attributed to them
            and is fully audited.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-[13px] text-[var(--color-status-error)]">{error}</p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handleImpersonate} disabled={pending}>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Start impersonation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordButton({
  userId,
  userEmail,
}: {
  userId: string;
  userEmail: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setSuccess(true);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setSuccess(false);
          setError("");
          setPassword("");
        }
      }}
    >
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <KeyRound className="h-3.5 w-3.5" />
        Reset password
      </Button>
      <DialogContent className="border-[var(--color-line)] bg-[var(--color-panel)]">
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription className="text-[var(--color-fg-muted)]">
            Set a new password for <span className="font-mono">{userEmail}</span>.
            They will need to sign in again with the new password.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleReset} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              autoComplete="new-password"
              className="font-mono"
              disabled={pending || success}
            />
            <p className="text-[11.5px] text-[var(--color-fg-subtle)]">
              Minimum 8 characters.
            </p>
          </div>
          {error && (
            <p className="text-[13px] text-[var(--color-status-error)]">{error}</p>
          )}
          {success && (
            <p className="text-[13px] text-[var(--color-status-success)]">
              Password updated.
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {success ? "Close" : "Cancel"}
            </Button>
            {!success && (
              <Button type="submit" disabled={pending || password.length < 8}>
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Update password
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteUserButton({
  userId,
  userEmail,
}: {
  userId: string;
  userEmail: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  const matches = confirm.trim().toLowerCase() === userEmail.toLowerCase();

  const handleDelete = async () => {
    if (!matches) return;
    setPending(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/users/${userId}/delete`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      router.push("/admin/users");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setConfirm("");
          setError("");
        }
      }}
    >
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        <Trash2 className="h-3.5 w-3.5" />
        Delete
      </Button>
      <DialogContent className="border-[var(--color-line)] bg-[var(--color-panel)]">
        <DialogHeader>
          <DialogTitle>Delete this tenant permanently?</DialogTitle>
          <DialogDescription className="text-[var(--color-fg-muted)]">
            This cascades through their Companies, Emails, follow-ups, prompts,
            campaign days, jobs, and audit history. <strong>Irreversible.</strong>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="delete-confirm">
            Type <span className="font-mono">{userEmail}</span> to confirm
          </Label>
          <Input
            id="delete-confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="font-mono"
            disabled={pending}
          />
        </div>
        {error && (
          <p className="text-[13px] text-[var(--color-status-error)]">{error}</p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={!matches || pending}
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Delete forever
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
