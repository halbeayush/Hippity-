import { NextRequest, NextResponse } from "next/server";
import { itunesArtworkProxyUrl, searchITunesAlbums } from "@/lib/itunes";
import { relevanceScore } from "@/lib/searchRelevance";

// A wider raw fetch than what's shown (see RESULT_LIMIT below the sort) so
// relevanceScore has enough of a pool to actually rank a real album above a
// pile of same-titled singles, rather than whatever the first 24 happened
// to be.
const FETCH_LIMIT = 50;
const RESULT_LIMIT = 24;

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

  const albums = await searchITunesAlbums(query, FETCH_LIMIT);

  const results = [...albums]
    .sort(
      (a, b) =>
        relevanceScore(query, b.title, b.artist, b.trackCount) -
        relevanceScore(query, a.title, a.artist, a.trackCount),
    )
    .slice(0, RESULT_LIMIT)
    .map((album) => ({
      // iTunes has no MusicBrainz release-group id to offer — this is kept
      // in the same "mbid" field the rest of the app already keys saved
      // albums by (Album.mbid, RecommendationSent.mbid — both just opaque
      // unique strings, not schema-enforced MusicBrainz UUIDs) so nothing
      // downstream needs to change, but namespaced so it's never mistaken
      // for one. /api/tracklist recognizes this prefix and resolves a real
      // MusicBrainz id by text search instead, on demand.
      mbid: `itunes:${album.collectionId}`,
      title: album.title,
      artist: album.artist,
      year: album.releaseDate?.slice(0, 4) ?? null,
      coverArtUrl: album.artworkUrl100
        ? itunesArtworkProxyUrl(album.artworkUrl100)
        : "",
      trackCount: album.trackCount,
    }));

  return NextResponse.json({ results });
}
