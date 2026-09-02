import { NextRequest, NextResponse } from "next/server";
import { fetchMusicBrainz, resolveReleaseGroup } from "@/lib/musicbrainz";

const MUSICBRAINZ_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MusicBrainzRelease = {
  id: string;
  status?: string;
};

type MusicBrainzReleaseListResponse = {
  releases?: MusicBrainzRelease[];
  error?: string;
};

type MusicBrainzTrack = {
  position: number;
  title: string;
  length?: number | null;
  recording?: { title?: string; length?: number | null };
};

type MusicBrainzMedium = {
  tracks?: MusicBrainzTrack[];
};

type MusicBrainzReleaseResponse = {
  media?: MusicBrainzMedium[];
  error?: string;
};

// GET /api/tracklist?mbid=...&artist=...&title=... — look up the tracklist
// for a MusicBrainz release-group. Release-groups don't carry track data
// themselves, so this first finds a release that belongs to the group, then
// fetches that release's recordings.
//
// `mbid` isn't always a real MusicBrainz id — search results now come from
// iTunes (see /api/search), which has no MusicBrainz cross-reference to
// offer, so those are tagged `itunes:<id>` instead. When it doesn't look
// like an actual MusicBrainz UUID, this resolves one by text-searching
// artist+title first — MusicBrainz remains the source for tracklists, just
// resolved lazily here instead of needing to be known up front.
export async function GET(request: NextRequest) {
  const mbidParam = request.nextUrl.searchParams.get("mbid")?.trim();
  const artist = request.nextUrl.searchParams.get("artist")?.trim();
  const title = request.nextUrl.searchParams.get("title")?.trim();

  if (!mbidParam) {
    return NextResponse.json({ error: "mbid is required" }, { status: 400 });
  }

  let releaseGroupId = mbidParam;
  if (!MUSICBRAINZ_UUID_RE.test(mbidParam)) {
    if (!artist || !title) return NextResponse.json({ tracks: [] });
    const resolved = await resolveReleaseGroup(artist, title);
    if (!resolved) return NextResponse.json({ tracks: [] });
    releaseGroupId = resolved.mbid;
  }

  const releaseListUrl = new URL("https://musicbrainz.org/ws/2/release/");
  releaseListUrl.searchParams.set("release-group", releaseGroupId);
  releaseListUrl.searchParams.set("fmt", "json");
  releaseListUrl.searchParams.set("limit", "25");

  const releaseListRes = await fetchMusicBrainz(releaseListUrl);
  const releaseListData: MusicBrainzReleaseListResponse =
    await releaseListRes.json();

  if (!releaseListRes.ok || releaseListData.error) {
    return NextResponse.json(
      { error: releaseListData.error ?? "MusicBrainz lookup failed" },
      { status: 502 },
    );
  }

  const releases = releaseListData.releases ?? [];
  if (releases.length === 0) {
    return NextResponse.json({ tracks: [] });
  }

  // Prefer an "Official" release — bootlegs/promos are less likely to have
  // a clean, representative tracklist.
  const release =
    releases.find((r) => r.status === "Official") ?? releases[0];

  const releaseUrl = new URL(
    `https://musicbrainz.org/ws/2/release/${release.id}`,
  );
  releaseUrl.searchParams.set("inc", "recordings");
  releaseUrl.searchParams.set("fmt", "json");

  const releaseRes = await fetchMusicBrainz(releaseUrl);
  const releaseData: MusicBrainzReleaseResponse = await releaseRes.json();

  if (!releaseRes.ok || releaseData.error) {
    return NextResponse.json(
      { error: releaseData.error ?? "MusicBrainz lookup failed" },
      { status: 502 },
    );
  }

  const tracks = (releaseData.media ?? []).flatMap(
    (medium, mediumIndex) =>
      medium.tracks?.map((track) => ({
        disc: mediumIndex + 1,
        position: track.position,
        title: track.title || track.recording?.title || "Untitled",
        length: track.length ?? track.recording?.length ?? null,
      })) ?? [],
  );

  return NextResponse.json({ tracks });
}
