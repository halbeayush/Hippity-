import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";

type RouteParams = { params: Promise<{ id: string }> };

// PATCH /api/social/recommendations/:id — the recipient resolves a pending
// recommendation. "listened" also saves the album into their own Library
// (same as marking a to-do item listened elsewhere in the app); "reject"
// just closes it out. Either way frees up one of the sender's 3 slots to
// this recipient, since that count is just live pending rows.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = await request.json();
  const action = body?.action;

  if (action !== "listened" && action !== "reject") {
    return NextResponse.json(
      { error: "action must be 'listened' or 'reject'" },
      { status: 400 },
    );
  }

  const userId = await getCurrentUserId();
  const recommendation = await prisma.recommendationSent.findUnique({
    where: { id: Number(id) },
  });
  if (!recommendation || recommendation.recipientId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (recommendation.status !== "pending") {
    return NextResponse.json(
      { error: "Already resolved" },
      { status: 409 },
    );
  }

  const updated = await prisma.recommendationSent.update({
    where: { id: Number(id) },
    data: {
      status: action === "listened" ? "listened" : "rejected",
      resolvedAt: new Date(),
    },
  });

  if (action === "listened") {
    const album = await prisma.album.upsert({
      where: { userId_mbid: { userId, mbid: recommendation.mbid } },
      update: { status: "library", listenedAt: new Date() },
      create: {
        userId,
        mbid: recommendation.mbid,
        title: recommendation.title,
        artist: recommendation.artist,
        coverArtUrl: recommendation.coverArtUrl,
        status: "library",
        listenedAt: new Date(),
      },
    });
    await prisma.activity.create({
      data: { userId, albumId: album.id, type: "added_library" },
    });
  }

  return NextResponse.json({ recommendation: updated });
}
