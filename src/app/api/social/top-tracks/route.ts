import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId, withSignIn } from "@/lib/currentUser";
import { areFriends } from "@/lib/friends";
import { getTopTracks } from "@/lib/topTracks";

// GET /api/social/top-tracks?userId= — a user's weekly top 5: from their
// connected Last.fm account, or the seeded sample chart for the demo
// friends (see getTopTracks). Defaults to the current user; pass userId to
// view a friend's chart.
export const GET = withSignIn(async (request: NextRequest) => {
  const userIdParam = request.nextUrl.searchParams.get("userId");
  const currentUserId = await getCurrentUserId();
  const targetUserId = userIdParam ? Number(userIdParam) : currentUserId;
  const isSelf = targetUserId === currentUserId;

  if (!isSelf && !(await areFriends(currentUserId, targetUserId))) {
    return NextResponse.json(
      { error: "Not friends with this user" },
      { status: 403 },
    );
  }

  return NextResponse.json(await getTopTracks(targetUserId, isSelf));
});
