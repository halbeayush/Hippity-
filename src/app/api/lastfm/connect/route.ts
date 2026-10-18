import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId, withSignIn } from "@/lib/currentUser";
import {
  LASTFM_STATE_COOKIE,
  lastfmAuthConfig,
  lastfmAuthUrl,
} from "@/lib/lastfm";
import { prisma } from "@/lib/prisma";

const LASTFM_STATE_MAX_AGE_S = 10 * 60;

// GET /api/lastfm/connect — sends the browser to Last.fm to approve; Last.fm
// sends it back to /api/lastfm/callback.
export const GET = withSignIn(async (request: NextRequest) => {
  await getCurrentUserId();
  const config = lastfmAuthConfig();
  if (!config) {
    return NextResponse.redirect(
      new URL("/social?lastfm=not-configured", request.nextUrl),
    );
  }

  const state = randomBytes(16).toString("base64url");
  const callback = new URL("/api/lastfm/callback", request.nextUrl.origin);
  callback.searchParams.set("state", state);

  const cookieStore = await cookies();
  cookieStore.set(LASTFM_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // "lax" so it's sent on Last.fm's top-level redirect back to us.
    sameSite: "lax",
    path: "/api/lastfm",
    maxAge: LASTFM_STATE_MAX_AGE_S,
  });
  return NextResponse.redirect(lastfmAuthUrl(config.apiKey, callback.toString()));
});

// DELETE /api/lastfm/connect — forget the current user's Last.fm account.
export const DELETE = withSignIn(async () => {
  const userId = await getCurrentUserId();
  await prisma.user.update({
    where: { id: userId },
    data: { lastfmUsername: null },
  });
  return NextResponse.json({ ok: true });
});
