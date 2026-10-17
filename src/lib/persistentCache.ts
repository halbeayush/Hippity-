import { mkdir, readFile, writeFile } from "fs/promises";
import os from "os";
import path from "path";

// Keeps a route's last good result on disk (next to the cover-art cache),
// so a server restart serves it straight away and refreshes in the
// background — instead of the first visit after every restart waiting on a
// full scrape, or getting nothing if that scrape is rate-limited. Read and
// write failures are swallowed: this only ever makes a cold start faster,
// never a reason for a request to fail.
//
// On Vercel the deployment's own directory is read-only and only /tmp is
// writable, so the caches live there instead — per server instance and
// cleared whenever an instance is recycled, so they only help while an
// instance stays warm.
export const CACHE_ROOT = process.env.VERCEL
  ? path.join(os.tmpdir(), "spinsheet-cache")
  : path.join(process.cwd(), ".cache");
const CACHE_DIR = path.join(CACHE_ROOT, "routes");

export type Persisted<T> = { at: number; value: T };

export async function readPersisted<T>(name: string): Promise<Persisted<T> | null> {
  try {
    return JSON.parse(await readFile(path.join(CACHE_DIR, `${name}.json`), "utf-8"));
  } catch {
    return null;
  }
}

export async function writePersisted<T>(name: string, value: T): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const entry: Persisted<T> = { at: Date.now(), value };
    await writeFile(path.join(CACHE_DIR, `${name}.json`), JSON.stringify(entry));
  } catch {
    // See above — best effort.
  }
}

// For the home rows' successful responses, which are the same for every
// visitor. On Vercel each serverless instance has its own in-memory and
// /tmp cache, so a request landing on a fresh instance would otherwise wait
// through a full several-second scrape. With this, Vercel's CDN keeps one
// copy for everyone for 45 minutes (matching the routes' own refresh
// window), then keeps serving it while refreshing in the background.
// Browsers don't cache it (max-age=0), so a reload still gets the CDN's copy.
export const SHARED_ROW_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=0, s-maxage=2700, stale-while-revalidate=86400",
};
