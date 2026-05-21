import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import prisma from "@/lib/prisma";
import {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_FOLLOWUP_PROMPTS,
  DEFAULT_LINKEDIN_INITIAL_PROMPT,
  DEFAULT_LINKEDIN_FOLLOWUP_PROMPTS,
} from "@/lib/constants";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "your-secret-key-change-in-production"
);

const TOKEN_EXPIRY = "7d";
const COOKIE_NAME = "auth_token";
const SALT_ROUNDS = 10;
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface AuthPayload extends JWTPayload {
  userId: string;
  email: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createToken(payload: { userId: string; email: string }): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<AuthPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (typeof payload.userId !== "string" || typeof payload.email !== "string") {
      return null;
    }
    return { userId: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}

export async function getAuthFromCookies(): Promise<AuthPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function getCurrentUser() {
  const auth = await getAuthFromCookies();
  if (!auth) return null;
  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  return user;
}

export class AuthRequiredError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "AuthRequiredError";
  }
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new AuthRequiredError();
  return user;
}

export async function setAuthCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
}

export async function clearAuthCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

function newVerifyToken(): string {
  return randomBytes(32).toString("hex");
}

export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
  companyName?: string;
  companyWebsite?: string;
}

export interface RegisterResult {
  ok: boolean;
  user?: { id: string; email: string };
  /** Plaintext token to email — never sent in responses. */
  verifyToken?: string;
  error?: string;
}

export async function registerUser(input: RegisterInput): Promise<RegisterResult> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password) {
    return { ok: false, error: "Email and password are required" };
  }
  if (input.password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters" };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Invalid email address" };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { ok: false, error: "An account with this email already exists" };
  }

  const passwordHash = await hashPassword(input.password);
  const verifyToken = newVerifyToken();
  const verifyTokenExpiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name: input.name?.trim() || null,
      companyName: input.companyName?.trim() || null,
      companyWebsite: input.companyWebsite?.trim() || null,
      // senderEmail is left NULL on registration so the onboarding Sender
      // step doesn't light up its green checkmark before the user has been
      // there. email-sender.ts falls back to smtpUser when senderEmail is
      // null, so this doesn't break send behavior for users who skip the
      // step.
      verifyToken,
      verifyTokenExpiresAt,
    },
  });

  await seedDefaultsForUser(user.id);

  return {
    ok: true,
    user: { id: user.id, email: user.email },
    verifyToken,
  };
}

export async function seedDefaultsForUser(userId: string): Promise<void> {
  // Email initial prompt
  const existingEmailPrompt = await prisma.prompt.findFirst({
    where: { userId, name: "active_prompt", platform: "email" },
  });
  if (!existingEmailPrompt) {
    await prisma.prompt.create({
      data: {
        userId,
        name: "active_prompt",
        platform: "email",
        content: DEFAULT_SYSTEM_PROMPT,
        description: "Active prompt used for email generation",
        isSystem: false,
        isActive: true,
      },
    });
  }

  // LinkedIn initial prompt
  const existingLinkedInPrompt = await prisma.prompt.findFirst({
    where: { userId, name: "active_prompt", platform: "linkedin" },
  });
  if (!existingLinkedInPrompt) {
    await prisma.prompt.create({
      data: {
        userId,
        name: "active_prompt",
        platform: "linkedin",
        content: DEFAULT_LINKEDIN_INITIAL_PROMPT,
        description: "Active prompt used for LinkedIn message generation",
        isSystem: false,
        isActive: true,
      },
    });
  }

  // Email follow-up prompts (3 steps). Idempotent: any step+platform that
  // already exists is skipped.
  for (const p of DEFAULT_FOLLOWUP_PROMPTS) {
    const existing = await prisma.followUpPrompt.findFirst({
      where: { userId, step: p.step, platform: "email" },
    });
    if (!existing) {
      await prisma.followUpPrompt.create({
        data: {
          userId,
          step: p.step,
          platform: "email",
          dayOffset: p.dayOffset,
          name: p.name,
          content: p.content,
          isActive: true,
        },
      });
    }
  }

  // LinkedIn follow-up prompts (3 steps).
  for (const p of DEFAULT_LINKEDIN_FOLLOWUP_PROMPTS) {
    const existing = await prisma.followUpPrompt.findFirst({
      where: { userId, step: p.step, platform: "linkedin" },
    });
    if (!existing) {
      await prisma.followUpPrompt.create({
        data: {
          userId,
          step: p.step,
          platform: "linkedin",
          dayOffset: p.dayOffset,
          name: p.name,
          content: p.content,
          isActive: true,
        },
      });
    }
  }

  // Target titles are seeded by the onboarding flow rather than registration —
  // the user picks their decision-maker roles explicitly during setup. The
  // /api/target-titles GET route still has a safety-net seed for users who
  // somehow reach the dashboard without titles (e.g. backfilled accounts that
  // never went through onboarding).
}

