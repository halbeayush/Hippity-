import { createTtlCache } from "./apiCache";

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

  const response = await fetch(url);
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
