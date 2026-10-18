import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId, withSignIn } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";

// GET /api/social/users/search?q= — find users by username to send a
// friend request to.
export const GET = withSignIn(async (request: NextRequest) => {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ users: [] });

  const currentUserId = await getCurrentUserId();

  // Exclude anyone we already have a friendship (accepted or pending) with,
  // so results only ever show people worth sending a fresh request to.
  const existing = await prisma.friendship.findMany({
    where: { OR: [{ requesterId: currentUserId }, { recipientId: currentUserId }] },
    select: { requesterId: true, recipientId: true },
  });
  const excludedIds = new Set(
    existing.flatMap((f) => [f.requesterId, f.recipientId]),
  );
  excludedIds.add(currentUserId);

  const users = await prisma.user.findMany({
    where: {
      id: { notIn: [...excludedIds] },
      username: { contains: q, mode: "insensitive" },
    },
    select: { id: true, username: true, displayName: true, avatarColor: true },
    take: 10,
  });

  return NextResponse.json({ users });
});
