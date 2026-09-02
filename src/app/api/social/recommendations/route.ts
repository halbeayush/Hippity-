import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/currentUser";
import { areFriends } from "@/lib/friends";
import { prisma } from "@/lib/prisma";

const USER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarColor: true,
} as const;

// A sender may have at most this many *pending* (unresolved) recommendations
// to a given recipient at once. Resolving one (listened/rejected) frees a
// slot immediately — there's no separate counter to maintain.
export const MAX_PENDING_PER_FRIEND = 3;

function toEntry(row: {
  id: number;
  mbid: string;
  title: string;
  artist: string;
  coverArtUrl: string | null;
  status: string;
  createdAt: Date;
  sender: { id: number; username: string; displayName: string; avatarColor: string };
  recipient: { id: number; username: string; displayName: string; avatarColor: string };
}) {
  return {
    id: row.id,
    mbid: row.mbid,
    status: row.status,
    createdAt: row.createdAt,
    sender: row.sender,
    recipient: row.recipient,
    album: { title: row.title, artist: row.artist, coverArtUrl: row.coverArtUrl },
  };
}

// GET /api/social/recommendations
//   ?box=incoming     — pending recommendations sent to the current user
//   ?to=<username>    — remaining slots + pending recommendations the
//                        current user has sent to that friend
export async function GET(request: NextRequest) {
  const userId = await getCurrentUserId();
  const box = request.nextUrl.searchParams.get("box");
  const to = request.nextUrl.searchParams.get("to");

  if (to) {
    const recipient = await prisma.user.findUnique({ where: { username: to } });
    if (!recipient) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const pending = await prisma.recommendationSent.findMany({
      where: { senderId: userId, recipientId: recipient.id, status: "pending" },
      orderBy: { createdAt: "desc" },
      include: {
        sender: { select: USER_SELECT },
        recipient: { select: USER_SELECT },
      },
    });
    return NextResponse.json({
      max: MAX_PENDING_PER_FRIEND,
      remaining: MAX_PENDING_PER_FRIEND - pending.length,
      pending: pending.map(toEntry),
    });
  }

  if (box === "incoming" || !box) {
    const recommendations = await prisma.recommendationSent.findMany({
      where: { recipientId: userId, status: "pending" },
      orderBy: { createdAt: "desc" },
      include: {
        sender: { select: USER_SELECT },
        recipient: { select: USER_SELECT },
      },
    });
    return NextResponse.json({
      recommendations: recommendations.map(toEntry),
    });
  }

  return NextResponse.json({ error: "Unsupported query" }, { status: 400 });
}

// POST /api/social/recommendations — recommend an album to a friend.
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { recipientUsername, mbid, title, artist, coverArtUrl } = body ?? {};

  if (!recipientUsername || !mbid || !title || !artist) {
    return NextResponse.json(
      { error: "recipientUsername, mbid, title, and artist are required" },
      { status: 400 },
    );
  }

  const senderId = await getCurrentUserId();
  const recipient = await prisma.user.findUnique({
    where: { username: recipientUsername },
  });
  if (!recipient) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (recipient.id === senderId) {
    return NextResponse.json({ error: "That's you" }, { status: 400 });
  }
  if (!(await areFriends(senderId, recipient.id))) {
    return NextResponse.json(
      { error: "Not friends with this user" },
      { status: 403 },
    );
  }

  const recipientAlreadyHasIt = await prisma.album.findUnique({
    where: { userId_mbid: { userId: recipient.id, mbid } },
  });
  if (recipientAlreadyHasIt) {
    return NextResponse.json(
      { error: "They already have this album" },
      { status: 409 },
    );
  }

  const existingPending = await prisma.recommendationSent.findFirst({
    where: { senderId, recipientId: recipient.id, mbid, status: "pending" },
  });
  if (existingPending) {
    return NextResponse.json(
      { error: "Already recommended and pending" },
      { status: 409 },
    );
  }

  const pendingCount = await prisma.recommendationSent.count({
    where: { senderId, recipientId: recipient.id, status: "pending" },
  });
  if (pendingCount >= MAX_PENDING_PER_FRIEND) {
    return NextResponse.json(
      { error: "No open recommendation slots for this friend" },
      { status: 409 },
    );
  }

  const recommendation = await prisma.recommendationSent.create({
    data: {
      senderId,
      recipientId: recipient.id,
      mbid,
      title,
      artist,
      coverArtUrl: coverArtUrl ?? null,
    },
  });

  return NextResponse.json({ recommendation }, { status: 201 });
}
