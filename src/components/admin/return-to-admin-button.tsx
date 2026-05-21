"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export function ReturnToAdminButton({
  formerTargetIdHref,
}: {
  formerTargetIdHref?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const handleClick = async () => {
    setPending(true);
    try {
      const res = await fetch("/api/admin/users/stop-impersonate", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      const dest =
        formerTargetIdHref ||
        (data.formerTargetId
          ? `/admin/users/${data.formerTargetId}`
          : "/admin");
      router.push(dest);
      router.refresh();
    } catch (err) {
      console.error(err);
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-fg)] px-3 py-1 text-[12px] font-semibold text-[var(--color-canvas)] hover:opacity-90 disabled:opacity-60"
    >
      {pending && <Loader2 className="h-3 w-3 animate-spin" />}
      Return to admin
    </button>
  );
}
