import { createTtlCache } from "./apiCache";

const ITUNES_SEARCH_URL = "https://itunes.apple.com/search";
const USER_AGENT = "Spinsheet/0.1.0 ( halbeayush2@gmail.com )";
const REQUEST_TIMEOUT_MS = 5000;
// Artwork/metadata for a given release doesn't change, so a lookup that's
// already been made — the same artist+title turning up in search, New
// releases, and Recommended, say — is served from here instead of hitting
// iTunes again.
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = createTtlCache<ITunesAlbum[]>(CACHE_TTL_MS);

// iTunes' unauthenticated tier allows roughly 20 requests/minute per IP.
// Every call in this module funnels through one shared, paced queue —
// regardless of how many callers fire "concurrently" — so the app as a
// whole stays under that, rather than each call site needing its own
// rate-limit awareness.
//
// It's priority-ordered, not plain FIFO: a live, user-facing search (typing
// in the search box, or the friend-recommendation picker) jumps ahead of
// queued *background* artwork lookups — the batch New releases/Upcoming/
// Recommended run to attach art to a whole page of candidates behind their
// own 45-minute cache. Without that, a user's search could end up waiting
// behind 15-40 already-queued background lookups (at ~3s apart, that's
// over a minute) — a real bug caught by testing this against the running
// app, not just the module in isolation.
const REQUEST_INTERVAL_MS = 3100; // ~19/min, just under the observed limit
const PRIORITY_INTERACTIVE = 0;
const PRIORITY_BACKGROUND = 1;

type QueuedTask = {
  run: () => Promise<void>;
  priority: number;
};

const queue: QueuedTask[] = [];
let draining = false;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  while (queue.length > 0) {
    const task = queue.shift()!;
    await task.run();
    if (queue.length > 0) await wait(REQUEST_INTERVAL_MS);
  }
  draining = false;
}

function throttled<T>(fn: () => Promise<T>, priority: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const task: QueuedTask = {
      run: () => fn().then(resolve, reject),
      priority,
    };
    // Insert after any already-queued task of equal-or-higher priority
    // (lower number = higher priority), preserving arrival order within a
    // priority tier while letting a higher-priority arrival cut the line.
    const index = queue.findIndex((t) => t.priority > priority);
    if (index === -1) queue.push(task);
    else queue.splice(index, 0, task);
    drainQueue();
  });
}

export type ITunesAlbum = {
  collectionId: number;
  title: string;
  artist: string;
  releaseDate: string | null;
  artworkUrl100: string | null;
  // iTunes' own collectionType is unreliable for telling a real album from
  // a single (it comes back "Album" for both) — trackCount is the signal
  // that actually distinguishes them, used to rank real albums above same-
  // titled singles in search (see relevanceOf in /api/search).
  trackCount: number;
};

type RawITunesResult = {
  collectionId?: number;
  collectionName?: string;
  artistName?: string;
  releaseDate?: string;
  artworkUrl100?: string;
  trackCount?: number;
};

function normalize(raw: RawITunesResult): ITunesAlbum | null {
  if (!raw.collectionId || !raw.collectionName || !raw.artistName) return null;
  return {
    collectionId: raw.collectionId,
    title: raw.collectionName,
    artist: raw.artistName,
    releaseDate: raw.releaseDate ?? null,
    artworkUrl100: raw.artworkUrl100 ?? null,
    trackCount: raw.trackCount ?? 0,
  };
}

async function rawSearch(
  term: string,
  limit: number,
  priority: number,
): Promise<ITunesAlbum[]> {
  const cacheKey = `${term.toLowerCase()}::${limit}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const results = await throttled(async () => {
    const url = new URL(ITUNES_SEARCH_URL);
    url.searchParams.set("term", term);
    url.searchParams.set("entity", "album");
    url.searchParams.set("limit", String(limit));

    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`iTunes search failed: ${response.status}`);
    }
    const data: { results?: RawITunesResult[] } = await response.json();
    return (data.results ?? [])
      .map(normalize)
      .filter((album): album is ITunesAlbum => album !== null);
  }, priority);

  cache.set(cacheKey, results);
  return results;
}

// The direct, user-facing album search (search-as-you-type, and the
// friend-recommendation picker) — term is whatever the user typed. Given
// interactive priority: see the note on the queue above.
export async function searchITunesAlbums(
  term: string,
  limit = 25,
): Promise<ITunesAlbum[]> {
  const trimmed = term.trim();
  if (!trimmed) return [];
  try {
    return await rawSearch(trimmed, limit, PRIORITY_INTERACTIVE);
  } catch (err) {
    console.error("iTunes search failed", err);
    return [];
  }
}

// Swapping "100x100bb" for "600x600bb" in an artworkUrl100 is a documented
// convention iTunes' CDN honors for arbitrary requested sizes, not a hack —
// see https://performance-partners.apple.com (artwork sizing) — verified
// directly against the live CDN before relying on it here.
export function upgradeArtworkUrl(artworkUrl100: string): string {
  return artworkUrl100.replace("100x100bb", "600x600bb");
}

// Routes the (upgraded) artwork URL through our own cover-art proxy, same
// as every other artwork source in the app — on-disk caching, and a
// same-request fallback to the original 100x100 size if 600x600
// unexpectedly 404s (see /api/cover-art/route.ts).
export function itunesArtworkProxyUrl(artworkUrl100: string): string {
  const upgraded = upgradeArtworkUrl(artworkUrl100);
  return `/api/cover-art?src=${encodeURIComponent(upgraded)}`;
}

// For New releases/Upcoming/Recommended, where a candidate's artist+title
// is already known (from MusicBrainz/Last.fm discovery) and the only thing
// wanted from iTunes is its artwork, to replace the old MusicBrainz ->
// Cover Art Archive two-hop lookup with iTunes' single-response one. Only
// matches when both artist and title plausibly refer to the same release —
// otherwise returns null so the caller falls back to its own source rather
// than attaching a confidently-wrong cover.
//
// Deliberately does NOT go through searchITunesAlbums — these are
// background, cache-backed batch lookups (a whole candidate list at once),
// not something a person is actively waiting on, so they're queued at
// background priority (see the note on the queue above) rather than
// competing with a live search.
export async function findITunesArtwork(
  artist: string,
  title: string,
): Promise<string | null> {
  const term = `${artist} ${title}`.trim();
  if (!term) return null;

  let results: ITunesAlbum[];
  try {
    results = await rawSearch(term, 5, PRIORITY_BACKGROUND);
  } catch (err) {
    console.error("iTunes artwork lookup failed", err);
    return null;
  }
  if (results.length === 0) return null;

  const normalizedArtist = artist.toLowerCase();
  const normalizedTitle = title.toLowerCase();

  const candidates = results.filter((r) => {
    if (r.artist.toLowerCase() !== normalizedArtist) return false;
    const rTitle = r.title.toLowerCase();
    return (
      rTitle === normalizedTitle ||
      rTitle.includes(normalizedTitle) ||
      normalizedTitle.includes(rTitle)
    );
  });
  if (candidates.length === 0) return null;

  // Prefer the most album-like candidate — e.g. the artist's own
  // same-titled single shouldn't win out over the actual album.
  const match = candidates.reduce((best, r) =>
    r.trackCount > best.trackCount ? r : best,
  );

  return match.artworkUrl100 ? itunesArtworkProxyUrl(match.artworkUrl100) : null;
}
