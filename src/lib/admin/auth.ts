import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { AuthRequiredError, verifyPassword } from "@/lib/auth";

/**
 * Admin auth realm. Parallel to the tenant auth in `@/lib/auth` but uses a
 * separate cookie (`admin_auth_token`) and JWT payload (carries `role: "ADMIN"`)
 * so admin sessions can never be confused with tenant sessions even though
 * both live in the same User table.
 */

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "your-secret-key-change-in-production"
);

export const ADMIN_COOKIE_NAME = "admin_auth_token";
const ADMIN_TOKEN_EXPIRY = "12h";
const ADMIN_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12;

export interface AdminAuthPayload extends JWTPayload {
  userId: string;
  email: string;
  role: "ADMIN";
}

export async function createAdminToken(payload: {
  userId: string;
  email: string;
}): Promise<string> {
  return new SignJWT({ ...payload, role: "ADMIN" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ADMIN_TOKEN_EXPIRY)
    .sign(JWT_SECRET);
}

export async function verifyAdminToken(
  token: string
): Promise<AdminAuthPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (
      payload.role !== "ADMIN" ||
      typeof payload.userId !== "string" ||
      typeof payload.email !== "string"
    ) {
      return null;
    }
    return {
      userId: payload.userId,
      email: payload.email,
      role: "ADMIN",
    };
  } catch {
    return null;
  }
}

export async function getAdminFromCookies(): Promise<AdminAuthPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyAdminToken(token);
}

/**
 * Fetch the admin user row, asserting the DB-level role is still ADMIN.
 * Throws AuthRequiredError on any failure — use at the top of admin pages
 * and server-only API handlers.
 */
export async function requireAdmin() {
  const auth = await getAdminFromCookies();
  if (!auth) throw new AuthRequiredError();
  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user || user.role !== "ADMIN") throw new AuthRequiredError();
  return user;
}

export async function setAdminAuthCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: ADMIN_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
}

export async function clearAdminAuthCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_COOKIE_NAME);
}

export interface AdminLoginResult {
  ok: boolean;
  user?: { id: string; email: string };
  error?: string;
}

/**
 * Validates admin credentials. Always runs bcrypt — even on a missing user —
 * so response time doesn't leak whether the email exists. Returns generic
 * errors so a missing account and a wrong-role account look identical to an
 * attacker.
 */
export async function loginAdmin(
  emailRaw: string,
  password: string
): Promise<AdminLoginResult> {
  const email = emailRaw.trim().toLowerCase();
  if (!email || !password) {
    return { ok: false, error: "Email and password are required" };
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Run bcrypt either way to equalize timing against the missing-user case.
  const dummyHash =
    "$2a$10$abcdefghijklmnopqrstuuG7q/F.HK.LpJ7c8eY5q6S6P0p4S2c8a2";
  const passwordOk = await verifyPassword(
    password,
    user?.passwordHash ?? dummyHash
  );

  // Server-side reason logging — never leaked to the client. Helps the
  // operator self-diagnose "Invalid email or password" from the dev log
  // without weakening the generic public response.
  if (!user) {
    console.log(`[admin-login] no user row for ${email}`);
  } else if (!passwordOk) {
    console.log(
      `[admin-login] password mismatch for ${email} (hash=${user.passwordHash.slice(0, 7)}…)`
    );
  } else if (user.role !== "ADMIN") {
    console.log(`[admin-login] role!=ADMIN for ${email} (role=${user.role})`);
  }

  if (!user || !passwordOk || user.role !== "ADMIN") {
    return { ok: false, error: "Invalid email or password" };
  }

  return { ok: true, user: { id: user.id, email: user.email } };
}

/**
 * Tiny in-memory rate limiter for admin login attempts. Resets on process
 * restart — fine for v1 single-admin protection; replace with Redis/upstash
 * if the admin endpoint ever grows.
 */
const loginAttempts = new Map<string, { count: number; firstAt: number }>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 8;

export function checkAdminLoginRate(key: string): {
  ok: boolean;
  retryAfterSeconds?: number;
} {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.firstAt > RATE_LIMIT_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAt: now });
    return { ok: true };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return {
      ok: false,
      retryAfterSeconds: Math.ceil(
        (entry.firstAt + RATE_LIMIT_WINDOW_MS - now) / 1000
      ),
    };
  }
  entry.count += 1;
  return { ok: true };
}

export function clearAdminLoginRate(key: string): void {
  loginAttempts.delete(key);
}

// Re-export for callers that only import from this file.
export { bcrypt };
