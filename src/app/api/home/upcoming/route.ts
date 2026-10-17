import { NextRequest, NextResponse } from "next/server";
import { mapWithConcurrency } from "@/lib/concurrency";
import { lazyArtworkUrl } from "@/lib/itunes";
import { getArtistListeners } from "@/lib/lastfm";
import {
  coverArtArchiveSrc,
  fetchMusicBrainz,
  getArtistMostRecentAlbumArt,
  searchReleaseGroupsInDateWindow,
  type ReleaseGroupSearchHit,
} from "@/lib/musicbrainz";
import { PRIORITY_BACKGROUND } from "@/lib/pacedQueue";
import { readPersisted, writePersisted } from "@/lib/persistentCache";
import type { HomeAlbum } from "@/lib/types";

const PAGE_SIZE = 5;
const MIN_REQUIRED = 5;
const TARGET_POOL_SIZE = 15;
const UPCOMING_WINDOW_DAYS = 90;
// If the normal window doesn't turn up MIN_REQUIRED candidates, the window
// widens once and searches again — "loosen the date window" per the fix,
// not an unbounded search.
const WIDENED_WINDOW_DAYS = 150;
const SEARCH_MAX_PAGES = 6;
const WIDENED_SEARCH_MAX_PAGES = 4;
// Governs the one merged per-candidate pass below (MusicBrainz language +
// Last.fm listeners/fallback art, fired together). The MusicBrainz half is
// paced to its ~1 req/sec limit by fetchMusicBrainz's shared queue no
// matter how many are in flight — this just keeps the Last.fm half (no
// strict limit) from waiting behind it one candidate at a time.
const CANDIDATE_LOOKUP_CONCURRENCY = 6;
// Repeat visits (and other users, in a multi-user deployment) hit this
// cache instead of re-scraping MusicBrainz/Last.fm.
const CACHE_TTL_MS = 45 * 60 * 1000;

// English first, Spanish next; every other language (including releases we
// couldn't determine a language for) is grouped after, in whatever order
// the rest of the sort produces.
const LANGUAGE_PRIORITY: Record<string, number> = { eng: 0, spa: 1 };
const OTHER_LANGUAGE_PRIORITY = 2;

function languagePriority(code: string | null): number {
  if (!code) return OTHER_LANGUAGE_PRIORITY;
  return LANGUAGE_PRIORITY[code] ?? OTHER_LANGUAGE_PRIORITY;
}

type MusicBrainzReleaseLookup = {
  "text-representation"?: { language?: string | null };
};

// Release-group search results don't carry a language, but they do embed a
// handful of the release-group's actual releases — each release does have
// one (an ISO 639-3 code, e.g. "eng", "spa") via a plain release lookup, no
// `inc` needed.
async function getReleaseLanguage(
  rg: ReleaseGroupSearchHit,
): Promise<string | null> {
  const release =
    rg.releases?.find((r) => r.status === "Official") ?? rg.releases?.[0];
  if (!release) return null;

  try {
    const url = new URL(`https://musicbrainz.org/ws/2/release/${release.id}`);
    url.searchParams.set("fmt", "json");
    const response = await fetchMusicBrainz(url, {
      priority: PRIORITY_BACKGROUND,
    });
    const data: MusicBrainzReleaseLookup = await response.json();
    return data["text-representation"]?.language ?? null;
  } catch {
    return null;
  }
}

type RankedHomeAlbum = HomeAlbum & {
  listeners: number;
  languagePriority: number;
};

// Sort priority: language group first (English, then Spanish, then
// everything else — see LANGUAGE_PRIORITY), then within a language group,
// Last.fm listener count (the stand-in for Spotify's now-removed
// popularity score — see new-releases/route.ts), then soonest-releasing as
// the final tiebreaker.
let cache: { at: number; albums: HomeAlbum[] } | null = null;

// Reused across a whole cache refresh so an artist with multiple upcoming
// albums is only looked up once.
const artistInfoCache = new Map<
  string,
  { listeners: number; fallbackArtUrl: string | null }
>();

async function lookupArtistInfo(name: string) {
  const key = name.toLowerCase();
  const cached = artistInfoCache.get(key);
  if (cached) return cached;

  const listeners = await getArtistListeners(name);
  const fallbackArtUrl = await getArtistMostRecentAlbumArt(name).catch(
    () => null,
  );

  const info = { listeners, fallbackArtUrl };
  artistInfoCache.set(key, info);
  return info;
}

function windowFor(days: number) {
  const today = new Date();
  const until = new Date(today);
  until.setDate(until.getDate() + days);
  const format = (d: Date) => d.toISOString().slice(0, 10);
  return { todayStr: format(today), untilStr: format(until) };
}

// Requests that arrive while a refresh is already running (page 0 and a
// quick "next page" click, StrictMode's double effect in dev, a reload) wait
// on that same refresh instead of each kicking off their own full scrape.
let inFlight: Promise<HomeAlbum[]> | null = null;

