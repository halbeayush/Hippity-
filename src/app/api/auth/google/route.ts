import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  GOOGLE_STATE_COOKIE,
  GOOGLE_STATE_MAX_AGE_S,
  googleConfig,
  startGoogleSignIn,
} from "@/lib/googleAuth";

// GET /api/auth/google — sends the browser to Google's sign-in page; Google
// sends it back to /api/auth/google/callback.
export async function GET(request: NextRequest) {
  const config = googleConfig();
  if (!config) {
    return NextResponse.redirect(
      new URL("/login?error=google-not-configured", request.nextUrl),
    );
  }

  const { url, cookieValue } = startGoogleSignIn(
    config.clientId,
    request.nextUrl.origin,
  );
  const cookieStore = await cookies();
  cookieStore.set(GOOGLE_STATE_COOKIE, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // "lax" so it's sent on Google's top-level redirect back to us.
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: GOOGLE_STATE_MAX_AGE_S,
  });
  return NextResponse.redirect(url);
}
