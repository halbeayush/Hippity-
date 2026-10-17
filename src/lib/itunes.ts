import { createTtlCache } from "./apiCache";
import {
  createPacedQueue,
  PRIORITY_BACKGROUND,
  PRIORITY_INTERACTIVE,
} from "./pacedQueue";
import { albumVariantKey, baseAlbumTitle, creditKey } from "./searchRelevance";

const ITUNES_SEARCH_URL = "https://itunes.apple.com/search";
const USER_AGENT = "Spinsheet/0.1.0 ( halbeayush2@gmail.com )";
const REQUEST_TIMEOUT_MS = 5000;
// Artwork/metadata for a given release doesn't change, so a lookup that's
// already been made — the same artist+title turning up in search, New
// releases, and Recommended, say — is served from here instead of hitting
// iTunes again.
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = createTtlCache<ITunesAlbum[]>(CACHE_TTL_MS);

// iTunes' unauthenticated tier allows roughly 20 requests/minute per IP, so
// every call in this module goes through one shared paced queue (see
// pacedQueue.ts). A live search (the search box, the friend-recommendation
// picker) is interactive priority; cover lookups are background.
const REQUEST_INTERVAL_MS = 3100; // ~19/min, just under the observed limit
// The limit is a per-minute budget, so a few back to back is fine — a
// search plus its artist-catalog lookup (see getArtistCatalog) shouldn't
// sit 3s apart.
const REQUEST_BURST = 3;
const throttled = createPacedQueue(REQUEST_INTERVAL_MS, REQUEST_BURST);

export type ITunesAlbum = {
  collectionId: number;
  title: string;
  artist: string;
  artistId: number | null;
  releaseDate: string | null;
  artworkUrl100: string | null;
  // iTunes' own collectionType is unreliable for telling a real album from
  // a single (it comes back "Album" for both) — trackCount is the signal
  // that actually distinguishes them, used to rank real albums above same-
  // titled singles in search (see relevanceOf in /api/search).
  trackCount: number;
};

type RawITunesResult = {
  wrapperType?: string;
  collectionId?: number;
  collectionName?: string;
  artistName?: string;
  artistId?: number;
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
    artistId: raw.artistId ?? null,
    releaseDate: raw.releaseDate ?? null,
    artworkUrl100: raw.artworkUrl100 ?? null,
    trackCount: raw.trackCount ?? 0,
  };
}

// One cached, paced request returning albums — shared by search and the
// artist-catalog lookup.
async function cachedAlbumRequest(
  url: URL,
  priority: number,
): Promise<ITunesAlbum[]> {
  const cacheKey = url.toString().toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  // The same cover can be requested twice before the first lookup finishes
  // (StrictMode's double effect in dev, or one album in two rows) — share
  // the queued lookup instead of spending a second queue slot on it.
  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const promise = throttled(async () => {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`iTunes request failed: ${response.status}`);
    }
    const data: { results?: RawITunesResult[] } = await response.json();
    return (data.results ?? [])
      // A lookup's first entry is the artist itself, not an album.
      .filter((raw) => raw.wrapperType === undefined || raw.wrapperType === "collection")
      .map(normalize)
      .filter((album): album is ITunesAlbum => album !== null);
  }, priority).finally(() => inFlight.delete(cacheKey));
  inFlight.set(cacheKey, promise);
  const results = await promise;
  cache.set(cacheKey, results);
  return results;
}

const inFlight = new Map<string, Promise<ITunesAlbum[]>>();

function rawSearch(
  term: string,
  limit: number,
  priority: number,
): Promise<ITunesAlbum[]> {
  const url = new URL(ITUNES_SEARCH_URL);
  url.searchParams.set("term", term);
  url.searchParams.set("entity", "album");
  url.searchParams.set("limit", String(limit));
  return cachedAlbumRequest(url, priority);
}

const ITUNES_LOOKUP_URL = "https://itunes.apple.com/lookup";
const CATALOG_LIMIT = 200;

