import { lazyArtworkUrl } from "./itunes";
import { getAlbumInfo, lastfmAlbumId, lastfmCoverUrl, lastfmFetch } from "./lastfm";
import { isSingleRelease } from "./releaseType";
import { prisma } from "./prisma";
import { baseAlbumTitle, dedupeKey } from "./searchRelevance";
import type { AlbumSummary } from "./types";

// The pool can be bigger than what's actually shown at once — the extra
// candidates are handed to the client as a ready-to-use replacement queue
// for dismiss/auto-replace, avoiding a follow-up API call for either.
// Only one album per artist is shown (see collectAlbumsForArtists) — the
// rest are fallbacks for when the top one is already saved or was just
// shown.
const ALBUMS_PER_ARTIST = 6;
const DEFAULT_POOL_SIZE = 18;
const CACHE_TTL_MS = 10 * 60 * 1000;

// Identifies a saved album by artist + edition-stripped title, for
// candidates whose id can't match a saved album's: a recommendation's
// `lastfm:` id never equals the `itunes:`/MusicBrainz id the same album was
// saved under.
export function savedAlbumKey(artist: string, title: string): string {
  return `album:${dedupeKey(artist, baseAlbumTitle(title))}`;
}

// Everything the user has saved, as both ids and savedAlbumKeys — check
// whichever the candidate has.
export async function getSavedMbids(userId: number): Promise<Set<string>> {
  const albums = await prisma.album.findMany({
    where: { userId },
    select: { mbid: true, artist: true, title: true },
  });
  return new Set(
    albums.flatMap((a) => [a.mbid, savedAlbumKey(a.artist, a.title)]),
  );
}

// A cold lookup is a few seconds of Last.fm (and, for the artist mode,
// MusicBrainz) requests, so results for a given mode+params are cached
// briefly rather than recomputed on every
// visit/switch back to the same selection. A "refresh" request (exclude
// list non-empty) always bypasses this — it exists specifically to surface
// something different, so serving the same cached batch back would defeat it.
const resultCache = new Map<string, { at: number; albums: AlbumSummary[] }>();
// A request for a selection that's already being computed (StrictMode's
// double effect in dev, switching away and back mid-load) waits on that
// computation instead of starting a second one.
const inFlight = new Map<string, Promise<AlbumSummary[]>>();

export async function getCachedRecommendations(
  cacheKey: string,
  compute: () => Promise<AlbumSummary[]>,
  { bypassCache = false }: { bypassCache?: boolean } = {},
): Promise<AlbumSummary[]> {
  const run = () =>
    compute().then((albums) => {
      // An empty batch is far more often MusicBrainz throttling every
      // candidate's lookup at once than a real "nothing to recommend" —
      // caching it would leave the page blank for the whole TTL instead of
      // retrying on the next visit.
      if (albums.length > 0) {
        resultCache.set(cacheKey, { at: Date.now(), albums });
      }
      return albums;
    });
  if (bypassCache) return run();

  const cached = resultCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.albums;

  let pending = inFlight.get(cacheKey);
  if (!pending) {
    pending = run().finally(() => inFlight.delete(cacheKey));
    inFlight.set(cacheKey, pending);
  }
  // Past its TTL, the last batch is still served immediately while the
  // recompute above runs in the background, rather than making this visit
  // wait through it. Only a selection never computed before waits.
  if (cached) {
    pending.catch(() => {});
    return cached.albums;
  }
  return pending;
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

type LastfmAlbum = {
  name: string;
  image?: { "#text": string; size: string }[];
};

// Given a list of artist names, pulls each artist's top albums from
// Last.fm. These used to be cross-referenced against MusicBrainz for a
// release-group id first, but that was ~24 MusicBrainz lookups per load —
// slow under its 1 req/sec limit, and the main reason this page came back
// short or empty when MusicBrainz throttled. Nothing needs the id up front:
// /api/tracklist resolves one from artist+title for any non-UUID id, the
// same as for search results. Covers come from Last.fm's own response,
// falling back to a per-image lookup (see lazyArtworkUrl) when it has none.
export async function collectAlbumsForArtists(
  artistNames: string[],
  savedMbids: Set<string>,
  poolSize = DEFAULT_POOL_SIZE,
  excludeMbids: Set<string> = new Set(),
): Promise<AlbumSummary[]> {
  // Each artist's top-albums lookup is independent, so run them together
  // instead of one artist at a time.
  const perArtistAlbums = await Promise.all(
    artistNames.map(async (artistName): Promise<AlbumSummary[]> => {
      try {
        const data = await lastfmFetch<{
          topalbums?: { album?: LastfmAlbum[] };
        }>("artist.gettopalbums", {
          artist: artistName,
          limit: String(ALBUMS_PER_ARTIST),
        });
        return (data.topalbums?.album ?? [])
          // Last.fm lists scrobbles with no album tag under "(null)".
          .filter((album) => album.name && album.name !== "(null)")
          .map((album) => {
            const imageUrl = lastfmCoverUrl(album.image);
            return {
              mbid: lastfmAlbumId(artistName, album.name),
              title: album.name,
              artist: artistName,
              coverArtUrl: imageUrl
                ? `/api/cover-art?src=${encodeURIComponent(imageUrl)}`
                : lazyArtworkUrl(artistName, album.name, ""),
            };
          });
      } catch {
        return [];
      }
    }),
  );

  // One album per artist, so the page isn't three J. Cole albums in a row:
  // each artist's most popular album that isn't already saved — and on a
  // refresh, preferably one that wasn't just shown, so Refresh can swap in
  // a different album from the same artist rather than only reshuffling.
  // Their next-best albums stay as fallbacks in case everything else is
  // saved or was just shown.
  //
  // Last.fm's "top albums" include hit singles, and it doesn't label release
  // types, so each candidate's track count (album.getinfo) decides — checked
  // only until a pick is found, and cached. Singles are left out of every
  // album list (see releaseType.ts).
  const picks = await Promise.all(
    perArtistAlbums.map(async (albums) => {
      const unsaved = albums.filter(
        (a) => !savedMbids.has(savedAlbumKey(a.artist, a.title)),
      );
      const ordered = [
        ...unsaved.filter((a) => !excludeMbids.has(a.mbid)),
        ...unsaved.filter((a) => excludeMbids.has(a.mbid)),
      ];
      for (const album of ordered) {
        const { trackCount } = await getAlbumInfo(album.artist, album.title);
        if (!isSingleRelease(album.title, trackCount)) return album;
      }
      return null;
    }),
  );
  const ranked = picks.filter((a): a is AlbumSummary => a !== null);

  return preferFresh(ranked, (a) => a.mbid, poolSize, excludeMbids);
}
