import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

// Cover Art Archive (and the Internet Archive mirrors it redirects to) can
// be slow to respond and is occasionally briefly down, which every album
// cover in this app was directly exposed to on every single page load. This
// proxies and permanently caches each image on disk the first time it's
// requested, so every request after that — reloading a page, the same
// album appearing in the Library grid and a search result, revisiting
// tomorrow — is served instantly from our own origin instead of Internet
// Archive or Apple's CDN. Only ever constructed by coverArtArchiveUrl
// (musicbrainz.ts) or itunesArtworkProxyUrl (itunes.ts), so the host
// allowlist below only needs to cover those two cases.
const ALLOWED_HOSTS = new Set(["coverartarchive.org"]);
// iTunes artwork is served from several numbered CDN nodes
// (is1-ssl.mzstatic.com, is2-ssl.mzstatic.com, ...), not one fixed host.
const ALLOWED_HOST_SUFFIXES = [".mzstatic.com"];

function isAllowedHost(hostname: string): boolean {
  return (
    ALLOWED_HOSTS.has(hostname) ||
    ALLOWED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  );
}
const CACHE_DIR = path.join(process.cwd(), ".cache", "cover-art");
const USER_AGENT = "Spinsheet/0.1.0 ( halbeayush2@gmail.com )";
const MAX_REDIRECTS = 5;

// How long the current page request is willing to wait for a never-before-
// cached image before giving up and letting the frontend fall back to its
// placeholder. Internet Archive is sometimes just slow rather than failing
// outright, and with no timeout at all a single image could previously
// block for 20-30+ seconds — this caps that to one bounded attempt.
const FOREGROUND_TIMEOUT_MS = 5000;
// The background warmer (below) gets more patience across more attempts,
// since it isn't making anyone wait.
const BACKGROUND_TIMEOUT_MS = 8000;
const BACKGROUND_ATTEMPTS = 3;

function cacheKeyFor(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

function cachePaths(src: string) {
  const key = cacheKeyFor(src);
  return {
    dataPath: path.join(CACHE_DIR, `${key}.bin`),
    metaPath: path.join(CACHE_DIR, `${key}.json`),
  };
}

async function readFromCache(src: string): Promise<{
  data: Buffer;
  contentType: string;
} | null> {
  const { dataPath, metaPath } = cachePaths(src);
  try {
    const [data, metaRaw] = await Promise.all([
      readFile(dataPath),
      readFile(metaPath, "utf-8"),
    ]);
    const meta: { contentType: string } = JSON.parse(metaRaw);
    return { data, contentType: meta.contentType };
  } catch {
    return null;
  }
}

async function writeToCache(
  src: string,
  data: Buffer,
  contentType: string,
): Promise<void> {
  const { dataPath, metaPath } = cachePaths(src);
  await mkdir(CACHE_DIR, { recursive: true });
  await Promise.all([
    writeFile(dataPath, data),
    writeFile(metaPath, JSON.stringify({ contentType })),
  ]);
}

// Cover Art Archive's redirect chain (itself -> archive.org -> a specific
// regional mirror, e.g. dn720706.ca.archive.org or ia601506.us.archive.org)
// is flaky enough — in testing, the exact same URL failed outright, then
// succeeded on retry, landing on a different mirror host each time — that
// fetch()'s automatic `redirect: "follow"` intermittently surfaces a bad
// hop as an outright request failure. Chasing redirects manually, one hop
// at a time, made that reproducibly reliable in the same testing. The whole
// chain shares one timeout budget rather than per-hop, so a slow multi-hop
// chain can't silently add up to far more than the caller asked for.
async function fetchFollowingRedirects(
  url: string,
  signal: AbortSignal,
  hops = 0,
): Promise<Response> {
  if (hops > MAX_REDIRECTS) {
    throw new Error("Too many redirects");
  }

  const response = await fetch(url, {
    redirect: "manual",
    headers: { "User-Agent": USER_AGENT },
    signal,
  });

  const location = response.headers.get("location");
  if (response.status >= 300 && response.status < 400 && location) {
    return fetchFollowingRedirects(
      new URL(location, url).toString(),
      signal,
      hops + 1,
    );
  }

  return response;
}

async function fetchUrlOnce(
  url: string,
  timeoutMs: number,
): Promise<{ data: Buffer; contentType: string } | null> {
  try {
    const response = await fetchFollowingRedirects(
      url,
      AbortSignal.timeout(timeoutMs),
    );
    if (!response.ok) return null;

    return {
      data: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "image/jpeg",
    };
  } catch {
    return null;
  }
}

// iTunes' CDN reliably honors arbitrary requested sizes in practice, but
// isn't guaranteed to for every release — if the upgraded 600x600 request
// this app makes (see upgradeArtworkUrl in itunes.ts) fails, this retries
// the original 100x100 size before giving up, so a rare miss degrades to a
// smaller image instead of the empty-cover placeholder. Whichever size
// actually succeeds is what gets cached, under the originally requested URL.
function downgradedArtworkUrl(src: string): string | null {
  if (!src.includes(".mzstatic.com") || !src.includes("/600x600bb.")) {
    return null;
  }
  return src.replace("/600x600bb.", "/100x100bb.");
}

async function fetchOnce(
  src: string,
  timeoutMs: number,
): Promise<{ data: Buffer; contentType: string } | null> {
  const primary = await fetchUrlOnce(src, timeoutMs);
  if (primary) return primary;

  const downgraded = downgradedArtworkUrl(src);
  return downgraded ? fetchUrlOnce(downgraded, timeoutMs) : null;
}

// Tracks URLs currently being retried in the background so a burst of
// requests for the same not-yet-cached image (e.g. the same cover shown in
// both the Library grid and the floating background) only triggers one
// warm-up instead of one per request.
const warming = new Set<string>();

function warmCacheInBackground(src: string): void {
  if (warming.has(src)) return;
  warming.add(src);

  (async () => {
    for (let attempt = 0; attempt < BACKGROUND_ATTEMPTS; attempt++) {
      const result = await fetchOnce(src, BACKGROUND_TIMEOUT_MS);
      if (result) {
        await writeToCache(src, result.data, result.contentType);
        break;
      }
      if (attempt < BACKGROUND_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    warming.delete(src);
  })().catch(() => {
    warming.delete(src);
  });
}

export async function GET(request: NextRequest) {
  const src = request.nextUrl.searchParams.get("src");
  if (!src) {
    return NextResponse.json({ error: "src is required" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(src);
  } catch {
    return NextResponse.json({ error: "src must be a URL" }, { status: 400 });
  }

  if (!isAllowedHost(parsed.hostname)) {
    return NextResponse.json({ error: "src host not allowed" }, { status: 400 });
  }

  const cached = await readFromCache(src);
  if (cached) {
    return new NextResponse(new Uint8Array(cached.data), {
      headers: {
        "Content-Type": cached.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  const result = await fetchOnce(src, FOREGROUND_TIMEOUT_MS);

  if (!result) {
    // The single bounded attempt above didn't pan out — rather than making
    // this page load wait through more retries, respond now so the
    // frontend can fall back to its placeholder, and keep trying in the
    // background so a later request (a reload, a revisit) has a good
    // chance of finding it cached instead of repeating this same wait.
    warmCacheInBackground(src);
    return NextResponse.json({ error: "Cover art not found" }, { status: 404 });
  }

  await writeToCache(src, result.data, result.contentType);

  return new NextResponse(new Uint8Array(result.data), {
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
