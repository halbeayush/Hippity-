import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/currentUser";
import { getFriendFeed } from "@/lib/feed";

// GET /api/social/activity — friends' recent library/to-do/rating actions
// and recommendations they've sent, merged and most recent first. Shared by
// the Social tab and the Home tab's community feed.
export async function GET() {
  const userId = await getCurrentUserId();
  const activities = await getFriendFeed(userId);
  return NextResponse.json({ activities });
}
