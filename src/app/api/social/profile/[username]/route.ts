import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/currentUser";
import { areFriends } from "@/lib/friends";
import { prisma } from "@/lib/prisma";

type RouteParams = { params: Promise<{ username: string }> };

// GET /api/social/profile/:username — a friend's basic profile info. Gates
// the friend profile page: only accepted friends (or yourself) can view it.
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { username } = await params;
  const currentUserId = await getCurrentUserId();

  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true, displayName: true, avatarColor: true },
  });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isSelf = user.id === currentUserId;
  if (!isSelf && !(await areFriends(currentUserId, user.id))) {
    return NextResponse.json(
      { error: "Not friends with this user" },
      { status: 403 },
    );
  }

  return NextResponse.json({ user, isSelf });
}