// The last good batch, saved to disk so a server restart can serve it
// straight away (stale is fine — it refreshes in the background, below)
// instead of the first visit waiting on a full scrape. See persistentCache.ts.
const PERSIST_NAME = "home-upcoming";
let restoring: Promise<void> | null = null;

async function loadCandidates(): Promise<HomeAlbum[]> {
  restoring ??= readPersisted<HomeAlbum[]>(PERSIST_NAME).then((saved) => {
    if (saved && !cache) cache = { at: saved.at, albums: saved.value };
  });
  await restoring;

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return Promise.resolve(cache.albums);
  }
  inFlight ??= refreshCandidates().finally(() => {
    inFlight = null;
  });
  // Past its refresh window, the last batch is still served immediately
  // while the refresh above runs in the background — otherwise whoever
  // visits first after it expires waits through a full ~7s scrape. Only
  // the very first load (nothing cached yet) waits on the scrape itself.
  if (cache) {
    inFlight.catch(() => {});
    return Promise.resolve(cache.albums);
  }
  return inFlight;
}

async function refreshCandidates(): Promise<HomeAlbum[]> {
  try {
    const { todayStr, untilStr } = windowFor(UPCOMING_WINDOW_DAYS);
    let releaseGroups = await searchReleaseGroupsInDateWindow(todayStr, untilStr, {
      targetCount: TARGET_POOL_SIZE,
      maxPages: SEARCH_MAX_PAGES,
    });

    if (releaseGroups.length < MIN_REQUIRED) {
      const widened = windowFor(WIDENED_WINDOW_DAYS);
      const more = await searchReleaseGroupsInDateWindow(
        todayStr,
        widened.untilStr,
        { targetCount: TARGET_POOL_SIZE, maxPages: WIDENED_SEARCH_MAX_PAGES },
      );
      const seen = new Set(releaseGroups.map((rg) => rg.id));
      releaseGroups = [
        ...releaseGroups,
        ...more.filter((rg) => !seen.has(rg.id)),
      ];
    }

    // These lookups per candidate — MusicBrainz (language), Last.fm
    // (listener count + fallback art) — are independent of each other, so
    // they run together in one Promise.all rather than as separate
    // sequential passes over the whole candidate list. Primary artwork
    // (iTunes) isn't looked up here at all: waiting on it for every
    // candidate through iTunes' ~3s-apart queue is what used to make this
    // row take minutes. See lazyArtworkUrl in itunes.ts.
    const ranked: RankedHomeAlbum[] = await mapWithConcurrency(
      releaseGroups,
      CANDIDATE_LOOKUP_CONCURRENCY,
      async (rg) => {
        const artist =
          rg["artist-credit"]
            ?.map((c) => `${c.name}${c.joinphrase ?? ""}`)
            .join("")
            .trim() ?? "Unknown artist";

        const [language, { listeners, fallbackArtUrl }] = await Promise.all([
          getReleaseLanguage(rg),
          lookupArtistInfo(artist),
        ]);

        return {
          mbid: rg.id,
          title: rg.title,
          artist,
          // Resolved per image when the browser requests it, not here —
          // see lazyArtworkUrl in itunes.ts.
          coverArtUrl: lazyArtworkUrl(artist, rg.title, coverArtArchiveSrc(rg.id)),
          fallbackArtUrl,
          releaseDate: rg["first-release-date"]!,
          listeners,
          languagePriority: languagePriority(language),
        };
      },
    );

    ranked.sort((a, b) => {
      if (a.languagePriority !== b.languagePriority) {
        return a.languagePriority - b.languagePriority;
      }
      if (a.listeners !== b.listeners) return b.listeners - a.listeners;
      return a.releaseDate < b.releaseDate ? -1 : 1;
    });

    const albums: HomeAlbum[] = ranked.map((album) => ({
      mbid: album.mbid,
      title: album.title,
      artist: album.artist,
      coverArtUrl: album.coverArtUrl,
      fallbackArtUrl: album.fallbackArtUrl,
      releaseDate: album.releaseDate,
    }));
    cache = { at: Date.now(), albums };
    void writePersisted(PERSIST_NAME, albums);
    return albums;
  } catch (err) {
    // A fresh refresh can fail for reasons that have nothing to do with
    // this row's own data being wrong — MusicBrainz rate-limiting or a
    // transient outage, most commonly. Serving the last successful batch
    // (even past its normal refresh window) beats a hard error for
    // something that updates at most a few times a day; a real error only
    // surfaces if nothing has ever loaded successfully yet.
    if (cache) {
      console.error("upcoming refresh failed, serving stale cache", err);
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
    console.error("upcoming lookup failed", err);
    return NextResponse.json(
      { error: "Failed to load upcoming albums" },
      { status: 502 },
    );
  }
}
