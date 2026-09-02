import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/currentUser";
import { areFriends } from "@/lib/friends";
import { prisma } from "@/lib/prisma";

// GET /api/social/top-tracks?userId= — a user's most recent week of top-5
// tracks. Defaults to the current user; pass userId to view a friend's
// chart. Falls back to their latest seeded week if the current week hasn't
// been populated.
export async function GET(request: NextRequest) {
  const userIdParam = request.nextUrl.searchParams.get("userId");
  const currentUserId = await getCurrentUserId();
  const targetUserId = userIdParam ? Number(userIdParam) : currentUserId;

  if (
    targetUserId !== currentUserId &&
    !(await areFriends(currentUserId, targetUserId))
  ) {
    return NextResponse.json(
      { error: "Not friends with this user" },
      { status: 403 },
    );
  }

  const latest = await prisma.weeklyTopTrack.findFirst({
    where: { userId: targetUserId },
    orderBy: { weekStart: "desc" },
    select: { weekStart: true },
  });

  if (!latest) return NextResponse.json({ weekStart: null, tracks: [] });

  const tracks = await prisma.weeklyTopTrack.findMany({
    where: { userId: targetUserId, weekStart: latest.weekStart },
    orderBy: { rank: "asc" },
  });

  return NextResponse.json({ weekStart: latest.weekStart, tracks });
}
