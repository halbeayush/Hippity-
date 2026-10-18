// Singles are left out everywhere albums are listed (search, Recommended);
// albums and EPs are kept. One rule for every source, since only
// MusicBrainz labels release types outright:
// - iTunes titles say so (" - Single" / " - EP");
// - otherwise a release of 1-3 tracks is a single (an A-side plus a
//   B-side or remix or two), unless its title calls it an EP.
const MAX_SINGLE_TRACKS = 3;

const EP_TITLE = /(\s-\s*EP|\(EP\)|\[EP\])$/i;
const SINGLE_TITLE = /(\s-\s*Single|\(Single\)|\[Single\])$/i;

// trackCount is 0 or undefined when the source doesn't say; then only the
// title can mark it as a single, so an album is never dropped for lack of
// data.
export function isSingleRelease(title: string, trackCount?: number): boolean {
  if (EP_TITLE.test(title.trim())) return false;
  if (SINGLE_TITLE.test(title.trim())) return true;
  return trackCount !== undefined && trackCount > 0 && trackCount <= MAX_SINGLE_TRACKS;
}
