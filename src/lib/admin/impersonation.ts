import "server-only";
import { cookies } from "next/headers";
import { createToken, setAuthCookie, clearAuthCookie } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * Impersonation. Distinct from the admin's own admin_auth_token — when
 * impersonation starts, we mint a regular tenant `auth_token` for the target
 * user, and set a marker cookie `impersonating_admin_id` so the UI can show
 * the banner. The admin's admin cookie stays alive throughout, so return-to-
 * admin is one click that just clears the borrowed tenant cookies.
 */

export const IMPERSONATION_COOKIE_NAME = "impersonating_admin_id";
const IMPERSONATION_MAX_AGE = 60 * 60 * 12; // 12h, matches admin session

export interface ImpersonationStartResult {
  ok: true;
  target: { id: string; email: string };
}

export async function startImpersonation(
  adminUserId: string,
  adminEmail: string,
  targetUserId: string
): Promise<ImpersonationStartResult> {
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) {
    throw new Error("Target user not found");
  }
  if (target.role !== "USER") {
    throw new Error("Cannot impersonate non-tenant accounts");
  }

  const token = await createToken({ userId: target.id, email: target.email });
  await setAuthCookie(token);

  const cookieStore = await cookies();
  cookieStore.set(IMPERSONATION_COOKIE_NAME, adminUserId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: IMPERSONATION_MAX_AGE,
    path: "/",
  });

  await prisma.auditLog.create({
    data: {
      userId: target.id,
      entityType: "user",
      entityId: target.id,
      action: "impersonation_start",
      performedBy: adminEmail,
      metadata: { adminUserId } as unknown as object,
    },
  });

  return { ok: true, target: { id: target.id, email: target.email } };
}

export interface ImpersonationStopResult {
  ok: true;
  /** The user that was being impersonated (if any) — useful for redirect targeting. */
  formerTargetId: string | null;
}

export async function stopImpersonation(
  adminEmail: string
): Promise<ImpersonationStopResult> {
  const cookieStore = await cookies();
  const wasImpersonating = !!cookieStore.get(IMPERSONATION_COOKIE_NAME)?.value;

  // Read the current tenant cookie BEFORE clearing it so we can write the
  // audit log with the target's userId.
  let formerTargetId: string | null = null;
  if (wasImpersonating) {
    const auth = await import("@/lib/auth").then((m) => m.getAuthFromCookies());
    formerTargetId = auth?.userId ?? null;
  }

  await clearAuthCookie();
  cookieStore.delete(IMPERSONATION_COOKIE_NAME);

  if (wasImpersonating && formerTargetId) {
    await prisma.auditLog.create({
      data: {
        userId: formerTargetId,
        entityType: "user",
        entityId: formerTargetId,
        action: "impersonation_stop",
        performedBy: adminEmail,
      },
    });
  }

  return { ok: true, formerTargetId };
}

export async function getImpersonatingAdminId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(IMPERSONATION_COOKIE_NAME)?.value ?? null;
}
