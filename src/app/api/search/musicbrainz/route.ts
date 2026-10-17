import { NextRequest, NextResponse } from "next/server";
import { lazyArtworkUrl } from "@/lib/itunes";
import { attachPlaycounts } from "@/lib/lastfm";
import { coverArtArchiveSrc, fetchMusicBrainz } from "@/lib/musicbrainz";
import { rankSearchResults, relevanceScore } from "@/lib/searchRelevance";
import type { SearchResult } from "@/lib/types";

const RESULT_LIMIT = 18;

type MusicBrainzArtistCredit = {
  name: string;
  joinphrase?: string;
};

type MusicBrainzReleaseGroup = {
  id: string;
  title: string;
  "first-release-date"?: string;
  "artist-credit"?: MusicBrainzArtistCredit[];
};

type MusicBrainzSearchResponse = {
  "release-groups"?: MusicBrainzReleaseGroup[];
  error?: string;
};

// GET /api/search/musicbrainz?q=... — the exhaustive, slower half of album
// search. iTunes' catalog (see /api/search) is missing a meaningful number
// of real albums — older/indie/non-major-label releases especially —
// MusicBrainz is a far more complete open metadata database and catches
// those. The client (useAlbumSearch) fires this in parallel with /api/search
// and merges in whatever turns up here that isn't already in the iTunes
// results, so this route is free to be the slower one: unlike iTunes, a
// MusicBrainz result's cover isn't bundled into the response — it's looked
// up per image (see lazyArtworkUrl).
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  const musicBrainzUrl = new URL("https://musicbrainz.org/ws/2/release-group/");
  musicBrainzUrl.searchParams.set("query", query);
  musicBrainzUrl.searchParams.set("fmt", "json");
  musicBrainzUrl.searchParams.set("limit", "25");

  try {
    const response = await fetchMusicBrainz(musicBrainzUrl);
    const data: MusicBrainzSearchResponse = await response.json();

    if (!response.ok || data.error) {
      return NextResponse.json(
        { error: data.error ?? "MusicBrainz search failed" },
        { status: 502 },
      );
    }

    const mostRelevant: SearchResult[] = [...(data["release-groups"] ?? [])]
      .map((releaseGroup) => {
        const artist =
          releaseGroup["artist-credit"]
            ?.map((credit) => `${credit.name}${credit.joinphrase ?? ""}`)
            .join("")
            .trim() ?? "Unknown artist";

        return {
          mbid: releaseGroup.id,
          title: releaseGroup.title,
          artist,
          year: releaseGroup["first-release-date"]?.slice(0, 4) ?? null,
          // Last.fm's cover first (already fetched for ranking, below),
          // Cover Art Archive second — Cover Art Archive alone is often
          // slow or missing. Falls back to a placeholder if neither has
          // one. See lazyArtwork in /api/cover-art.
          coverArtUrl: lazyArtworkUrl(
            artist,
            releaseGroup.title,
            coverArtArchiveSrc(releaseGroup.id),
          ),
        };
      })
      .sort(
        (a, b) =>
          relevanceScore(query, b.title, b.artist) -
          relevanceScore(query, a.title, a.artist),
      )
      .slice(0, RESULT_LIMIT);

    // Match quality, then most-played first, one copy per album — see
    // rankSearchResults.
    const results = rankSearchResults(
      await attachPlaycounts(mostRelevant),
      query,
    );

    return NextResponse.json({ results });
  } catch (err) {
    console.error("musicbrainz search failed", err);
    return NextResponse.json(
      { error: "MusicBrainz search failed" },
      { status: 502 },
    );
  }
}
