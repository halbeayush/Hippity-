import { NextRequest, NextResponse } from "next/server";
import {
  getArtistCatalog,
  isSingle,
  isSingleOrEp,
  itunesArtworkProxyUrl,
  lazyArtworkUrl,
  oneEditionPerAlbum,
  searchITunesAlbums,
  type ITunesAlbum,
} from "@/lib/itunes";
import {
  attachPlaycounts,
  getAlbumInfo,
  lastfmAlbumId,
  searchPopularAlbums,
} from "@/lib/lastfm";
import {
  albumVariantKey,
  applyArtistFilter,
  creditKey,
  findQueriedArtist,
  isArtistOnlyQuery,
  rankSearchResults,
  relevanceScore,
  titleKey,
  type ArtistFilter,
} from "@/lib/searchRelevance";
import { isSingleRelease } from "@/lib/releaseType";
import type { SearchResult } from "@/lib/types";

// A wider raw fetch than what's shown (see RESULT_LIMIT below the sort) so
// relevanceScore has enough of a pool to actually rank a real album above a
// pile of same-titled singles, rather than whatever the first 24 happened
// to be.
const FETCH_LIMIT = 50;
const RESULT_LIMIT = 24;
const POPULAR_ALBUM_LIMIT = 8;

// GET /api/search?q=... — the fast half of album search, backed directly by
// the iTunes Search API. iTunes returns artwork in the same response as the
// match itself, so a result here is ready to render (title, artist, working
// cover art) with no second lookup. iTunes' catalog isn't exhaustive though
// (older/indie/non-major-label releases are often missing) — the client
// (useAlbumSearch) fires this in parallel with /api/search/musicbrainz and
// merges in whatever that turns up that isn't already here, so this route
// only needs to worry about being fast, not complete.
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  const [albums, popular] = await Promise.all([
    searchITunesAlbums(query, FETCH_LIMIT),
    searchPopularAlbums(query, POPULAR_ALBUM_LIMIT),
  ]);

  // Albums and EPs only — singles are left out (see releaseType.ts).
  const mostRelevant: SearchResult[] = albums
    .filter((a) => !isSingle(a))
    .sort(
      (a, b) =>
        relevanceScore(query, b.title, b.artist, b.trackCount) -
        relevanceScore(query, a.title, a.artist, a.trackCount),
    )
    .slice(0, RESULT_LIMIT)
    .map(toSearchResult);

  // If the query names an artist, their official catalog: it decides which
  // results credited to them are real (see applyArtistFilter), and supplies
  // their albums that plain search missed entirely.
  const queried = findQueriedArtist(query, albums);
  const catalog = queried?.artistId
    ? await getArtistCatalog(queried.artistId)
    : [];
  const artistFilters: ArtistFilter[] = [];
  if (queried && catalog.length > 0) {
    artistFilters.push(
      catalogFilter(
        queried.artist,
        catalog,
        isArtistOnlyQuery(query, queried.artist),
      ),
    );
  }

  const seen = new Set(
    mostRelevant.map((r) => albumVariantKey(r.artist, r.title)),
  );
  const catalogMissing = catalogAlbumsMissingFrom(catalog, seen);

  // Last.fm's most popular matches that iTunes missed. Lives here in the
  // fast route, not the MusicBrainz one, so it doesn't vanish whenever
  // MusicBrainz is throttling — no MusicBrainz id is needed up front:
  // /api/tracklist resolves one from artist+title for any non-UUID id, the
  // same way it does for `itunes:` ones.
  for (const r of catalogMissing) seen.add(albumVariantKey(r.artist, r.title));
  const popularMissing: SearchResult[] = popular
    .filter((a) => !seen.has(albumVariantKey(a.artist, a.title)))
    .map((a) => ({
      mbid: lastfmAlbumId(a.artist, a.title),
      title: a.title,
      artist: a.artist,
      year: null,
      // Last.fm's own cover when it has one; otherwise iTunes, looked up
      // only when the image is actually requested.
      coverArtUrl: a.imageUrl
        ? `/api/cover-art?src=${encodeURIComponent(a.imageUrl)}`
        : lazyArtworkUrl(a.artist, a.title, ""),
    }));

  // Filtered after attaching play counts, since applyArtistFilter weighs
  // them. Then match quality, most-played first, one copy per album — see
  // rankSearchResults.
  const pool = await withoutSingles(
    await attachPlaycounts([...mostRelevant, ...catalogMissing, ...popularMissing]),
  );
  let results = rankSearchResults(
    applyArtistFilter(pool, artistFilters, query),
    query,
  );

  // A search for an album title ("good kid maad city") doesn't name its
  // artist, but fan uploads of that album credited to them ("Good Kid MAAD
  // City (Kinda bootleg) — Kendrick Lamar") are just as unwanted. So the
  // top result's artist gets the same official-catalog check, when iTunes
  // knows them.
  const topArtist = results[0]?.artist;
  const topArtistId =
    topArtist && topArtist !== queried?.artist
      ? albums.find((a) => a.artist === topArtist)?.artistId
      : null;
  if (topArtistId) {
    const topCatalog = await getArtistCatalog(topArtistId);
    if (topCatalog.length > 0) {
      artistFilters.push(catalogFilter(topArtist, topCatalog, false));
      results = applyArtistFilter(results, artistFilters, query);
    }
  }

  // The filters go back to the client too, which applies them to the
  // MusicBrainz results it merges in (see useAlbumSearch).
  return NextResponse.json({ results, artistFilters });
}

