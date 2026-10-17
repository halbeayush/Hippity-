import { NextResponse } from "next/server";
import { getMusicNews } from "@/lib/musicNews";
import { SHARED_ROW_CACHE_HEADERS } from "@/lib/persistentCache";

// GET /api/home/music-news — recent headlines from a small set of music
// publications' RSS feeds, merged and most recent first. See musicNews.ts
// for the per-feed fetch/parse/cache logic.
export async function GET() {
  try {
    const items = await getMusicNews();
    return NextResponse.json({ items }, { headers: SHARED_ROW_CACHE_HEADERS });
  } catch (err) {
    console.error("music news lookup failed", err);
    return NextResponse.json(
      { error: "Failed to load music news" },
      { status: 502 },
    );
  }
}
