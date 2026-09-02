import { createTtlCache } from "./apiCache";

// MusicBrainz requires every client to identify itself with a descriptive
// User-Agent that includes contact info, or it will start rejecting requests.
export const MUSICBRAINZ_USER_AGENT =
  "Spinsheet/0.1.0 ( halbeayush2@gmail.com )";

// Recommendation candidates frequently repeat the same artist/title lookup
// across modes and page revisits — caching the resolved release-group (or
// the search hit list) avoids re-querying MusicBrainz for the same query
// within this window.
const MUSICBRAINZ_CACHE_TTL_MS = 10 * 60 * 1000;

// How long a single lookup — including its own retries — is allowed to
// take before giving up. Most requests resolve in well under a second, but
// a rare one gets stuck far longer (seemingly queued behind MusicBrainz's
// own throttling); when resolving a whole batch of recommendation
// candidates together, one stuck request would otherwise hold up the
// entire page. The timeout is shared across retries (one deadline from the
// first attempt), not restarted per attempt, so it bounds the whole chain.
const MUSICBRAINZ_TIMEOUT_MS = 2000;

// MusicBrainz's search index occasionally reports itself as busy — it still
// answers with 503 and recovers within a request or two, so a short retry
// clears up most of these transiently instead of surfacing as an error.
export async function fetchMusicBrainz(
  musicBrainzUrl: URL,
  attempt = 0,
  signal: AbortSignal = AbortSignal.timeout(MUSICBRAINZ_TIMEOUT_MS),
): Promise<Response> {
  const response = await fetch(musicBrainzUrl, {
    headers: {
      "User-Agent": MUSICBRAINZ_USER_AGENT,
      Accept: "application/json",
    },
    signal,
  });

  if (response.status === 503 && attempt < 2) {
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    return fetchMusicBrainz(musicBrainzUrl, attempt + 1, signal);
  }

  return response;
}

// MusicBrainz allows ~1 request/second per IP. Any caller doing more than a
// single lookup (cross-referencing a batch of candidates, resolving several
// artists) must space its own calls out by at least this long.
export const MUSICBRAINZ_REQUEST_INTERVAL_MS = 1100;

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
// set. Paginates (respecting the 1 req/sec limit between pages) until
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
      const response = await fetchMusicBrainz(
        url,
        0,
        AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      );
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
    if (page < maxPages - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, MUSICBRAINZ_REQUEST_INTERVAL_MS),
      );
    }
  }

  return found;
}

// Cover Art Archive (backed by Internet Archive) is often slow and
// occasionally briefly down — routing every cover through our own cached
// proxy means the browser only ever waits on that once per image, ever,
// instead of on every page load. See /api/cover-art/route.ts.
export function coverArtArchiveUrl(releaseGroupId: string): string {
  const original = `https://coverartarchive.org/release-group/${releaseGroupId}/front-250`;
  return `/api/cover-art?src=${encodeURIComponent(original)}`;
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
    const response = await fetchMusicBrainz(url);
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
