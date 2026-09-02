import { NextRequest, NextResponse } from "next/server";
import { lastfmFetch } from "@/lib/lastfm";

// GET /api/recommended/artist-search?q=... — autocomplete suggestions for
// the "Based on an artist" mode's search input.
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();

  if (!query) {
    return NextResponse.json({ artists: [] });
  }

  try {
    const data = await lastfmFetch<{
      results?: { artistmatches?: { artist?: { name: string }[] } };
    }>("artist.search", { artist: query, limit: "8" });

    const artists = (data.results?.artistmatches?.artist ?? [])
      .map((a) => a.name)
      .filter((name, index, all) => all.indexOf(name) === index);

    return NextResponse.json({ artists });
  } catch {
    return NextResponse.json({ error: "Search failed" }, { status: 502 });
  }
}
