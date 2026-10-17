import { createTtlCache } from "./apiCache";
import {
  createPacedQueue,
  PRIORITY_BACKGROUND,
  PRIORITY_INTERACTIVE,
} from "./pacedQueue";

// MusicBrainz requires every client to identify itself with a descriptive
// User-Agent that includes contact info, or it will start rejecting requests.
export const MUSICBRAINZ_USER_AGENT =
  "Spinsheet/0.1.0 ( halbeayush2@gmail.com )";

// Recommendation candidates frequently repeat the same artist/title lookup
// across modes and page revisits — caching the resolved release-group (or
// the search hit list) avoids re-querying MusicBrainz for the same query
// within this window.
const MUSICBRAINZ_CACHE_TTL_MS = 10 * 60 * 1000;

// How long a single request attempt may take once it's actually sent.
// Most resolve in well under a second, but a rare one gets stuck far
// longer; this caps it.
const MUSICBRAINZ_TIMEOUT_MS = 2000;

// MusicBrainz allows ~1 request/second per IP and rejects anything faster
// ("Your requests are exceeding the allowable rate limit"). This used to be
// left to each caller, and several fired 6-10 requests at once — which is
// what made the home rows and Recommended come back empty or fail outright.
// Now every request in the app goes through this one paced queue (see
// pacedQueue.ts), with a person's own lookups (search, tracklist, artist
// recommendations) ahead of background work (the home rows' scrape).
const MUSICBRAINZ_REQUEST_INTERVAL_MS = 1100;
const paced = createPacedQueue(MUSICBRAINZ_REQUEST_INTERVAL_MS);
const MUSICBRAINZ_MAX_ATTEMPTS = 3;

// MusicBrainz still answers 503 now and then when it's busy overall, and
// recovers within a request or two — each retry goes back through the
// queue, which spaces it out like any other request.
export async function fetchMusicBrainz(
  musicBrainzUrl: URL,
  {
    priority = PRIORITY_INTERACTIVE,
    timeoutMs = MUSICBRAINZ_TIMEOUT_MS,
  }: { priority?: number; timeoutMs?: number } = {},
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const response = await paced(
      () =>
        fetch(musicBrainzUrl, {
          headers: {
            "User-Agent": MUSICBRAINZ_USER_AGENT,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(timeoutMs),
        }),
      priority,
    );
    if (response.status !== 503 || attempt === MUSICBRAINZ_MAX_ATTEMPTS) {
      return response;
    }
  }
}

const RELEASE_GROUP_SEARCH_PAGE_SIZE = 100;

export type ReleaseGroupSearchHit = {
  id: string;
  title: string;
  "first-release-date"?: string;
  "artist-credit"?: { name: string; joinphrase?: string }[];
  releases?: { id: string; status?: string }[];
};

// MusicBrainz's release-group search ranks by text relevance, not date — on
// a broad `firstreleasedate:[X TO Y]` range query, nearly every hit ties at
// the same top relevance score, so a single page of results can be almost
// entirely *imprecise* dates (MusicBrainz entries stamped only "2026", with
// no month/day) while the day-precise ones actually usable for a "new this
// week" or "coming this month" row are scattered deep into the full result
// set. Paginates (each page paced like any other request) until
// enough day-precise, in-window candidates are collected — or the results
// are exhausted, or maxPages is hit — rather than trusting the first page
// to contain them, which is what previously made the New releases /
// Upcoming rows unreliable (a handful of usable hits at best, sometimes
// none) despite MusicBrainz actually holding hundreds of matches.
export async function searchReleaseGroupsInDateWindow(
  sinceStr: string,
  untilStr: string,
  { targetCount, maxPages }: { targetCount: number; maxPages: number },
): Promise<ReleaseGroupSearchHit[]> {
  const found: ReleaseGroupSearchHit[] = [];
  const seenIds = new Set<string>();
  // A bulk search page can legitimately take longer than the 2s budget
  // tuned for single quick lookups elsewhere (resolveReleaseGroup, artist
  // search) — MusicBrainz's own response time varies with its load. Failing
  // one page shouldn't sink the whole pool: on error/timeout, this stops
  // paginating and returns whatever was already found instead of throwing,
  // so a slow moment degrades to "fewer candidates" rather than "none".
  const SEARCH_TIMEOUT_MS = 4000;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL("https://musicbrainz.org/ws/2/release-group/");
    url.searchParams.set(
      "query",
      `primarytype:album AND firstreleasedate:[${sinceStr} TO ${untilStr}]`,
    );
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", String(RELEASE_GROUP_SEARCH_PAGE_SIZE));
    url.searchParams.set("offset", String(page * RELEASE_GROUP_SEARCH_PAGE_SIZE));

    let hits: ReleaseGroupSearchHit[];
    try {
      const response = await fetchMusicBrainz(url, {
        priority: PRIORITY_BACKGROUND,
        timeoutMs: SEARCH_TIMEOUT_MS,
      });
      const data: {
        "release-groups"?: ReleaseGroupSearchHit[];
        error?: string;
      } = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error ?? "MusicBrainz lookup failed");
      }
      hits = data["release-groups"] ?? [];
    } catch (err) {
      if (found.length > 0) break;
      throw err;
    }

    for (const rg of hits) {
      const date = rg["first-release-date"];
      if (
        date &&
        date.length === 10 &&
        date >= sinceStr &&
        date <= untilStr &&
        !seenIds.has(rg.id)
      ) {
        seenIds.add(rg.id);
        found.push(rg);
      }
    }

    const exhausted = hits.length < RELEASE_GROUP_SEARCH_PAGE_SIZE;
    if (exhausted || found.length >= targetCount) break;
  }

  return found;
}

