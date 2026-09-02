import { NextRequest, NextResponse } from "next/server";
import { coverArtArchiveUrl, fetchMusicBrainz } from "@/lib/musicbrainz";
import { relevanceScore } from "@/lib/searchRelevance";

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
// MusicBrainz result needs its own separate Cover Art Archive lookup
// (coverArtArchiveUrl proxies and caches it, but the first fetch for a
// given release is a real network round trip, not bundled into this
// response the way iTunes' artwork is).
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

    const results = [...(data["release-groups"] ?? [])]
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
          // Not every release has cover art, so the frontend falls back to
          // a placeholder if this 404s — same as everywhere else artwork
          // is sourced from Cover Art Archive.
          coverArtUrl: coverArtArchiveUrl(releaseGroup.id),
        };
      })
      .sort(
        (a, b) =>
          relevanceScore(query, b.title, b.artist) -
          relevanceScore(query, a.title, a.artist),
      )
      .slice(0, RESULT_LIMIT);

    return NextResponse.json({ results });
  } catch (err) {
    console.error("musicbrainz search failed", err);
    return NextResponse.json(
      { error: "MusicBrainz search failed" },
      { status: 502 },
    );
  }
}
