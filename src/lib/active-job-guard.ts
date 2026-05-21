import { NextResponse } from "next/server";
import { getActiveBlockingJob } from "@/lib/services/jobs";

/**
 * App-wide single-flight guard. A user may have at most ONE Inngest-backed
 * job in flight at a time across the whole app — automation run, AI
 * search, company/people import, batch process/send/retry, or follow-up
 * generation. Every route that dispatches an Inngest event calls this
 * right after auth (and any API-key checks) and returns the 409 if one is
 * blocking.
 *
 * `getActiveBlockingJob` reaps stale jobs first, so a crashed run never
 * locks the account forever, and fails OPEN on a DB read error (the
 * per-user Inngest concurrency of 1 is the backstop). This is the
 * authoritative enforcement; the UI's `useAccountBusy` disable is cosmetic.
 *
 * Returns a 409 `NextResponse` to short-circuit the route, or `null` when
 * the account is idle and the caller should proceed.
 */
export async function blockIfJobActive(
  userId: string
): Promise<NextResponse | null> {
  const active = await getActiveBlockingJob(userId);
  if (!active) return null;
  return NextResponse.json(
    {
      error: "A job is already running for this account. Wait for it to finish.",
      jobId: active.id,
      kind: active.kind,
    },
    { status: 409 }
  );
}
