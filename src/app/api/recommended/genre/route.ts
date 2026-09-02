import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/currentUser";
import { lastfmFetch } from "@/lib/lastfm";
import {
  collectAlbumsForArtists,
  getCachedRecommendations,
  getSavedMbids,
} from "@/lib/recommendations";

const TOP_ARTIST_COUNT = 8;
// A "Refresh" widens the top-artist net so there's a real pool of fresh
// candidates to draw from, instead of just re-ranking the same handful.
const TOP_ARTIST_COUNT_REFRESH = 16;

// GET /api/recommended/genre?tag=...[&exclude=mbid,mbid,...] — finds top
// artists for a Last.fm tag (genre) and surfaces their top albums.
export async function GET(request: NextRequest) {
  const tag = request.nextUrl.searchParams.get("tag")?.trim();
  const excludeMbids = new Set(
    (request.nextUrl.searchParams.get("exclude") ?? "")
      .split(",")
      .filter(Boolean),
  );
  const isRefresh = excludeMbids.size > 0;

  if (!tag) {
    return NextResponse.json({ error: "tag is required" }, { status: 400 });
  }

  try {
    const userId = await getCurrentUserId();

    const albums = await getCachedRecommendations(
      `genre:${userId}:${tag.toLowerCase()}`,
      async () => {
        const data = await lastfmFetch<{
          topartists?: { artist?: { name: string }[] };
        }>("tag.gettopartists", {
          tag,
          limit: String(isRefresh ? TOP_ARTIST_COUNT_REFRESH : TOP_ARTIST_COUNT),
        });

        const artists = (data.topartists?.artist ?? []).map((a) => a.name);
        if (artists.length === 0) return [];

        const savedMbids = await getSavedMbids(userId);
        return collectAlbumsForArtists(
          artists,
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
        message: `No new recommendations found for "${tag}" right now.`,
      });
    }

    return NextResponse.json({ albums });
  } catch (err) {
    console.error("genre-based recommendations failed", err);
    return NextResponse.json(
      { error: "Failed to load recommendations" },
      { status: 502 },
    );
  }
}
