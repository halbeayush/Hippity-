import { timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId, withSignIn } from "@/lib/currentUser";
import {
  getLastfmSessionName,
  LASTFM_STATE_COOKIE,
  lastfmAuthConfig,
} from "@/lib/lastfm";
import { prisma } from "@/lib/prisma";

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// GET /api/lastfm/callback?state=&token= — where Last.fm sends the browser
// after the person approves. Saves their verified Last.fm username and goes
// back to the Social tab; any failure goes there too, with an error flag.
export const GET = withSignIn(async (request: NextRequest) => {
  const userId = await getCurrentUserId();
  const done = (result: string) =>
    NextResponse.redirect(new URL(`/social?lastfm=${result}`, request.nextUrl));

  const config = lastfmAuthConfig();
  if (!config) return done("not-configured");

  const cookieStore = await cookies();
  const expected = cookieStore.get(LASTFM_STATE_COOKIE)?.value ?? "";
  cookieStore.delete({ name: LASTFM_STATE_COOKIE, path: "/api/lastfm" });

  const state = request.nextUrl.searchParams.get("state") ?? "";
  const token = request.nextUrl.searchParams.get("token");
  if (!token || !expected || !sameString(state, expected)) return done("error");

  try {
    const lastfmUsername = await getLastfmSessionName(token, config);
    await prisma.user.update({ where: { id: userId }, data: { lastfmUsername } });
  } catch (err) {
    console.error("Last.fm sign-in failed", err);
    return done("error");
  }
  return done("connected");
});
