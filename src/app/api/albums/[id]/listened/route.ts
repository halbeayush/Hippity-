import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";

type RouteParams = { params: Promise<{ id: string }> };

// POST /api/albums/:id/listened — move one of the current user's own
// albums from the Queue into the Library.
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const userId = await getCurrentUserId();
  const existing = await prisma.album.findUnique({ where: { id: Number(id) } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const album = await prisma.album.update({
    where: { id: Number(id) },
    data: { status: "library", listenedAt: new Date() },
  });

  if (existing.status !== "library") {
    await prisma.activity.create({
      data: { userId, albumId: album.id, type: "added_library" },
    });
  }

  return NextResponse.json({ album });
}
