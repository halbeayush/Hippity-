import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";

type RouteParams = { params: Promise<{ id: string }> };

// PATCH /api/albums/:id — update the current user's own saved album's
// rating and/or note.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = await request.json();
  const { rating, note } = body ?? {};

  if (rating !== undefined && rating !== null) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: "rating must be an integer from 1 to 5" },
        { status: 400 },
      );
    }
  }

  const userId = await getCurrentUserId();
  const existing = await prisma.album.findUnique({ where: { id: Number(id) } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const album = await prisma.album.update({
    where: { id: Number(id) },
    data: {
      ...(rating !== undefined ? { rating } : {}),
      ...(note !== undefined ? { note } : {}),
    },
  });

  if (rating != null && rating !== existing.rating) {
    await prisma.activity.create({
      data: { userId, albumId: album.id, type: "rated", rating },
    });
  }

  return NextResponse.json({ album });
}

// DELETE /api/albums/:id — remove one of the current user's own saved
// albums entirely.
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const userId = await getCurrentUserId();
  const existing = await prisma.album.findUnique({ where: { id: Number(id) } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.album.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