// Cover Art Archive (backed by Internet Archive) is often slow and
// occasionally briefly down — routing every cover through our own cached
// proxy means the browser only ever waits on that once per image, ever,
// instead of on every page load. See /api/cover-art/route.ts.
export function coverArtArchiveUrl(releaseGroupId: string): string {
  return `/api/cover-art?src=${encodeURIComponent(coverArtArchiveSrc(releaseGroupId))}`;
}

// The raw Cover Art Archive URL, unproxied — for lazyArtworkUrl's fallback.
export function coverArtArchiveSrc(releaseGroupId: string): string {
  return `https://coverartarchive.org/release-group/${releaseGroupId}/front-250`;
}

function escapeLucene(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

const resolveReleaseGroupCache = createTtlCache<{
  mbid: string;
  coverArtUrl: string;
} | null>(MUSICBRAINZ_CACHE_TTL_MS);

// Resolves a (artist, title) pair — as returned by an external catalog like
// Last.fm, which doesn't reliably carry a MusicBrainz ID — to a real
// release-group and its Cover Art Archive URL. Last.fm's own `mbid` fields
// are frequently stale (pointing at merged/deleted MBIDs), so results are
// always found via a fresh text search rather than trusted directly.
export async function resolveReleaseGroup(
  artist: string,
  title: string,
): Promise<{ mbid: string; coverArtUrl: string } | null> {
  const cacheKey = `${artist.toLowerCase()}::${title.toLowerCase()}`;
  const cached = resolveReleaseGroupCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const url = new URL("https://musicbrainz.org/ws/2/release-group/");
  url.searchParams.set(
    "query",
    `artist:"${escapeLucene(artist)}" AND release:"${escapeLucene(title)}"`,
  );
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", "1");

  try {
    const response = await fetchMusicBrainz(url);
    // A 503 that outlasted fetchMusicBrainz's retries is MusicBrainz
    // throttling, not "no such album" — caching it as null would hide this
    // candidate for the whole cache window.
    if (!response.ok) return null;
    const data: { "release-groups"?: { id: string }[] } =
      await response.json();
    const match = data["release-groups"]?.[0];
    const result = match
      ? { mbid: match.id, coverArtUrl: coverArtArchiveUrl(match.id) }
      : null;

    resolveReleaseGroupCache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

type ReleaseGroupHit = {
  id: string;
  title: string;
  artistCredit: { name: string; artist?: { id: string; name: string } }[];
};

const releaseGroupSearchCache = createTtlCache<ReleaseGroupHit[]>(
  MUSICBRAINZ_CACHE_TTL_MS,
);

async function searchReleaseGroups(
  query: string,
  limit: number,
): Promise<ReleaseGroupHit[]> {
  const cacheKey = `${query}::${limit}`;
  const cached = releaseGroupSearchCache.get(cacheKey);
  if (cached) return cached;

  const url = new URL("https://musicbrainz.org/ws/2/release-group/");
  url.searchParams.set("query", query);
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", String(limit));

  try {
    const response = await fetchMusicBrainz(url);
    // Throttled, not empty — don't cache it as no results (see
    // resolveReleaseGroup).
    if (!response.ok) return [];
    const data: {
      "release-groups"?: {
        id: string;
        title: string;
        "artist-credit"?: { name: string; artist?: { id: string; name: string } }[];
      }[];
    } = await response.json();

    const hits = (data["release-groups"] ?? []).map((rg) => ({
      id: rg.id,
      title: rg.title,
      artistCredit: rg["artist-credit"] ?? [],
    }));

    releaseGroupSearchCache.set(cacheKey, hits);
    return hits;
  } catch {
    return [];
  }
}

function creditName(
  credit: { name: string; artist?: { name: string } } | undefined,
): string | undefined {
  return credit?.artist?.name ?? credit?.name;
}

// An artist's own studio albums — primary type "Album" with no secondary
// type (i.e. not a live album, compilation, soundtrack, remix, etc).
export async function findArtistStudioAlbums(
  artist: string,
  limit = 25,
): Promise<{ id: string; title: string }[]> {
  const query = `artist:"${escapeLucene(artist)}" AND primarytype:album AND NOT secondarytype:*`;
  return searchReleaseGroups(query, limit);
}

// An artist's own singles/EPs (own primary release, not a feature).
export async function findArtistSinglesAndEps(
  artist: string,
  limit = 25,
): Promise<{ id: string; title: string }[]> {
  const query = `artist:"${escapeLucene(artist)}" AND (primarytype:single OR primarytype:ep) AND NOT secondarytype:*`;
  return searchReleaseGroups(query, limit);
}

// Singles/EPs primarily credited to another artist where this artist
// appears as a featured guest — explicitly excludes full albums where they
// only guest on one track, and excludes results where this artist is
// actually the lead (those are covered by findArtistSinglesAndEps above).
export async function findFeaturedSingles(
  artist: string,
  limit = 25,
): Promise<{ id: string; title: string; leadArtist: string }[]> {
  const query = `artist:"${escapeLucene(artist)}" AND (primarytype:single OR primarytype:ep)`;
  const hits = await searchReleaseGroups(query, limit);
  const lowerArtist = artist.toLowerCase();

  return hits
    .filter((hit) => hit.artistCredit.length > 1)
    .map((hit) => ({
      id: hit.id,
      title: hit.title,
      leadArtist: creditName(hit.artistCredit[0]) ?? artist,
      isFeature: hit.artistCredit.some(
        (credit) => creditName(credit)?.toLowerCase() === lowerArtist,
      ),
      leadIsSearchedArtist:
        creditName(hit.artistCredit[0])?.toLowerCase() === lowerArtist,
    }))
    .filter((hit) => hit.isFeature && !hit.leadIsSearchedArtist)
    .map(({ id, title, leadArtist }) => ({ id, title, leadArtist }));
}

// Finds the most recent already-released album by an artist, for use as
// fallback art when a not-yet-released album has no cover of its own yet.
export async function getArtistMostRecentAlbumArt(
  artist: string,
): Promise<string | null> {
  const url = new URL("https://musicbrainz.org/ws/2/release-group/");
  url.searchParams.set(
    "query",
    `artist:"${escapeLucene(artist)}" AND primarytype:album`,
  );
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", "10");

  try {
    // Only used by the Upcoming row's background scrape.
    const response = await fetchMusicBrainz(url, {
      priority: PRIORITY_BACKGROUND,
    });
    const data: {
      "release-groups"?: { id: string; "first-release-date"?: string }[];
    } = await response.json();

    const today = new Date().toISOString().slice(0, 10);
    const alreadyReleased = (data["release-groups"] ?? [])
      .filter((rg) => {
        const date = rg["first-release-date"];
        return date && date.length === 10 && date <= today;
      })
      .sort((a, b) =>
        a["first-release-date"]! < b["first-release-date"]! ? 1 : -1,
      );

    const mostRecent = alreadyReleased[0];
    return mostRecent ? coverArtArchiveUrl(mostRecent.id) : null;
  } catch {
    return null;
  }
}
