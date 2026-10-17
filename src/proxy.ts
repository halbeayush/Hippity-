import { NextRequest, NextResponse } from "next/server";
import { readSessionCookie, SESSION_COOKIE } from "@/lib/sessionCookie";

// Runs before every request (see Next.js proxy docs). An optimistic check
// only — a validly signed, unexpired session cookie — so it costs no
// database lookup; each API route still confirms the session against the
// database when it reads the current user (getCurrentUserId).
//
// Signed out: pages redirect to /login, API calls get a 401. Signed in:
// /login redirects home.

// Reachable signed out. The home rows and cover art carry nothing
// user-specific, and the server's startup warm-up (instrumentation.ts)
// fetches the home rows without a session.
const PUBLIC_PATHS = ["/login", "/api/auth", "/api/home", "/api/cover-art"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const signedIn = readSessionCookie(request.cookies.get(SESSION_COOKIE)?.value) !== null;

  if (pathname === "/login" && signedIn) {
    return NextResponse.redirect(new URL("/", request.nextUrl));
  }
  if (signedIn || isPublic(pathname)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const login = new URL("/login", request.nextUrl);
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next's own assets and static files (anything with a
  // file extension, e.g. /favicon.ico).
  matcher: ["/((?!_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)"],
};
