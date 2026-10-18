// Shared album-search scoring, isomorphic (imported both server-side, by
// /api/search and /api/search/musicbrainz, and client-side, by
// useAlbumSearch when it re-sorts the merged iTunes + MusicBrainz result
// set) so both sources rank consistently against each other rather than
// each just being independently sorted before merging.

export function relevanceScore(
  query: string,
  title: string,
  artist: string,
  trackCount = 0,
): number {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedTitle = title.toLowerCase();
  const normalizedArtist = artist.toLowerCase();
  let score = 0;

  if (normalizedTitle === normalizedQuery) score += 200;
  else if (normalizedTitle.startsWith(normalizedQuery)) score += 100;
  else if (normalizedTitle.includes(normalizedQuery)) score += 50;

  // Searching an artist's name should surface their own albums — without
  // this, every "Song (feat. <Artist>) - Single" title-matched the query and
  // outranked the artist's actual discography.
  if (normalizedArtist === normalizedQuery) score += 150;
  else if (normalizedArtist.startsWith(normalizedQuery)) score += 75;

  // A query combining title + artist (e.g. "Currents Tame Impala", the
  // natural way to disambiguate a common album title) won't substring-
  // match either field alone — this rewards how many of the query's words
  // show up across title+artist together, so that case still favors the
  // right release.
  const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);
  const haystack = `${normalizedTitle} ${normalizedArtist}`;
  const matchedWords = queryWords.filter((word) => haystack.includes(word)).length;
  score += matchedWords * 20;

  // iTunes' own relevance ranking (and, to a lesser extent, MusicBrainz's)
  // otherwise puts a same-titled single ahead of the real album —
  // trackCount is a reasonable proxy for "this is a real album, not a
  // single". MusicBrainz results don't carry this signal (trackCount
  // defaults to 0), which is fine: it's a tiebreaker, not the primary score.
  score += Math.min(trackCount, 12);
  return score;
}

// An album title with store/edition suffixes stripped — "good kid, m.A.A.d
// city (Deluxe Version)" -> "good kid, m.A.A.d city", "Not Like Us -
// Single" -> "Not Like Us", "The Death of Slim Shady (Coup De Grâce):
// Expanded Mourner's Edition" -> "The Death of Slim Shady (Coup De Grâce)",
// "DAMN. COLLECTORS EDITION." -> "DAMN.". Every bracketed edition tag goes,
// wherever it sits: "Thriller (25th Anniversary) [Deluxe Edition]" ->
// "Thriller", "1962–1966 (2023 Edition) [The Red Album]" -> "1962–1966 [The
// Red Album]".
export function baseAlbumTitle(title: string): string {
  return (
    title
      .replace(/\s+-\s+(Single|EP)$/i, "")
      // Bracketed edition tags first, so "Curtain Call: The Hits (Deluxe
      // Edition)" isn't mistaken for a ": ... Edition" suffix below.
      .replace(BRACKETED, (tag, inside: string) =>
        EDITION_TAG.test(inside) && !NOT_AN_EDITION.test(inside) ? "" : tag,
      )
      .replace(/\s*:\s*[^:]*\bedition\b[^:]*$/i, "")
      .replace(
        /\s+(collector'?s|deluxe|expanded|special|anniversary)\s+edition\.?$/i,
        "",
      )
      .trim() || title
  );
}

const BRACKETED = /\s*[([]([^)\]]*)[)\]]/g;
// "(2019 Mix)" is Abbey Road's remixed edition; a named remix ("(Steve Aoki
// Remix)") is a different release, so only a year + mix counts. A tag
// starting with "+" lists extras ("(+ A Message from Taylor)").
const EDITION_TAG =
  /deluxe|edition|version|remaster|expanded|anniversary|bonus|explicit|clean|special|\b\d{4} (re)?mix\b|^\s*\+/i;
