// Runs once when the server starts (see Next.js instrumentation docs). The
// New releases and Upcoming rows are scraped from MusicBrainz/Last.fm on a
// cache miss, which takes several seconds — this fires that first scrape
// right at startup so the first visit gets the already-cached result
// instead of waiting on it. (Recommended isn't warmed: it's per-user, and
// this has no one signed in.)
//
// It requests the routes over HTTP rather than importing them: each route's
// cache lives in that route's own module instance, so a request is the only
// way to warm the cache the route will actually read from. register() has
// to finish before the server accepts requests, so the requests are only
// scheduled here, not awaited.
const WARM_PATHS = [
  "/api/home/new-releases?page=0",
  "/api/home/upcoming?page=0",
  "/api/home/music-news",
];
const WARM_DELAY_MS = 1000;

export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // On Vercel there's no long-running server on localhost to request, and
  // each function instance has its own short-lived cache anyway.
  if (process.env.VERCEL) return;

  const origin = `http://localhost:${process.env.PORT ?? 3000}`;
  setTimeout(() => {
    for (const path of WARM_PATHS) {
      fetch(`${origin}${path}`).catch(() => {
        // Best effort — a failed warm-up just means the first real visit
        // does the scrape itself, as it would without this.
      });
    }
  }, WARM_DELAY_MS);
}
