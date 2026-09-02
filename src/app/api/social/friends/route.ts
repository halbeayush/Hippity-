import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";

const USER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarColor: true,
} as const;

// GET /api/social/friends — accepted friends, plus incoming and outgoing
// pending requests, for the current user.
export async function GET() {
  const userId = await getCurrentUserId();

  const friendships = await prisma.friendship.findMany({
    where: { OR: [{ requesterId: userId }, { recipientId: userId }] },
    include: {
      requester: { select: USER_SELECT },
      recipient: { select: USER_SELECT },
    },
    orderBy: { createdAt: "desc" },
  });

  const friends = [];
  const incoming = [];
  const outgoing = [];

  for (const f of friendships) {
    const isRequester = f.requesterId === userId;
    const other = isRequester ? f.recipient : f.requester;
    if (f.status === "accepted") {
      friends.push(other);
    } else if (isRequester) {
      outgoing.push({ friendshipId: f.id, user: other });
    } else {
      incoming.push({ friendshipId: f.id, user: other });
    }
  }

  return NextResponse.json({ friends, incoming, outgoing });
}

// POST /api/social/friends — send a friend request by username. If the
// target already sent us a pending request, this accepts it instead of
// creating a duplicate.
export async function POST(request: NextRequest) {
  const body = await request.json();
  const username = (body?.username ?? "").trim();
  if (!username) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  const userId = await getCurrentUserId();
  const target = await prisma.user.findUnique({ where: { username } });
  if (!target) {
    return NextResponse.json({ error: "No user with that username" }, { status: 404 });
  }
  if (target.id === userId) {
    return NextResponse.json({ error: "That's you" }, { status: 400 });
  }

  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: userId, recipientId: target.id },
        { requesterId: target.id, recipientId: userId },
      ],
    },
  });

  if (existing) {
    if (existing.status === "accepted") {
      return NextResponse.json({ error: "Already friends" }, { status: 409 });
    }
    if (existing.requesterId === userId) {
      return NextResponse.json({ error: "Request already sent" }, { status: 409 });
    }
    const friendship = await prisma.friendship.update({
      where: { id: existing.id },
      data: { status: "accepted" },
    });
    return NextResponse.json({ friendship, autoAccepted: true });
  }

  const friendship = await prisma.friendship.create({
    data: { requesterId: userId, recipientId: target.id },
  });

  return NextResponse.json({ friendship }, { status: 201 });
}