// Last.fm's popular matches carry no track count, so theirs comes from the
// same album.getinfo lookup attachPlaycounts just made (cached, so no
// second request). One Last.fm has no track list for at all is dropped
// too: a genuinely popular album nearly always has one, and in practice
// the ones without are odd duplicate entries, e.g. "Not Like Us" filed
// under Kendrick Lamar's Japanese name. iTunes results already went
// through isSingle.
async function withoutSingles<T extends SearchResult>(results: T[]): Promise<T[]> {
  const keep = await Promise.all(
    results.map(async (r) => {
      if (r.trackCount !== undefined) return !isSingleRelease(r.title, r.trackCount);
      const { trackCount } = await getAlbumInfo(r.artist, r.title);
      if (r.mbid.startsWith("lastfm:") && trackCount === 0) return false;
      return !isSingleRelease(r.title, trackCount);
    }),
  );
  return results.filter((_, i) => keep[i]);
}

function catalogFilter(
  artist: string,
  catalog: ITunesAlbum[],
  artistOnly: boolean,
): ArtistFilter {
  return {
    artist,
    officialCredits: [...new Set([artist, ...catalog.map((a) => a.artist)].map(creditKey))],
    officialTitles: [...new Set(catalog.map((a) => titleKey(a.title)))],
    artistOnly,
  };
}

// iTunes has no MusicBrainz release-group id to offer — this is kept in the
// same "mbid" field the rest of the app already keys saved albums by
// (Album.mbid, RecommendationSent.mbid — both just opaque unique strings,
// not schema-enforced MusicBrainz UUIDs) so nothing downstream needs to
// change, but namespaced so it's never mistaken for one. /api/tracklist
// recognizes this prefix and resolves a real MusicBrainz id by text search
// instead, on demand.
function toSearchResult(album: ITunesAlbum): SearchResult {
  return {
    mbid: `itunes:${album.collectionId}`,
    title: album.title,
    artist: album.artist,
    year: album.releaseDate?.slice(0, 4) ?? null,
    coverArtUrl: album.artworkUrl100
      ? itunesArtworkProxyUrl(album.artworkUrl100)
      : "",
    trackCount: album.trackCount,
  };
}

// The catalog's albums not already among the search results, one edition
// each. Singles and EPs aren't pulled in from the catalog — an artist's
// page lists dozens, which would bury their albums (and each would cost a
// play-count lookup). Ones the search itself turned up still show.
function catalogAlbumsMissingFrom(
  catalog: ITunesAlbum[],
  seen: Set<string>,
): SearchResult[] {
  return oneEditionPerAlbum(catalog.filter((a) => !isSingleOrEp(a)))
    .filter((a) => !seen.has(albumVariantKey(a.artist, a.title)))
    .map(toSearchResult);
}
