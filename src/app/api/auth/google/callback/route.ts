import { timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { signInWithGoogle } from "@/lib/auth";
import {
  finishGoogleSignIn,
  GOOGLE_STATE_COOKIE,
  googleConfig,
} from "@/lib/googleAuth";
import { createSession } from "@/lib/session";

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// GET /api/auth/google/callback?code=&state= — where Google sends the
// browser back after sign-in. Signs in (or creates) the matching account
// and goes to the home page; any failure goes back to /login with an error.
export async function GET(request: NextRequest) {
  const failed = (reason: string) =>
    NextResponse.redirect(new URL(`/login?error=${reason}`, request.nextUrl));

  const config = googleConfig();
  if (!config) return failed("google-not-configured");

  const cookieStore = await cookies();
  const [expectedState, verifier] = (
    cookieStore.get(GOOGLE_STATE_COOKIE)?.value ?? ""
  ).split(".");
  cookieStore.delete({ name: GOOGLE_STATE_COOKIE, path: "/api/auth/google" });

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state") ?? "";
  // Also covers the person cancelling on Google's page (?error=access_denied).
  if (!code || !expectedState || !verifier || !sameString(state, expectedState)) {
    return failed("google");
  }

  try {
    const profile = await finishGoogleSignIn({
      code,
      verifier,
      origin: request.nextUrl.origin,
      ...config,
    });
    const user = await signInWithGoogle(profile);
    await createSession(user.id);
  } catch (err) {
    console.error("Google sign-in failed", err);
    return failed("google");
  }
  return NextResponse.redirect(new URL("/", request.nextUrl));
}
