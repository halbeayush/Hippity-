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

// Dedupe key for merging iTunes + MusicBrainz results that describe the
// same release — matches on normalized artist + title, per the fix's own
// wording, rather than anything fuzzier (edition/remaster suffixes, etc.)
// that could hide two actually-different releases from each other.
export function dedupeKey(artist: string, title: string): string {
  return `${artist.trim().toLowerCase()}::${title.trim().toLowerCase()}`;
}