// Re-recordings are albums of their own, not editions of the original.
const NOT_AN_EDITION = /taylor['’]?s version/i;

// Filler words a query can include without the album containing them
// ("a good kid maad city", "the dark side of the moon").
const STOPWORDS = new Set(["a", "an", "the", "and", "of", "&"]);

// Lowercased whole words with punctuation and accents dropped, so "m.A.A.d"
// -> "maad", "kid," -> "kid" and "Beyoncé" -> "beyonce" — how people
// actually type album titles.
function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
}

// Fraction (0-1) of the query's words that appear as whole words in the
// album's title + artist. Whole words, not substrings, so a short word
// like "i" doesn't count as matching every title containing the letter.
export function queryCoverage(query: string, title: string, artist: string): number {
  const queryWords = words(query).filter((w) => !STOPWORDS.has(w));
  if (queryWords.length === 0) return 0;
  const albumWords = new Set([...words(title), ...words(artist)]);
  return queryWords.filter((w) => albumWords.has(w)).length / queryWords.length;
}

type RankableResult = {
  title: string;
  artist: string;
  trackCount?: number;
  playcount?: number;
};

// The order search results are shown in: first by how much of the query
// the album actually matches (queryCoverage), then most-played first
// (Last.fm play count, attached server-side — see getAlbumPlaycount in
// lastfm.ts), then relevanceScore as the final tiebreaker. Match comes
// before plays because iTunes also returns loosely related popular albums
// for a query — searching "good kid maad city" brought back DAMN. and SZA's
// SOS, which outranked the album itself on plays alone. Among equally good
// matches (every album titled "Currents", or every album by the artist
// searched for), the most-played one wins.
export function compareSearchResults(query: string) {
  return (a: RankableResult, b: RankableResult): number =>
    queryCoverage(query, b.title, b.artist) -
      queryCoverage(query, a.title, a.artist) ||
    (b.playcount ?? 0) - (a.playcount ?? 0) ||
    relevanceScore(query, b.title, b.artist, b.trackCount) -
      relevanceScore(query, a.title, a.artist, a.trackCount);
}

// Sorts results (see compareSearchResults) and collapses variants of the
// same album down to its best-ranked copy. Last.fm keeps every spelling
// people have scrobbled an album under as its own entry — "good kid,
// m.A.A.d city", "good kid, mAAd city", "good kid maad city (Deluxe)" — and
// iTunes lists standard and deluxe editions separately, so without this one
// search could show the same album five times. Variants match on artist +
// edition-stripped title, compared word-for-word without punctuation.
// A title's words without "the" — "Slim Shady LP" and "The Slim Shady LP",
// or "(White Album)" and "(The White Album)", are the same album — and
// without "and", since "&" is already dropped ("Simon & Garfunkel" vs
// "Simon and Garfunkel"). A name that's nothing but those ("The The")
// keeps them.
function titleWords(title: string): string[] {
  const all = words(title);
  const w = all.filter((word) => word !== "the" && word !== "and");
  return w.length > 0 ? w : all;
}

// The same for artist credits, so "The Beatles", "Beatles" and "Beatles,
// The" are one artist.
export function creditKey(artist: string): string {
  return titleWords(artist).join(" ");
}

export function titleKey(title: string): string {
  return titleWords(baseAlbumTitle(title)).join(" ");
}

export function albumVariantKey(artist: string, title: string): string {
  return `${creditKey(artist)}::${titleKey(title)}`;
}

