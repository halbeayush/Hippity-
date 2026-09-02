import { NextRequest, NextResponse } from "next/server";
import { mapWithConcurrency } from "@/lib/concurrency";
import { getCurrentUserId } from "@/lib/currentUser";
import { findITunesArtwork } from "@/lib/itunes";
import {
  coverArtArchiveUrl,
  findArtistSinglesAndEps,
  findArtistStudioAlbums,
  findFeaturedSingles,
} from "@/lib/musicbrainz";
import {
  getCachedRecommendations,
  getSavedMbids,
  preferFresh,
} from "@/lib/recommendations";
import type { AlbumSummary } from "@/lib/types";

const ARTWORK_LOOKUP_CONCURRENCY = 6;

const POOL_SIZE = 18;
// A "Refresh" fetches a wider raw hit list per tier so there's a real pool
// of fresh candidates to draw from, instead of re-ranking the same 18.
const FETCH_LIMIT_REFRESH = 36;

// GET /api/recommended/artist?artist=...[&exclude=mbid,mbid,...] — surfaces
// the chosen artist's own catalog, not already in the library/to-do list,
// in three tiers: their own studio albums first, then their own
// singles/EPs, then other artists' singles/EPs where this artist appears as
// a featured guest. Lower tiers only fill in once the higher tier runs out.
export async function GET(request: NextRequest) {
  const artist = request.nextUrl.searchParams.get("artist")?.trim();
  const excludeMbids = new Set(
    (request.nextUrl.searchParams.get("exclude") ?? "")
      .split(",")
      .filter(Boolean),
  );
  const isRefresh = excludeMbids.size > 0;

  if (!artist) {
    return NextResponse.json({ error: "artist is required" }, { status: 400 });
  }

  try {
    const userId = await getCurrentUserId();
    const fetchLimit = isRefresh ? FETCH_LIMIT_REFRESH : POOL_SIZE;

    const albums = await getCachedRecommendations(
      `artist:${userId}:${artist.toLowerCase()}`,
      async () => {
        const [studioAlbums, ownSinglesEps, featuredSingles] =
          await Promise.all([
            findArtistStudioAlbums(artist, fetchLimit),
            findArtistSinglesAndEps(artist, fetchLimit),
            findFeaturedSingles(artist, fetchLimit),
          ]);

        const savedMbids = await getSavedMbids(userId);
        const seen = new Set<string>();
        const ranked: AlbumSummary[] = [];

        function addAll(
          hits: { id: string; title: string; leadArtist?: string }[],
          artistLabel: (hit: { leadArtist?: string }) => string,
        ) {
          for (const hit of hits) {
            if (savedMbids.has(hit.id) || seen.has(hit.id)) continue;
            seen.add(hit.id);
            ranked.push({
              mbid: hit.id,
              title: hit.title,
              artist: artistLabel(hit),
              coverArtUrl: coverArtArchiveUrl(hit.id),
            });
          }
        }

        addAll(studioAlbums, () => artist);
        addAll(ownSinglesEps, () => artist);
        addAll(featuredSingles, (hit) => hit.leadArtist ?? artist);

        const selected = preferFresh(ranked, (a) => a.mbid, POOL_SIZE, excludeMbids);

        // Only look up iTunes artwork for the albums actually being
        // returned, not every raw hit across all three tiers — most of
        // which preferFresh may have already discarded.
        return mapWithConcurrency(
          selected,
          ARTWORK_LOOKUP_CONCURRENCY,
          async (album) => ({
            ...album,
            coverArtUrl:
              (await findITunesArtwork(album.artist, album.title)) ??
              album.coverArtUrl,
          }),
        );
      },
      { bypassCache: isRefresh },
    );

    if (albums.length === 0) {
      return NextResponse.json({
        albums: [],
        message: `No new recommendations found for "${artist}" right now.`,
      });
    }

    return NextResponse.json({ albums });
  } catch (err) {
    console.error("artist-based recommendations failed", err);
    return NextResponse.json(
      { error: "Failed to load recommendations" },
      { status: 502 },
    );
  }
}
