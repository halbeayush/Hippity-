import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";

type RouteParams = { params: Promise<{ id: string }> };

// PATCH /api/social/friends/:id — accept an incoming friend request.
export async function PATCH(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const userId = await getCurrentUserId();

  const friendship = await prisma.friendship.findUnique({
    where: { id: Number(id) },
  });
  if (!friendship || friendship.recipientId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.friendship.update({
    where: { id: Number(id) },
    data: { status: "accepted" },
  });

  return NextResponse.json({ friendship: updated });
}

// DELETE /api/social/friends/:id — decline an incoming request, cancel an
// outgoing one, or remove an existing friend.
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const userId = await getCurrentUserId();

  const friendship = await prisma.friendship.findUnique({
    where: { id: Number(id) },
  });
  if (
    !friendship ||
    (friendship.requesterId !== userId && friendship.recipientId !== userId)
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.friendship.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
