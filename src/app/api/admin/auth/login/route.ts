import { NextRequest, NextResponse } from "next/server";
import {
  checkAdminLoginRate,
  clearAdminLoginRate,
  createAdminToken,
  loginAdmin,
  setAdminAuthCookie,
} from "@/lib/admin/auth";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    // Trim BOTH fields server-side so trailing whitespace from autofill or
    // copy-paste can't silently break a valid credential.
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password =
      typeof body.password === "string" ? body.password.trim() : "";

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    console.log(
      `[admin-login] attempt for ${email} (pw len=${password.length})`
    );

    // Rate-limit by IP + email together so a single attacker can't burn the
    // budget across many accounts (only one exists, but principle of least
    // surprise).
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    const rateKey = `${ip}::${String(email).toLowerCase()}`;
    const rate = checkAdminLoginRate(rateKey);
    if (!rate.ok) {
      return NextResponse.json(
        {
          error: `Too many attempts. Try again in ${rate.retryAfterSeconds}s.`,
        },
        { status: 429 }
      );
    }

    const result = await loginAdmin(email, password);
    if (!result.ok || !result.user) {
      return NextResponse.json(
        { error: result.error || "Invalid email or password" },
        { status: 401 }
      );
    }

    const token = await createAdminToken({
      userId: result.user.id,
      email: result.user.email,
    });
    await setAdminAuthCookie(token);
    clearAdminLoginRate(rateKey);

    return NextResponse.json({
      success: true,
      user: { email: result.user.email },
    });
  } catch (error) {
    console.error("Admin login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
