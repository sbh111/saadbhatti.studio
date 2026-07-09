import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap early gate for the admin area: unauthenticated page requests bounce to
 * the login page, unauthenticated admin API requests get a bare 401. This is a
 * UX/latency optimization only — it checks cookie PRESENCE, not validity. The
 * authoritative check (iron-session unseal via getSession()) happens inside
 * every protected Server Component and Route Handler regardless.
 */

// Must match SESSION_COOKIE in lib/auth.ts (literal here to keep bcryptjs out
// of the edge bundle).
const SESSION_COOKIE = "sbh_admin_session";

// Reachable without a session: the login page itself, and the session-status
// endpoint the shell calls to decide whether to show the admin nav entry.
const PUBLIC_PATHS = new Set(["/admin/login", "/api/admin/session"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/admin/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
