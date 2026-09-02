import { getFriendIds } from "@/lib/friends";
import { prisma } from "@/lib/prisma";
import type { ActivityType, FeedItem, RecommendationStatus } from "@/lib/types";

const USER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarColor: true,
} as const;

// Friend activity (ratings/additions) and recommendations friends have sent,
// merged into one chronological feed. Shared by the Social tab and the Home
// tab's community feed.
export async function getFriendFeed(
  viewerId: number,
  limit = 30,
): Promise<FeedItem[]> {
  const friendIds = await getFriendIds(viewerId);
  if (friendIds.length === 0) return [];

  const [activities, recommendations] = await Promise.all([
    prisma.activity.findMany({
      where: { userId: { in: friendIds } },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        user: { select: USER_SELECT },
        album: { select: { title: true, artist: true, coverArtUrl: true } },
      },
    }),
    prisma.recommendationSent.findMany({
      // A recommendation is feed-worthy to anyone friends with the sender —
      // same visibility rule as any other activity of theirs.
      where: { senderId: { in: friendIds } },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        sender: { select: USER_SELECT },
        recipient: { select: USER_SELECT },
      },
    }),
  ]);

  const items: FeedItem[] = [
    ...activities.map(
      (a): FeedItem => ({
        kind: "activity",
        id: a.id,
        activityType: a.type as ActivityType,
        rating: a.rating,
        createdAt: a.createdAt.toISOString(),
        user: a.user,
        album: a.album,
      }),
    ),
    ...recommendations.map(
      (r): FeedItem => ({
        kind: "recommendation",
        id: r.id,
        status: r.status as RecommendationStatus,
        createdAt: r.createdAt.toISOString(),
        sender: r.sender,
        recipient: r.recipient,
        isRecipientViewer: r.recipientId === viewerId,
        album: { title: r.title, artist: r.artist, coverArtUrl: r.coverArtUrl },
      }),
    ),
  ];

  items.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  return items.slice(0, limit);
}
