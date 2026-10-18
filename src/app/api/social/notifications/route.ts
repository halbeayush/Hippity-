import { NextResponse } from "next/server";
import { getCurrentUserId, withSignIn } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";

// GET /api/social/notifications — how many things are waiting on the
// current user: friend requests to accept or decline, and recommended
// albums to mark listened or pass on. Drives the badge on the Social tab
// (see TopNav); each count drops as soon as the item is dealt with.
export const GET = withSignIn(async () => {
  const userId = await getCurrentUserId();
  const [friendRequests, recommendations] = await Promise.all([
    prisma.friendship.count({ where: { recipientId: userId, status: "pending" } }),
    prisma.recommendationSent.count({
      where: { recipientId: userId, status: "pending" },
    }),
  ]);
  return NextResponse.json(
    { friendRequests, recommendations },
    // Per-user, so never cached by the CDN.
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
