import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId, withSignIn } from "@/lib/currentUser";
import { areFriends } from "@/lib/friends";
import { prisma } from "@/lib/prisma";
import { albumVariantKey } from "@/lib/searchRelevance";

// GET /api/albums?status=queue|library[&userId=] — list saved albums for
// one list. Defaults to the current user; pass userId to view a friend's
// list (only allowed once you're accepted friends).
export const GET = withSignIn(async (request: NextRequest) => {
  const status = request.nextUrl.searchParams.get("status");
  const userIdParam = request.nextUrl.searchParams.get("userId");

  if (status !== "queue" && status !== "library") {
    return NextResponse.json(
      { error: "status must be 'queue' or 'library'" },
      { status: 400 },
    );
  }

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

  const albums = await prisma.album.findMany({
    where: { userId: targetUserId, status },
    orderBy: status === "library" ? { listenedAt: "desc" } : { addedAt: "desc" },
  });

  return NextResponse.json({ albums });
});

// POST /api/albums — save an album (from search) to the wishlist or
// straight to the library, for the current user.
export const POST = withSignIn(async (request: NextRequest) => {
  const body = await request.json();
  const { mbid, title, artist, coverArtUrl, status } = body ?? {};

  if (!mbid || !title || !artist) {
    return NextResponse.json(
      { error: "mbid, title, and artist are required" },
      { status: 400 },
    );
  }

  const targetStatus = status === "library" ? "library" : "queue";
  const userId = await getCurrentUserId();

  // Already saved, by this id or — since the same album carries a different
  // id depending on where it was found ("itunes:…", a MusicBrainz id,
  // "lastfm:…") — by artist + edition-stripped title. Either way it's the
  // existing row that's updated, never a second copy.
  const variant = albumVariantKey(artist, title);
  const existing =
    (await prisma.album.findUnique({ where: { userId_mbid: { userId, mbid } } })) ??
    (
      await prisma.album.findMany({
        where: { userId },
        select: { id: true, artist: true, title: true, status: true },
      })
    ).find((a) => albumVariantKey(a.artist, a.title) === variant) ??
    null;

  // If the album is already saved, adding it to the library promotes it
  // (same as "mark as listened"). Adding an already-libraried album again,
  // or to the wishlist, is a no-op — it doesn't make sense to un-listen it.
  const album = existing
    ? existing.status === "queue" && targetStatus === "library"
      ? await prisma.album.update({
          where: { id: existing.id },
          data: { status: "library", listenedAt: new Date() },
        })
      : await prisma.album.findUniqueOrThrow({ where: { id: existing.id } })
    : await prisma.album.create({
        data: {
          userId,
          mbid,
          title,
          artist,
          coverArtUrl: coverArtUrl ?? null,
          status: targetStatus,
          listenedAt: targetStatus === "library" ? new Date() : null,
        },
      });

  // Activity-worthy: a brand new save, or a queue→library promotion.
  // Re-adding something already in its target list is a no-op above and
  // shouldn't spam the feed.
  const promoted = existing?.status === "queue" && targetStatus === "library";
  if (!existing || promoted) {
    await prisma.activity.create({
      data: {
        userId,
        albumId: album.id,
        type: targetStatus === "library" ? "added_library" : "added_todo",
      },
    });
  }

  return NextResponse.json({ album }, { status: 201 });
});
