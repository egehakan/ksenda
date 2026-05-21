import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "your-secret-key-change-in-production"
);

const COOKIE_NAME = "auth_token";
const ADMIN_COOKIE_NAME = "admin_auth_token";

const PUBLIC_API_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/logout",
  "/api/auth/verify-email",
  "/api/auth/resend-verification",
  // Inngest signs its own requests via INNGEST_SIGNING_KEY — the SDK
  // verifies signatures inside the handler. Don't gate by tenant cookie.
  "/api/inngest",
]);

const PUBLIC_PAGE_PATHS = new Set(["/login", "/register", "/verify-email"]);

const PUBLIC_ADMIN_PATHS = new Set([
  "/admin/login",
  "/api/admin/auth/login",
]);

async function verifyAuth(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

async function verifyAdminAuth(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload.role === "ADMIN";
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Admin realm — checked first so /api/admin/* never falls through to the
  // tenant API gate (which would 401 with the wrong cookie name).
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    if (PUBLIC_ADMIN_PATHS.has(pathname)) {
      return NextResponse.next();
    }
    const adminToken = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
    const adminOk = adminToken ? await verifyAdminAuth(adminToken) : false;

    if (pathname.startsWith("/api/admin")) {
      if (!adminOk) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return NextResponse.next();
    }

    if (!adminOk) {
      const loginUrl = new URL("/admin/login", request.url);
      if (pathname !== "/admin") {
        loginUrl.searchParams.set("redirect", pathname);
      }
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  // ── Tenant realm (existing).
  if (PUBLIC_API_PATHS.has(pathname) || PUBLIC_PAGE_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;

  if (pathname.startsWith("/api/")) {
    if (!token || !(await verifyAuth(token))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (!token || !(await verifyAuth(token))) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match everything except static assets and the public auth pages.
    // Run on every page + API route, EXCEPT:
    // - Next.js internals (_next/*)
    // - Public auth pages (handled inline in middleware)
    // - Anything that looks like a static asset (has a file extension —
    //   .png/.jpg/.svg/.webmanifest/.ico/.json/etc). This frees /public/* from
    //   the auth redirect.
    "/((?!_next/static|_next/image|login|register|verify-email|.*\\..*).*)",
  ],
};
