import { createTtlCache } from "./apiCache";
import { mapWithConcurrency } from "./concurrency";
import { baseAlbumTitle } from "./searchRelevance";

// Server-only Last.fm API client. All the methods this app uses (artist
// info/search/similar/top albums, tag charts, global charts) are public GET
// endpoints that only need an API key — no OAuth/session needed.
const LASTFM_BASE = "https://ws.audioscrobbler.com/2.0/";

type LastfmErrorResponse = { error?: number; message?: string };

// Recommendation modes often share underlying artists/tags (switching
// between genres, or an artist turning up as "similar" more than once), so
// identical Last.fm lookups within this window are served from memory
// instead of re-hitting the API.
const LASTFM_CACHE_TTL_MS = 10 * 60 * 1000;
const lastfmCache = createTtlCache<unknown>(LASTFM_CACHE_TTL_MS);
// Bounds a stuck request — search results wait on a batch of these.
const LASTFM_TIMEOUT_MS = 4000;

export async function lastfmFetch<T>(
  method: string,
  params: Record<string, string>,
): Promise<T> {
  const cacheKey = `${method}:${Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&")}`;
  const cached = lastfmCache.get(cacheKey);
  if (cached !== undefined) return cached as T;

  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) {
    throw new Error("LASTFM_API_KEY is not configured");
  }

  const url = new URL(LASTFM_BASE);
  url.searchParams.set("method", method);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    signal: AbortSignal.timeout(LASTFM_TIMEOUT_MS),
  });
  const data: T & LastfmErrorResponse = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data.message ?? `Last.fm request failed: ${method}`);
  }

  lastfmCache.set(cacheKey, data);
  return data;
}

// Fetches an artist's Last.fm listener count — the stand-in for the
// Spotify "popularity" score that's no longer available via that API (see
// api/home/new-releases/route.ts). Returns 0 (ranked last, not excluded) on
// any failure — an unrecognized/misspelled artist name shouldn't drop an
// otherwise-valid album from the results.
export async function getArtistListeners(name: string): Promise<number> {
  try {
    const data = await lastfmFetch<{
      artist?: { stats?: { listeners?: string } };
    }>("artist.getinfo", { artist: name });
    return Number(data.artist?.stats?.listeners ?? 0);
  } catch {
    return 0;
  }
}

// The id for an album known only from Last.fm, in the same opaque "mbid"
// field the rest of the app keys albums by (like search's `itunes:` ids).
// /api/tracklist resolves a real MusicBrainz id from artist+title on demand
// for any id that isn't one. The parts are URI-encoded so the id never
// contains a comma — Recommended's `exclude` list is comma-separated.
export function lastfmAlbumId(artist: string, title: string): string {
  return `lastfm:${encodeURIComponent(artist)}::${encodeURIComponent(title)}`;
}

// Last.fm's generic grey star, served in place of a real cover when it
// has none — treated as no image.
const LASTFM_PLACEHOLDER_IMAGE = "2a96cbd8b46e442fc41c2b86b821562f";

type LastfmImage = { "#text": string; size: string };

// Last.fm's 300x300 cover from an image list, or null when it has none.
export function lastfmCoverUrl(images: LastfmImage[] | undefined): string | null {
  const url = images?.find((i) => i.size === "extralarge")?.["#text"];
  return url && !url.includes(LASTFM_PLACEHOLDER_IMAGE) ? url : null;
}

// One album.getinfo lookup, shared by everything that needs it: search
// ranking reads the play count, cover art reads the image — and since
// lastfmFetch caches by params, a cover requested for a search result
// that was just ranked costs no second request. Fields are 0/null on any
// failure or no match.
export async function getAlbumInfo(
  artist: string,
  album: string,
): Promise<{ playcount: number; imageUrl: string | null }> {
  try {
    const data = await lastfmFetch<{
      album?: { playcount?: string | number; image?: LastfmImage[] };
    }>(
      "album.getinfo",
      // iTunes titles carry store-listing suffixes ("... (Deluxe Version)",
      // "... - Single") that Last.fm doesn't, so a lookup on the raw title
      // misses — or lands on a little-played edition instead of the album.
      { artist, album: baseAlbumTitle(album), autocorrect: "1" },
    );
    return {
      playcount: Number(data.album?.playcount ?? 0) || 0,
      imageUrl: lastfmCoverUrl(data.album?.image),
    };
  } catch {
    return { playcount: 0, imageUrl: null };
  }
}

// An album's all-time Last.fm play count (scrobbles) — the closest
// available stand-in for "streams": Spotify's API doesn't expose stream
// counts, and its popularity score is gone for this app too (see
// api/home/new-releases/route.ts). Used to order search results
// most-played first. 0 when unknown, so the album is ranked last rather
// than dropped.
export async function getAlbumPlaycount(
  artist: string,
  album: string,
): Promise<number> {
  return (await getAlbumInfo(artist, album)).playcount;
}

// Top album matches for a search query, in Last.fm's own order — by
// popularity, which plain text search (iTunes, MusicBrainz) doesn't do:
// iTunes doesn't return Tame Impala's "Currents" for "currents" at all, and
// of the dozens of albums titled exactly that, MusicBrainz ranked it 57th.
// Used to make sure the popular matches are in the result pool at all,
// before play counts sort it. `imageUrl` is Last.fm's 300x300 cover, or
// null when it has none.
export async function searchPopularAlbums(
  query: string,
  limit: number,
): Promise<{ title: string; artist: string; imageUrl: string | null }[]> {
  try {
    const data = await lastfmFetch<{
      results?: {
        albummatches?: {
          album?: {
            name: string;
            artist: string;
            image?: { "#text": string; size: string }[];
          }[];
        };
      };
    }>("album.search", { album: query, limit: String(limit) });
    return (data.results?.albummatches?.album ?? []).map((a) => ({
      title: a.name,
      artist: a.artist,
      imageUrl: lastfmCoverUrl(a.image),
    }));
  } catch {
    return [];
  }
}

// Search results wait on this whole batch (~30 lookups at ~150-300ms each),
// so it runs wide.
const PLAYCOUNT_LOOKUP_CONCURRENCY = 12;

// Attaches each result's play count (see getAlbumPlaycount), several
// lookups in flight at once — Last.fm has no strict per-second limit the
// way MusicBrainz/iTunes do.
export function attachPlaycounts<T extends { artist: string; title: string }>(
  results: T[],
): Promise<(T & { playcount: number })[]> {
  return mapWithConcurrency(results, PLAYCOUNT_LOOKUP_CONCURRENCY, async (r) => ({
    ...r,
    playcount: await getAlbumPlaycount(r.artist, r.title),
  }));
}
