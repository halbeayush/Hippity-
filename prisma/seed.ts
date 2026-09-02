// Seeds fake friend accounts and sample activity so the Social tab is
// testable before any real friends (or real deployment) exist. Safe to
// re-run — everything is upserted, keyed off the seed data's own ids.
import { prisma } from "../src/lib/prisma";
import { CURRENT_USERNAME } from "../src/lib/currentUser";

type SeedAlbum = {
  mbid: string;
  title: string;
  artist: string;
  status: "library" | "queue";
  rating?: number;
  note?: string;
  daysAgo: number; // when it was added/listened, for a believable addedAt/listenedAt
};

type SeedFriend = {
  username: string;
  displayName: string;
  avatarColor: string;
  accepted: boolean;
  albums: SeedAlbum[];
  topTracks: { rank: number; trackName: string; artist: string }[];
};

const FRIENDS: SeedFriend[] = [
  {
    username: "jordan",
    displayName: "Jordan",
    avatarColor: "#f97316",
    accepted: true,
    albums: [
      {
        mbid: "seed-jordan-igor",
        title: "IGOR",
        artist: "Tyler, the Creator",
        status: "library",
        rating: 5,
        note: "EARFQUAKE on repeat.",
        daysAgo: 0.1,
      },
      {
        mbid: "seed-jordan-currents",
        title: "Currents",
        artist: "Tame Impala",
        status: "library",
        rating: 4,
        daysAgo: 2,
      },
      {
        mbid: "seed-jordan-blonde",
        title: "Blonde",
        artist: "Frank Ocean",
        status: "queue",
        daysAgo: 0.5,
      },
    ],
    topTracks: [
      { rank: 1, trackName: "EARFQUAKE", artist: "Tyler, the Creator" },
      { rank: 2, trackName: "The Less I Know the Better", artist: "Tame Impala" },
      { rank: 3, trackName: "Pink + White", artist: "Frank Ocean" },
      { rank: 4, trackName: "New Person, Same Old Mistakes", artist: "Tame Impala" },
      { rank: 5, trackName: "RUNNING OUT OF TIME", artist: "Tyler, the Creator" },
    ],
  },
  {
    username: "sam",
    displayName: "Sam",
    avatarColor: "#22c55e",
    accepted: true,
    albums: [
      {
        mbid: "seed-sam-ok-computer",
        title: "OK Computer",
        artist: "Radiohead",
        status: "library",
        rating: 5,
        note: "Still the best headphones album ever made.",
        daysAgo: 5,
      },
      {
        mbid: "seed-sam-to-pimp",
        title: "To Pimp a Butterfly",
        artist: "Kendrick Lamar",
        status: "library",
        rating: 4,
        daysAgo: 1,
      },
      {
        mbid: "seed-sam-in-rainbows",
        title: "In Rainbows",
        artist: "Radiohead",
        status: "queue",
        daysAgo: 0.2,
      },
    ],
    topTracks: [
      { rank: 1, trackName: "Alright", artist: "Kendrick Lamar" },
      { rank: 2, trackName: "Paranoid Android", artist: "Radiohead" },
      { rank: 3, trackName: "Weekend Wars", artist: "Kanye West" },
      { rank: 4, trackName: "Reckoner", artist: "Radiohead" },
      { rank: 5, trackName: "King Kunta", artist: "Kendrick Lamar" },
    ],
  },
  {
    // Left as a pending incoming request so the Social tab's accept/decline
    // UI has something to show too, not just already-accepted friends.
    username: "riley",
    displayName: "Riley",
    avatarColor: "#a855f7",
    accepted: false,
    albums: [],
    topTracks: [],
  },
];

function daysAgoDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// Monday of the current week, UTC midnight.
function currentWeekStart(): Date {
  const now = new Date();
  const day = now.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday),
  );
  return monday;
}

