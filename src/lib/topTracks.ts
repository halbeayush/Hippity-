import { getLastfmWeeklyTopTracks } from "./lastfm";
import { readPersisted, writePersisted } from "./persistentCache";
import { prisma } from "./prisma";
import type { TopTracksResponse, WeeklyTopTrack } from "./types";

// A Last.fm "last 7 days" chart barely moves within an hour, and every
// friend opening a profile would otherwise cost Last.fm six requests (the
// chart plus a cover lookup per track).
const LASTFM_CHART_TTL_MS = 60 * 60 * 1000;

// The last good chart is kept in Postgres (CacheEntry), so it's shared by
// every server instance and survives a Last.fm outage: a failed refresh
// serves the saved one, however old, rather than an empty chart.
async function cachedLastfmChart(username: string): Promise<WeeklyTopTrack[]> {
  const key = `lastfm-top-tracks:${username.toLowerCase()}`;
  const saved = await readPersisted<WeeklyTopTrack[]>(key);
  if (saved && Date.now() - saved.at < LASTFM_CHART_TTL_MS) return saved.value;

  try {
    const tracks = await getLastfmWeeklyTopTracks(username);
    await writePersisted(key, tracks);
    return tracks;
  } catch (err) {
    console.error(`Last.fm top tracks failed for ${username}`, err);
    return saved?.value ?? [];
  }
}

// A user's weekly top 5: from their Last.fm account when they've connected
// one, otherwise the seeded sample chart (only the fake demo friends have
// one), otherwise nothing.
export async function getTopTracks(
  userId: number,
  isSelf: boolean,
): Promise<TopTracksResponse> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastfmUsername: true },
  });
  const lastfmUsername = user?.lastfmUsername ?? null;

  if (lastfmUsername) {
    return {
      source: "lastfm",
      isSelf,
      lastfmUsername,
      weekStart: null,
      tracks: await cachedLastfmChart(lastfmUsername),
    };
  }

  const latest = await prisma.weeklyTopTrack.findFirst({
    where: { userId },
    orderBy: { weekStart: "desc" },
    select: { weekStart: true },
  });
  if (!latest) {
    return { source: null, isSelf, lastfmUsername: null, weekStart: null, tracks: [] };
  }

  const rows = await prisma.weeklyTopTrack.findMany({
    where: { userId, weekStart: latest.weekStart },
    orderBy: { rank: "asc" },
  });
  return {
    source: "sample",
    isSelf,
    lastfmUsername: null,
    weekStart: latest.weekStart.toISOString(),
    tracks: rows.map((r) => ({
      rank: r.rank,
      trackName: r.trackName,
      artist: r.artist,
      coverArtUrl: r.coverArtUrl,
    })),
  };
}