// An artist's own releases as listed on their Apple Music artist page —
// their official streaming catalog. Plain search can't give this: for
// "eminem" only 31 of iTunes' top 200 album hits are Eminem's own (the rest
// are karaoke, tributes and lookalikes like "Mini Eminem"), and The Slim
// Shady LP isn't among them at all. Releases where the artist is only a
// featured guest are filtered out — those are credited to someone else's
// artist id — unless `includeFeatures` is set, for callers that want those
// too (Recommended's artist mode lists them as their own tier). Empty on
// any failure.
export async function getArtistCatalog(
  artistId: number,
  { includeFeatures = false }: { includeFeatures?: boolean } = {},
): Promise<ITunesAlbum[]> {
  const url = new URL(ITUNES_LOOKUP_URL);
  url.searchParams.set("id", String(artistId));
  url.searchParams.set("entity", "album");
  url.searchParams.set("limit", String(CATALOG_LIMIT));
  try {
    const albums = await cachedAlbumRequest(url, PRIORITY_INTERACTIVE);
    return includeFeatures
      ? albums
      : albums.filter((album) => album.artistId === artistId);
  } catch (err) {
    console.error("iTunes artist catalog lookup failed", err);
    return [];
  }
}

// One entry per album from a catalog listing, which lists every edition
// separately (clean/explicit, deluxe, expanded) — the standard edition
// where there is one, otherwise the first listed.
export function oneEditionPerAlbum(albums: ITunesAlbum[]): ITunesAlbum[] {
  const isStandard = (a: ITunesAlbum) => baseAlbumTitle(a.title) === a.title;
  const picked = new Map<string, ITunesAlbum>();
  for (const album of albums) {
    const key = albumVariantKey(album.artist, album.title);
    const current = picked.get(key);
    if (!current || (isStandard(album) && !isStandard(current))) {
      picked.set(key, album);
    }
  }
  return [...picked.values()];
}

// Singles and short EPs, as opposed to albums — by iTunes' own " - Single"
// / " - EP" title suffix, or a track count too short for an album.
const MIN_ALBUM_TRACKS = 4;
export function isSingleOrEp(album: ITunesAlbum): boolean {
  return / - (Single|EP)$/i.test(album.title) || album.trackCount < MIN_ALBUM_TRACKS;
}

// The iTunes artist id for an artist name, from an album search for it —
// the artist whose credit matches the name exactly (ignoring case and
// punctuation), so "Eminem" isn't resolved to "Mini Eminem". Null when
// iTunes has no such artist.
export async function findITunesArtistId(name: string): Promise<number | null> {
  const albums = await searchITunesAlbums(name, 50);
  return (
    albums.find((a) => creditKey(a.artist) === creditKey(name))?.artistId ?? null
  );
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

// For rows that list a whole batch of candidates (New releases, Upcoming,
// Recommended): rather than the row's API response waiting on an iTunes
// lookup for every candidate — at ~3s apart through the shared queue above,
// 15-30 candidates meant the row took minutes to appear at all — each cover
// is resolved on its own, only when the browser actually requests that
// image (see the artist/title mode of /api/cover-art). The row renders
// immediately and covers fill in as they resolve; candidates on later
// carousel pages never cost a lookup until they're shown. `fallbackSrc` is
// the raw (unproxied) image URL to use when iTunes has no match.
export function lazyArtworkUrl(
  artist: string,
  title: string,
  fallbackSrc: string,
): string {
  const params = new URLSearchParams({ artist, title, fallback: fallbackSrc });
  return `/api/cover-art?${params}`;
}

// Where a candidate's artist+title is already known (from MusicBrainz/
// Last.fm discovery) and the only thing wanted from iTunes is its artwork:
// returns the upgraded (600x600) iTunes CDN URL itself, unproxied, for
// /api/cover-art's lazy mode to fetch. Only matches when both artist and
// title plausibly refer to the same release — otherwise returns null so the
// caller falls back to its own source rather than attaching a
// confidently-wrong cover.
//
// Deliberately does NOT go through searchITunesAlbums — a cover filling in
// isn't something a person is actively waiting on the way a typed search
// is, so it's queued at background priority (see the note on the queue
// above) rather than competing with a live search.
export async function findITunesArtworkSource(
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

  return match.artworkUrl100 ? upgradeArtworkUrl(match.artworkUrl100) : null;
}