async function main() {
  const me = await prisma.user.upsert({
    where: { username: CURRENT_USERNAME },
    update: {},
    create: { username: CURRENT_USERNAME, displayName: "You", avatarColor: "#a78bfa" },
  });

  const weekStart = currentWeekStart();

  for (const friend of FRIENDS) {
    const user = await prisma.user.upsert({
      where: { username: friend.username },
      update: { displayName: friend.displayName, avatarColor: friend.avatarColor },
      create: {
        username: friend.username,
        displayName: friend.displayName,
        avatarColor: friend.avatarColor,
      },
    });

    // Pending requests seed as friend -> me; accepted friends seed as me -> friend.
    const requesterId = friend.accepted ? me.id : user.id;
    const recipientId = friend.accepted ? user.id : me.id;
    await prisma.friendship.upsert({
      where: { requesterId_recipientId: { requesterId, recipientId } },
      update: { status: friend.accepted ? "accepted" : "pending" },
      create: { requesterId, recipientId, status: friend.accepted ? "accepted" : "pending" },
    });

    for (const album of friend.albums) {
      const addedAt = daysAgoDate(album.daysAgo);
      const listenedAt = album.status === "library" ? addedAt : null;

      const savedAlbum = await prisma.album.upsert({
        where: { userId_mbid: { userId: user.id, mbid: album.mbid } },
        update: {
          status: album.status,
          rating: album.rating ?? null,
          note: album.note ?? null,
          addedAt,
          listenedAt,
        },
        create: {
          userId: user.id,
          mbid: album.mbid,
          title: album.title,
          artist: album.artist,
          status: album.status,
          rating: album.rating ?? null,
          note: album.note ?? null,
          addedAt,
          listenedAt,
        },
      });

      const existingActivity = await prisma.activity.findFirst({
        where: {
          userId: user.id,
          albumId: savedAlbum.id,
          type: album.status === "library" ? "added_library" : "added_todo",
        },
      });
      if (!existingActivity) {
        await prisma.activity.create({
          data: {
            userId: user.id,
            albumId: savedAlbum.id,
            type: album.status === "library" ? "added_library" : "added_todo",
            createdAt: addedAt,
          },
        });
        if (album.rating) {
          await prisma.activity.create({
            data: {
              userId: user.id,
              albumId: savedAlbum.id,
              type: "rated",
              rating: album.rating,
              createdAt: daysAgoDate(Math.max(album.daysAgo - 0.05, 0)),
            },
          });
        }
      }
    }

    for (const track of friend.topTracks) {
      await prisma.weeklyTopTrack.upsert({
        where: { userId_weekStart_rank: { userId: user.id, weekStart, rank: track.rank } },
        update: { trackName: track.trackName, artist: track.artist },
        create: {
          userId: user.id,
          weekStart,
          rank: track.rank,
          trackName: track.trackName,
          artist: track.artist,
        },
      });
    }
  }

  await seedRecommendations(me);

  console.log("Seeded fake friends: jordan (accepted), sam (accepted), riley (pending).");
}

async function seedRecommendation(params: {
  senderId: number;
  recipientId: number;
  mbid: string;
  title: string;
  artist: string;
  status: "pending" | "listened" | "rejected";
  hoursAgo: number;
}) {
  const existing = await prisma.recommendationSent.findFirst({
    where: {
      senderId: params.senderId,
      recipientId: params.recipientId,
      mbid: params.mbid,
    },
  });
  if (existing) return;

  const createdAt = daysAgoDate(params.hoursAgo / 24);
  await prisma.recommendationSent.create({
    data: {
      senderId: params.senderId,
      recipientId: params.recipientId,
      mbid: params.mbid,
      title: params.title,
      artist: params.artist,
      status: params.status,
      createdAt,
      resolvedAt: params.status === "pending" ? null : new Date(),
    },
  });
}

// A few sample recommendations so the "Recommended to you" section and the
// friend-profile recommend panel have something to show right away.
async function seedRecommendations(me: { id: number }) {
  const jordan = await prisma.user.findUniqueOrThrow({ where: { username: "jordan" } });
  const sam = await prisma.user.findUniqueOrThrow({ where: { username: "sam" } });

  await seedRecommendation({
    senderId: jordan.id,
    recipientId: me.id,
    mbid: "seed-rec-rumours",
    title: "Rumours",
    artist: "Fleetwood Mac",
    status: "pending",
    hoursAgo: 3,
  });

  await seedRecommendation({
    senderId: me.id,
    recipientId: jordan.id,
    mbid: "seed-rec-channel-orange",
    title: "channel ORANGE",
    artist: "Frank Ocean",
    status: "pending",
    hoursAgo: 6,
  });

  // A previously-resolved recommendation, listened — mirrors the real
  // "mark as listened" side effect (saves into the recipient's library too)
  // so the demo shows the whole loop, not just the pending state.
  const resolvedMbid = "seed-rec-good-kid";
  await seedRecommendation({
    senderId: sam.id,
    recipientId: me.id,
    mbid: resolvedMbid,
    title: "good kid, m.A.A.d city",
    artist: "Kendrick Lamar",
    status: "listened",
    hoursAgo: 30,
  });
  const alreadyInLibrary = await prisma.album.findUnique({
    where: { userId_mbid: { userId: me.id, mbid: resolvedMbid } },
  });
  if (!alreadyInLibrary) {
    const listenedAt = daysAgoDate(29 / 24);
    const album = await prisma.album.create({
      data: {
        userId: me.id,
        mbid: resolvedMbid,
        title: "good kid, m.A.A.d city",
        artist: "Kendrick Lamar",
        status: "library",
        addedAt: listenedAt,
        listenedAt,
      },
    });
    await prisma.activity.create({
      data: {
        userId: me.id,
        albumId: album.id,
        type: "added_library",
        createdAt: listenedAt,
      },
    });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
