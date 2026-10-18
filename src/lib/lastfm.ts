import { createHash } from "crypto";
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
): Promise<{ playcount: number; imageUrl: string | null; trackCount: number }> {
  try {
    const data = await lastfmFetch<{
      album?: {
        playcount?: string | number;
        image?: LastfmImage[];
        // A one-track album comes back as a single object, not an array.
        tracks?: { track?: unknown[] | object };
      };
    }>(
      "album.getinfo",
      // iTunes titles carry store-listing suffixes ("... (Deluxe Version)",
      // "... - Single") that Last.fm doesn't, so a lookup on the raw title
      // misses — or lands on a little-played edition instead of the album.
      { artist, album: baseAlbumTitle(album), autocorrect: "1" },
    );
    const tracks = data.album?.tracks?.track;
    return {
      playcount: Number(data.album?.playcount ?? 0) || 0,
      imageUrl: lastfmCoverUrl(data.album?.image),
      // 0 when Last.fm has no track list — unknown, not "empty".
      trackCount: Array.isArray(tracks) ? tracks.length : tracks ? 1 : 0,
    };
  } catch {
    return { playcount: 0, imageUrl: null, trackCount: 0 };
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

// --- Signing in with Last.fm -------------------------------------------
// Last.fm's web auth: the browser goes to LASTFM_AUTH_URL, the person
// approves, and Last.fm sends them back to our callback with a one-time
// token. Trading that token for a session (getLastfmSessionName) proves
// which Last.fm account it is, so nobody can claim someone else's
// scrobbles by typing their username. Needs LASTFM_SHARED_SECRET besides
// the API key. Only the username is kept: everything this app reads
// afterwards (user.getTopTracks) is public.
const LASTFM_AUTH_URL = "https://www.last.fm/api/auth/";

// Holds a random value between the redirect to Last.fm and the callback,
// which checks it — so a link someone else crafted can't attach their
// Last.fm account to yours. Same idea as the Google sign-in's state.
export const LASTFM_STATE_COOKIE = "spinsheet_lastfm_auth";

export function lastfmAuthConfig() {
  const apiKey = process.env.LASTFM_API_KEY;
  const secret = process.env.LASTFM_SHARED_SECRET;
  return apiKey && secret ? { apiKey, secret } : null;
}

export function lastfmAuthUrl(apiKey: string, callbackUrl: string): URL {
  const url = new URL(LASTFM_AUTH_URL);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("cb", callbackUrl);
  return url;
}

// Last.fm's request signature: every parameter (except format) sorted by
// name, concatenated as name+value, then the shared secret, MD5-hashed.
function lastfmSignature(params: Record<string, string>, secret: string): string {
  const joined = Object.keys(params)
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join("");
  return createHash("md5").update(joined + secret, "utf8").digest("hex");
}

// The Last.fm username behind a callback token. Throws on any failure.
export async function getLastfmSessionName(
  token: string,
  config: { apiKey: string; secret: string },
): Promise<string> {
  const params = { api_key: config.apiKey, method: "auth.getSession", token };
  const url = new URL(LASTFM_BASE);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("api_sig", lastfmSignature(params, config.secret));
  url.searchParams.set("format", "json");

  const response = await fetch(url, { signal: AbortSignal.timeout(LASTFM_TIMEOUT_MS) });
  const data: { session?: { name?: string } } & LastfmErrorResponse =
    await response.json();
  if (!response.ok || data.error || !data.session?.name) {
    throw new Error(`Last.fm sign-in failed: ${data.message ?? response.status}`);
  }
  return data.session.name;
}

// --- Weekly top 5 --------------------------------------------------------
export type LastfmTopTrack = {
  rank: number;
  trackName: string;
  artist: string;
  playcount: number;
  coverArtUrl: string | null;
};

type LastfmTopTracksResponse = {
  toptracks?: {
    track?: {
      name: string;
      playcount?: string;
      artist?: { name?: string };
      "@attr"?: { rank?: string };
    }[];
  };
};

type LastfmTrackInfoResponse = {
  track?: { album?: { image?: LastfmImage[] } };
};

const TOP_TRACKS_LIMIT = 5;

// Track listings carry only Last.fm's placeholder image, so each cover
// comes from the track's album (track.getInfo). A missing cover is fine.
async function trackCoverUrl(artist: string, track: string): Promise<string | null> {
  try {
    const data = await lastfmFetch<LastfmTrackInfoResponse>("track.getInfo", {
      artist,
      track,
      autocorrect: "1",
    });
    const image = lastfmCoverUrl(data.track?.album?.image);
    return image ? `/api/cover-art?src=${encodeURIComponent(image)}` : null;
  } catch {
    return null;
  }
}

// A Last.fm user's five most-played tracks over the last 7 days. Throws if
// Last.fm can't be reached (the caller falls back to its saved copy).
export async function getLastfmWeeklyTopTracks(
  username: string,
): Promise<LastfmTopTrack[]> {
  const data = await lastfmFetch<LastfmTopTracksResponse>("user.getTopTracks", {
    user: username,
    period: "7day",
    limit: String(TOP_TRACKS_LIMIT),
  });
  const tracks = (data.toptracks?.track ?? []).slice(0, TOP_TRACKS_LIMIT);
  return Promise.all(
    tracks.map(async (t, i) => {
      const artist = t.artist?.name ?? "Unknown artist";
      return {
        rank: Number(t["@attr"]?.rank) || i + 1,
        trackName: t.name,
        artist,
        playcount: Number(t.playcount) || 0,
        coverArtUrl: await trackCoverUrl(artist, t.name),
      };
    }),
  );
}
