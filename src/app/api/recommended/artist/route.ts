import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId, withSignIn } from "@/lib/currentUser";
import {
  findITunesArtistId,
  getArtistCatalog,
  isSingle,
  isSingleOrEp,
  itunesArtworkProxyUrl,
  lazyArtworkUrl,
  oneEditionPerAlbum,
  type ITunesAlbum,
} from "@/lib/itunes";
import { attachPlaycounts } from "@/lib/lastfm";
import {
  coverArtArchiveSrc,
  findArtistEps,
  findArtistStudioAlbums,
  findFeaturedEps,
} from "@/lib/musicbrainz";
import {
  getCachedRecommendations,
  getSavedMbids,
  preferFresh,
  savedAlbumKey,
} from "@/lib/recommendations";
import type { AlbumSummary } from "@/lib/types";

const POOL_SIZE = 18;
// A "Refresh" fetches a wider raw hit list per tier so there's a real pool
// of fresh candidates to draw from, instead of re-ranking the same 18.
const FETCH_LIMIT_REFRESH = 36;

// GET /api/recommended/artist?artist=...[&exclude=mbid,mbid,...] — surfaces
// the chosen artist's own catalog, not already in the library/to-do list,
// in three tiers: their own albums first, then their own EPs, then
// other artists' EPs where this artist appears as a featured guest.
// Lower tiers only fill in once the higher tier runs out. Singles are left
// out entirely (see releaseType.ts).
export const GET = withSignIn(async (request: NextRequest) => {
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

  // Outside the try, so a signed-out request gets withSignIn's 401 rather
  // than this route's 502.
  const userId = await getCurrentUserId();

  try {
    const albums = await getCachedRecommendations(
      `artist:${userId}:${artist.toLowerCase()}`,
      async () => {
        const savedMbids = await getSavedMbids(userId);
        const ranked =
          (await officialCatalogTiers(
            artist,
            savedMbids,
            POOL_SIZE + excludeMbids.size,
          )) ??
          (await musicBrainzTiers(
            artist,
            isRefresh ? FETCH_LIMIT_REFRESH : POOL_SIZE,
            savedMbids,
          ));
        return preferFresh(ranked, (a) => a.mbid, POOL_SIZE, excludeMbids);
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
});

// The three tiers, from the artist's official streaming catalog — their
// Apple Music artist page (see getArtistCatalog). This used to come from
// MusicBrainz text searches on the artist's name, which return everything
// MusicBrainz has credited to them: for Eminem, bootlegs and fan compilations
// like "Unreleased & Uncensored" and "The King Is Back" outnumbered his real
// albums. Within each tier, most-played first (Last.fm play counts). Stops
// once it has `needed` albums, so a lower tier nobody will see doesn't cost
// a play-count lookup per release. Null when iTunes doesn't know the
// artist, so the caller can fall back.
async function officialCatalogTiers(
  artist: string,
  savedMbids: Set<string>,
  needed: number,
): Promise<AlbumSummary[] | null> {
  const artistId = await findITunesArtistId(artist);
  if (!artistId) return null;
  const catalog = await getArtistCatalog(artistId, { includeFeatures: true });
  if (catalog.length === 0) return null;

  const own = catalog.filter((a) => a.artistId === artistId);
  const tiers = [
    own.filter((a) => !isSingleOrEp(a)),
    own.filter((a) => isSingleOrEp(a) && !isSingle(a)),
    // Only others' EPs — not full albums where they guest on one
    // track.
    catalog.filter(
      (a) => a.artistId !== artistId && isSingleOrEp(a) && !isSingle(a),
    ),
  ];

  const ranked: AlbumSummary[] = [];
  for (const tier of tiers) {
    if (ranked.length >= needed) break;
    const unsaved = oneEditionPerAlbum(tier).filter(
      (a) =>
        !savedMbids.has(`itunes:${a.collectionId}`) &&
        !savedMbids.has(savedAlbumKey(a.artist, a.title)),
    );
    const withPlays = await attachPlaycounts(unsaved.map(toAlbumSummary));
    ranked.push(...withPlays.sort((a, b) => b.playcount - a.playcount));
  }
  return ranked;
}

// Same id/artwork scheme as search results (see /api/search).
function toAlbumSummary(album: ITunesAlbum): AlbumSummary {
  return {
    mbid: `itunes:${album.collectionId}`,
    title: album.title,
    artist: album.artist,
    coverArtUrl: album.artworkUrl100
      ? itunesArtworkProxyUrl(album.artworkUrl100)
      : null,
  };
}

// The same three tiers from MusicBrainz, for artists iTunes doesn't carry.
async function musicBrainzTiers(
  artist: string,
  fetchLimit: number,
  savedMbids: Set<string>,
): Promise<AlbumSummary[]> {
  const [studioAlbums, ownEps, featuredEps] = await Promise.all([
    findArtistStudioAlbums(artist, fetchLimit),
    findArtistEps(artist, fetchLimit),
    findFeaturedEps(artist, fetchLimit),
  ]);

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
        coverArtUrl: lazyArtworkUrl(
          artistLabel(hit),
          hit.title,
          coverArtArchiveSrc(hit.id),
        ),
      });
    }
  }

  addAll(studioAlbums, () => artist);
  addAll(ownEps, () => artist);
  addAll(featuredEps, (hit) => hit.leadArtist ?? artist);
  return ranked;
}
