import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/currentUser";
import { getFriendFeed } from "@/lib/feed";

// GET /api/social/activity — friends' recent library/to-do/rating actions
// and recommendations they've sent, merged and most recent first. Shared by
// the Social tab and the Home tab's community feed.
// Kept short so the Social tab stays scannable — just the latest few.
const FEED_LIMIT = 8;

export async function GET() {
  const userId = await getCurrentUserId();
  const activities = await getFriendFeed(userId, FEED_LIMIT);
  return NextResponse.json({ activities });
}
