import { NextRequest, NextResponse } from "next/server";
import { mapWithConcurrency } from "@/lib/concurrency";
import { findITunesArtwork } from "@/lib/itunes";
import { getArtistListeners } from "@/lib/lastfm";
import {
  coverArtArchiveUrl,
  searchReleaseGroupsInDateWindow,
  type ReleaseGroupSearchHit,
} from "@/lib/musicbrainz";
import type { HomeAlbum } from "@/lib/types";

const PAGE_SIZE = 5;
const MIN_REQUIRED = 5;
// A pool bigger than MIN_REQUIRED so there's something left for page 2+ of
// the carousel, and so an artist with no Last.fm listener data (ranked
// last, not excluded — see getArtistListeners) doesn't crowd out page 1.
const TARGET_POOL_SIZE = 15;
const NEW_RELEASE_WINDOW_DAYS = 14;
// If the normal window doesn't turn up MIN_REQUIRED candidates (a real
// possibility in a quiet week), the window widens once and searches again —
// "loosen the date window" per the fix, not an unbounded search.
const WIDENED_WINDOW_DAYS = 30;
const SEARCH_MAX_PAGES = 6;
const WIDENED_SEARCH_MAX_PAGES = 4;
const LISTENERS_LOOKUP_CONCURRENCY = 6;
// Repeat visits (and other users, in a multi-user deployment) hit this
// cache instead of re-scraping MusicBrainz/Last.fm — headlines-style data
// like "what's new this week" doesn't need to be fresher than this.
const CACHE_TTL_MS = 45 * 60 * 1000;

// Spotify's /browse/new-releases endpoint (and its popularity/followers
// fields) were removed for Development Mode apps in a 2026 API migration —
// see the git history for how that was diagnosed. Last.fm has no "new
// releases" concept of its own (artist.getTopAlbums ranks by all-time
// playcount, so a brand-new album from a top artist won't have accumulated
// enough plays to surface there), so recency comes from MusicBrainz's real
// release-date data instead, same as the Upcoming albums row but searching
// the last 14 days instead of the next 90. Each artist's Last.fm listener
// count stands in for the old popularity score to rank the results.
let cache: { at: number; albums: HomeAlbum[] } | null = null;

function windowFor(days: number) {
  const today = new Date();
  const since = new Date(today);
  since.setDate(since.getDate() - days);
  const format = (d: Date) => d.toISOString().slice(0, 10);
  return { sinceStr: format(since), todayStr: format(today) };
}

async function loadCandidates(): Promise<HomeAlbum[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.albums;

  try {
    const { sinceStr, todayStr } = windowFor(NEW_RELEASE_WINDOW_DAYS);
    let releaseGroups = await searchReleaseGroupsInDateWindow(sinceStr, todayStr, {
      targetCount: TARGET_POOL_SIZE,
      maxPages: SEARCH_MAX_PAGES,
    });

    if (releaseGroups.length < MIN_REQUIRED) {
      const widened = windowFor(WIDENED_WINDOW_DAYS);
      const more = await searchReleaseGroupsInDateWindow(
        widened.sinceStr,
        todayStr,
        { targetCount: TARGET_POOL_SIZE, maxPages: WIDENED_SEARCH_MAX_PAGES },
      );
      const seen = new Set(releaseGroups.map((rg) => rg.id));
      releaseGroups = [
        ...releaseGroups,
        ...more.filter((rg) => !seen.has(rg.id)),
      ];
    }

    const withListeners = await mapWithConcurrency(
      releaseGroups,
      LISTENERS_LOOKUP_CONCURRENCY,
      async (rg: ReleaseGroupSearchHit) => {
        const artist =
          rg["artist-credit"]
            ?.map((c) => `${c.name}${c.joinphrase ?? ""}`)
            .join("")
            .trim() ?? "Unknown artist";

        // Run together rather than one after the other — findITunesArtwork
        // is already paced/cached by its own shared queue (see itunes.ts), so
        // this doesn't add to the per-candidate wait.
        const [listeners, itunesArtUrl] = await Promise.all([
          getArtistListeners(artist),
          findITunesArtwork(artist, rg.title),
        ]);

        return {
          mbid: rg.id,
          title: rg.title,
          artist,
          coverArtUrl: itunesArtUrl ?? coverArtArchiveUrl(rg.id),
          releaseDate: rg["first-release-date"]!,
          listeners,
        };
      },
    );

    withListeners.sort((a, b) => b.listeners - a.listeners);

    const albums: HomeAlbum[] = withListeners.map((album) => ({
      mbid: album.mbid,
      title: album.title,
      artist: album.artist,
      coverArtUrl: album.coverArtUrl,
      releaseDate: album.releaseDate,
    }));

    cache = { at: Date.now(), albums };
    return albums;
  } catch (err) {
    // A fresh refresh can fail for reasons that have nothing to do with
    // this row's own data being wrong — MusicBrainz rate-limiting or a
    // transient outage, most commonly. Serving the last successful batch
    // (even past its normal refresh window) beats a hard error for
    // something that updates at most a few times a day; a real error only
    // surfaces if nothing has ever loaded successfully yet.
    if (cache) {
      console.error("new-releases refresh failed, serving stale cache", err);
      return cache.albums;
    }
    throw err;
  }
}

export async function GET(request: NextRequest) {
  const page = Number(request.nextUrl.searchParams.get("page") ?? "0");

  try {
    const candidates = await loadCandidates();
    const start = page * PAGE_SIZE;
    const albums = candidates.slice(start, start + PAGE_SIZE);
    const hasMore = start + PAGE_SIZE < candidates.length;
    return NextResponse.json({ albums, hasMore });
  } catch (err) {
    console.error("new-releases lookup failed", err);
    return NextResponse.json(
      { error: "Failed to load new releases" },
      { status: 502 },
    );
  }
}