export function rankSearchResults<T extends RankableResult>(
  results: T[],
  query: string,
): T[] {
  const seen = new Set<string>();
  return [...results].sort(compareSearchResults(query)).filter((r) => {
    const key = albumVariantKey(r.artist, r.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// When a search names an artist ("eminem", "eminem recovery"), results
// claiming to be that artist's are limited to their official streaming
// catalog — the albums on their Apple Music artist page (see
// getArtistCatalog in itunes.ts). Without this, MusicBrainz bootlegs and
// Last.fm fan uploads credited to the artist, plus karaoke/tribute albums
// with the artist's name in the title, took spots from their real albums.
export type ArtistFilter = {
  artist: string;
  // How the artist's official releases are credited — usually just their
  // name, plus any collaborations on their own artist page ("Blonde &
  // Craig David"). Normalized with creditKey.
  officialCredits: string[];
  // The official releases' titles, normalized with titleKey.
  officialTitles: string[];
  // The query is just the artist's name — so only their own albums are
  // wanted, not other artists' albums that happen to mention them.
  artistOnly: boolean;
};

function contentWords(text: string): string[] {
  return words(text).filter((w) => !STOPWORDS.has(w));
}

// The artist a query names, picked from the artists of a set of search
// results: one whose whole name appears in the query ("kendrick lamar
// damn" names Kendrick Lamar; "Mini Eminem" isn't named by "eminem"). The
// longest such name wins, then the one with the most results. Null when
// the query doesn't name any of them.
export function findQueriedArtist<T extends { artist: string }>(
  query: string,
  results: T[],
): T | null {
  const queryWords = new Set(contentWords(query));
  let best: { result: T; nameLength: number; count: number } | null = null;
  const counts = new Map<string, number>();
  for (const r of results) {
    const key = words(r.artist).join(" ");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const r of results) {
    const nameWords = contentWords(r.artist);
    if (nameWords.length === 0 || !nameWords.every((w) => queryWords.has(w))) {
      continue;
    }
    const count = counts.get(words(r.artist).join(" ")) ?? 0;
    if (
      !best ||
      nameWords.length > best.nameLength ||
      (nameWords.length === best.nameLength && count > best.count)
    ) {
      best = { result: r, nameLength: nameWords.length, count };
    }
  }
  return best?.result ?? null;
}

// Whether the query is nothing but the artist's name.
export function isArtistOnlyQuery(query: string, artist: string): boolean {
  const nameWords = new Set(contentWords(artist));
  const queryWords = contentWords(query);
  return queryWords.length > 0 && queryWords.every((w) => nameWords.has(w));
}

// Applies ArtistFilters. A result credited to a filtered artist must be
// credited exactly as their official releases are, and be in their
// official catalog. Any credit containing their name counts as claiming to
// be them, so "Eminem Ft. Rihanna", "LAMAR, Kendrick" and "Mini Eminem"
// uploads are dropped even when the title is a real album's — the real
// release is in the catalog under the artist's actual name. For an
// artist-only query, other artists' results are dropped too — except an
// album titled exactly the query that's more played than anything of the
// artist's own: searching "currents" still finds Tame Impala's Currents
// (196M plays) over the band Currents (8M at most), while an album some
// other artist titled "Eminem" doesn't make it into a search for Eminem.
export function applyArtistFilter<
  T extends { artist: string; title: string; playcount?: number },
>(results: T[], filters: ArtistFilter[], query: string): T[] {
  if (filters.length === 0) return results;
  const prepared = filters.map((f) => {
    const nameWords = contentWords(f.artist);
    const credits = new Set(f.officialCredits);
    const titles = new Set(f.officialTitles);
    const claims = (r: T) => {
      const creditWords = new Set(contentWords(r.artist));
      return nameWords.every((w) => creditWords.has(w));
    };
    const isOfficial = (r: T) =>
      credits.has(creditKey(r.artist)) && titles.has(titleKey(r.title));
    const topOfficialPlays = Math.max(
      0,
      ...results.filter((r) => claims(r) && isOfficial(r)).map((r) => r.playcount ?? 0),
    );
    return { claims, isOfficial, topOfficialPlays, artistOnly: f.artistOnly };
  });
  const queryKey = titleWords(query).join(" ");
  return results.filter((r) =>
    prepared.every((f) => {
      if (f.claims(r)) return f.isOfficial(r);
      if (!f.artistOnly) return true;
      return titleKey(r.title) === queryKey && (r.playcount ?? 0) > f.topOfficialPlays;
    }),
  );
}

// Dedupe key for merging iTunes + MusicBrainz results that describe the
// same release — matches on normalized artist + title, per the fix's own
// wording, rather than anything fuzzier (edition/remaster suffixes, etc.)
// that could hide two actually-different releases from each other.
export function dedupeKey(artist: string, title: string): string {
  return `${artist.trim().toLowerCase()}::${title.trim().toLowerCase()}`;
}