export interface LoginResult {
  ok: boolean;
  user?: { id: string; email: string };
  needsVerification?: boolean;
  error?: string;
}

export async function loginUser(emailRaw: string, password: string): Promise<LoginResult> {
  const email = emailRaw.trim().toLowerCase();
  if (!email || !password) {
    return { ok: false, error: "Email and password are required" };
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return { ok: false, error: "Invalid email or password" };
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return { ok: false, error: "Invalid email or password" };
  }
  if (!user.emailVerifiedAt) {
    return {
      ok: false,
      needsVerification: true,
      error: "Please verify your email before signing in. Check your inbox for the verification link.",
    };
  }
  return { ok: true, user: { id: user.id, email: user.email } };
}

export interface VerifyEmailResult {
  ok: boolean;
  user?: { id: string; email: string };
  error?: string;
}

/**
 * Consume a verification token. On success, marks the user verified, clears
 * the token, and returns the user so the caller can issue an auth cookie.
 */
export async function verifyEmailToken(token: string): Promise<VerifyEmailResult> {
  if (!token || typeof token !== "string") {
    return { ok: false, error: "Verification token is required" };
  }
  const user = await prisma.user.findFirst({ where: { verifyToken: token } });
  if (!user) {
    return { ok: false, error: "This verification link is invalid or has already been used." };
  }
  if (user.emailVerifiedAt) {
    // Already verified — clear any stale token and treat as success.
    if (user.verifyToken) {
      await prisma.user.update({
        where: { id: user.id },
        data: { verifyToken: null, verifyTokenExpiresAt: null },
      });
    }
    return { ok: true, user: { id: user.id, email: user.email } };
  }
  if (user.verifyTokenExpiresAt && user.verifyTokenExpiresAt.getTime() < Date.now()) {
    return {
      ok: false,
      error: "This verification link has expired. Request a new one to continue.",
    };
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifiedAt: new Date(),
      verifyToken: null,
      verifyTokenExpiresAt: null,
    },
  });
  return { ok: true, user: { id: updated.id, email: updated.email } };
}

export interface ResendVerifyResult {
  /** Always true to prevent account enumeration — only the email side-effect varies. */
  ok: true;
  /** Returned only when an email needs to be sent. */
  send?: { email: string; name: string | null; token: string };
}

/**
 * Mint a fresh verification token for an unverified user. Returns send info
 * for the caller to dispatch the email. We deliberately don't reveal whether
 * the email exists or is already verified.
 */
export async function regenerateVerifyToken(emailRaw: string): Promise<ResendVerifyResult> {
  const email = emailRaw.trim().toLowerCase();
  if (!email) return { ok: true };

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.emailVerifiedAt) {
    return { ok: true };
  }

  const verifyToken = newVerifyToken();
  const verifyTokenExpiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);
  await prisma.user.update({
    where: { id: user.id },
    data: { verifyToken, verifyTokenExpiresAt },
  });

  return {
    ok: true,
    send: { email: user.email, name: user.name, token: verifyToken },
  };
}

export { COOKIE_NAME };
