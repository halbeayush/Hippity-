import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/currentUser";
import { lastfmFetch } from "@/lib/lastfm";
import { prisma } from "@/lib/prisma";
import {
  collectAlbumsForArtists,
  getCachedRecommendations,
  getSavedMbids,
} from "@/lib/recommendations";

const SEED_ARTIST_COUNT = 4;
const SIMILAR_PER_SEED = 5;
const SIMILAR_ARTIST_COUNT = 8;
// A "Refresh" widens the similar-artist net so there's a real pool of fresh
// candidates to draw from, instead of just re-ranking the same handful.
const SIMILAR_ARTIST_COUNT_REFRESH = 16;

type LastfmSimilarArtist = { name: string; match: string };

// GET /api/recommended/library-based[?exclude=mbid,mbid,...] — seeds from
// the artists behind the user's highest-rated Library albums, finds similar
// artists on Last.fm for each, and surfaces their top albums. `exclude`
// (passed on refresh) is a soft preference against repeating the last
// batch, not a permanent block — see preferFresh in recommendations.ts.
export async function GET(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const excludeMbids = new Set(
      (request.nextUrl.searchParams.get("exclude") ?? "")
        .split(",")
        .filter(Boolean),
    );
    const isRefresh = excludeMbids.size > 0;

    const topRated = await prisma.album.findMany({
      where: { userId, status: "library", rating: { not: null } },
      orderBy: { rating: "desc" },
      take: 20,
    });

    if (topRated.length === 0) {
      return NextResponse.json({
        albums: [],
        message:
          "Rate a few albums in your Library to get recommendations based on them.",
      });
    }

    const seedArtists = Array.from(
      new Set(topRated.map((a) => a.artist)),
    ).slice(0, SEED_ARTIST_COUNT);

    // Cache key reflects the user and the actual seed artists, so results
    // auto-refresh once that user's top-rated albums change instead of only
    // after the TTL expires.
    const cacheKey = `library:${userId}:${seedArtists.map((a) => a.toLowerCase()).sort().join(",")}`;

    const albums = await getCachedRecommendations(
      cacheKey,
      async () => {
        // Each seed's similar-artist lookup is independent — run them
        // together instead of one seed at a time.
        const perSeedResults = await Promise.all(
          seedArtists.map(async (seed) => {
            try {
              const data = await lastfmFetch<{
                similarartists?: { artist?: LastfmSimilarArtist[] };
              }>("artist.getsimilar", {
                artist: seed,
                limit: String(SIMILAR_PER_SEED),
              });
              return data.similarartists?.artist ?? [];
            } catch {
              return [];
            }
          }),
        );

        // Merge similar artists across all seeds, keeping each artist's best
        // match score in case they turn up as similar to more than one seed.
        const similarArtists = new Map<string, number>();
        for (const artist of perSeedResults.flat()) {
          const score = Number(artist.match);
          const existing = similarArtists.get(artist.name);
          if (existing === undefined || score > existing) {
            similarArtists.set(artist.name, score);
          }
        }

        const rankedArtists = Array.from(similarArtists.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, isRefresh ? SIMILAR_ARTIST_COUNT_REFRESH : SIMILAR_ARTIST_COUNT)
          .map(([name]) => name);

        if (rankedArtists.length === 0) return [];

        const savedMbids = await getSavedMbids(userId);
        return collectAlbumsForArtists(
          rankedArtists,
          savedMbids,
          undefined,
          excludeMbids,
        );
      },
      { bypassCache: isRefresh },
    );

    if (albums.length === 0) {
      return NextResponse.json({
        albums: [],
        message: "Couldn't find recommendations for your rated albums right now.",
      });
    }

    return NextResponse.json({ albums });
  } catch (err) {
    console.error("library-based recommendations failed", err);
    return NextResponse.json(
      { error: "Failed to load recommendations" },
      { status: 502 },
    );
  }
}
