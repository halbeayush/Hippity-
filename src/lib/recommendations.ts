import { mapWithConcurrency } from "./concurrency";
import { findITunesArtwork } from "./itunes";
import { lastfmFetch } from "./lastfm";
import { resolveReleaseGroup } from "./musicbrainz";
import { prisma } from "./prisma";
import type { AlbumSummary } from "./types";

// Candidates are cross-referenced against MusicBrainz with several in
// flight at once (continuous refill, not one at a time) rather than one at
// a time, so this pool can be bigger than what's actually shown at once —
// the extra candidates are handed to the client as a ready-to-use
// replacement queue for dismiss/auto-replace, avoiding a follow-up API call
// for either. A true unbounded burst (all candidates fired simultaneously)
// was tried and measured worse in practice — a handful of requests would
// queue behind Node's per-origin connection pool and each take 10+ seconds
// once finally sent, so this caps how many are in flight together instead.
const ALBUMS_PER_ARTIST = 3;
const DEFAULT_POOL_SIZE = 18;
const MUSICBRAINZ_RESOLVE_CONCURRENCY = 10;
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function getSavedMbids(userId: number): Promise<Set<string>> {
  const albums = await prisma.album.findMany({
    where: { userId },
    select: { mbid: true },
  });
  return new Set(albums.map((a) => a.mbid));
}

// Cross-referencing every candidate against MusicBrainz one at a time (its
// rate limit) makes a cold lookup take tens of seconds, so results for a
// given mode+params are cached briefly rather than recomputed on every
// visit/switch back to the same selection. A "refresh" request (exclude
// list non-empty) always bypasses this — it exists specifically to surface
// something different, so serving the same cached batch back would defeat it.
const resultCache = new Map<string, { at: number; albums: AlbumSummary[] }>();

export async function getCachedRecommendations(
  cacheKey: string,
  compute: () => Promise<AlbumSummary[]>,
  { bypassCache = false }: { bypassCache?: boolean } = {},
): Promise<AlbumSummary[]> {
  if (!bypassCache) {
    const cached = resultCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.albums;
  }

  const albums = await compute();
  resultCache.set(cacheKey, { at: Date.now(), albums });
  return albums;
}

// Picks up to poolSize entries from a ranked candidate list, preferring
// ones not in excludeMbids (recently shown, this session) — but backfilling
// from the excluded ones, strongest matches first, rather than coming up
// short. This is what lets "Refresh" generally surface something new
// without permanently blacklisting an album that's still a great match.
export function preferFresh<T>(
  ranked: T[],
  getMbid: (item: T) => string,
  poolSize: number,
  excludeMbids: Set<string>,
): T[] {
  if (excludeMbids.size === 0) return ranked.slice(0, poolSize);

  const fresh: T[] = [];
  const seen: T[] = [];
  for (const item of ranked) {
    (excludeMbids.has(getMbid(item)) ? seen : fresh).push(item);
  }
  return [...fresh, ...seen].slice(0, poolSize);
}

type LastfmAlbum = { name: string };
type Candidate = { artistName: string; albumName: string };

// Given a list of artist names, pulls each artist's top albums from
// Last.fm and cross-references them against MusicBrainz to get a real
// release-group id — Last.fm's own art coverage is inconsistent and its
// `mbid` fields are often stale, so results are never trusted directly (see
// resolveReleaseGroup). Artwork itself comes from iTunes first (a single
// response with working art, vs. MusicBrainz's own Cover Art Archive cross-
// reference), falling back to Cover Art Archive when iTunes has no match.
export async function collectAlbumsForArtists(
  artistNames: string[],
  savedMbids: Set<string>,
  poolSize = DEFAULT_POOL_SIZE,
  excludeMbids: Set<string> = new Set(),
): Promise<AlbumSummary[]> {
  // Each artist's top-albums lookup is independent, so run them together
  // instead of one artist at a time.
  const perArtistAlbums = await Promise.all(
    artistNames.map(async (artistName): Promise<Candidate[]> => {
      try {
        const data = await lastfmFetch<{
          topalbums?: { album?: LastfmAlbum[] };
        }>("artist.gettopalbums", {
          artist: artistName,
          limit: String(ALBUMS_PER_ARTIST),
        });
        return (data.topalbums?.album ?? []).map((album) => ({
          artistName,
          albumName: album.name,
        }));
      } catch {
        return [];
      }
    }),
  );
  const candidates = perArtistAlbums.flat();

  // Cross-reference candidates against MusicBrainz with several in flight
  // at once (rather than one at a time behind a fixed delay) — the biggest
  // single contributor to a slow cold load. MusicBrainz answers a burst
  // like this with a mix of real responses and 503s; fetchMusicBrainz's
  // own retry and timeout (musicbrainz.ts) absorb those without this
  // needing to know.
  const resolved = await mapWithConcurrency(
    candidates,
    MUSICBRAINZ_RESOLVE_CONCURRENCY,
    async (candidate) => {
      const match = await resolveReleaseGroup(
        candidate.artistName,
        candidate.albumName,
      );
      if (!match) return null;
      const itunesArtUrl = await findITunesArtwork(
        candidate.artistName,
        candidate.albumName,
      );
      return { ...candidate, ...match, coverArtUrl: itunesArtUrl ?? match.coverArtUrl };
    },
  );

  const ranked: AlbumSummary[] = [];
  const seenMbids = new Set<string>();
  for (const match of resolved) {
    if (!match) continue;
    if (savedMbids.has(match.mbid) || seenMbids.has(match.mbid)) continue;

    seenMbids.add(match.mbid);
    ranked.push({
      mbid: match.mbid,
      title: match.albumName,
      artist: match.artistName,
      coverArtUrl: match.coverArtUrl,
    });
  }

  return preferFresh(ranked, (a) => a.mbid, poolSize, excludeMbids);
}
