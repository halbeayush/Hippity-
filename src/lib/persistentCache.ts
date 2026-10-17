import { after } from "next/server";
import os from "os";
import path from "path";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./prisma";

// Where the cover-art route keeps its image cache. On Vercel the
// deployment's own directory is read-only and only /tmp is writable — per
// server instance and cleared whenever an instance is recycled.
export const CACHE_ROOT = process.env.VERCEL
  ? path.join(os.tmpdir(), "spinsheet-cache")
  : path.join(process.cwd(), ".cache");

export type Persisted<T> = { at: number; value: T };

// A route's last good result, kept in Postgres (the CacheEntry table) so
// every serverless instance — including the first one after a deploy —
// can serve it straight away instead of the first visitor waiting on a full
// scrape. Read and write failures are swallowed: this only ever makes a
// cold start faster, never a reason for a request to fail.
export async function readPersisted<T>(name: string): Promise<Persisted<T> | null> {
  try {
    const row = await prisma.cacheEntry.findUnique({ where: { key: name } });
    return row ? { at: row.updatedAt.getTime(), value: row.value as T } : null;
  } catch (err) {
    console.error(`cache read failed: ${name}`, err);
    return null;
  }
}

export async function writePersisted<T>(name: string, value: T): Promise<void> {
  try {
    const json = value as Prisma.InputJsonValue;
    const updatedAt = new Date();
    await prisma.cacheEntry.upsert({
      where: { key: name },
      create: { key: name, value: json, updatedAt },
      update: { value: json, updatedAt },
    });
  } catch (err) {
    console.error(`cache write failed: ${name}`, err);
  }
}

// After a failed refresh, wait this long before trying again, so a
// rate-limited MusicBrainz isn't hit again by every request in between.
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

// "Serve stale, refresh in the background" for a value that's the same for
// every visitor (a home row). Returns a loader that:
// - answers from this instance's memory while it's younger than ttlMs;
// - otherwise checks Postgres, which another instance (or the previous
//   deploy) may have refreshed more recently;
// - if what it has is still too old, serves it anyway and refreshes inside
//   after() — Vercel freezes a function once its response is sent, so a
//   plain floating promise might never finish, while after() keeps the
//   function alive until the refresh is done and saved;
// - only waits on the refresh itself when nothing has ever been saved.
// Requests that arrive while a refresh is running share it instead of each
// starting their own scrape.
export function createPersistedLoader<T>(
  name: string,
  ttlMs: number,
  refresh: () => Promise<T>,
): () => Promise<T> {
  let memory: Persisted<T> | null = null;
  let inFlight: Promise<T> | null = null;
  let lastFailureAt = 0;

  const isFresh = (entry: Persisted<T>) => Date.now() - entry.at < ttlMs;

  function startRefresh(): Promise<T> {
    inFlight ??= (async () => {
      const startedAt = Date.now();
      try {
        const value = await refresh();
        memory = { at: Date.now(), value };
        await writePersisted(name, value);
        console.info(`${name} refreshed in ${Date.now() - startedAt} ms`);
        return value;
      } catch (err) {
        lastFailureAt = Date.now();
        console.error(
          `${name} refresh failed after ${Date.now() - startedAt} ms`,
          err,
        );
        throw err;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return async function load(): Promise<T> {
    if (memory && (isFresh(memory) || inFlight)) return memory.value;

    const saved = await readPersisted<T>(name);
    if (saved && (!memory || saved.at > memory.at)) memory = saved;

    if (!memory) return startRefresh();
    if (!isFresh(memory) && Date.now() - lastFailureAt > RETRY_AFTER_FAILURE_MS) {
      const refreshing = startRefresh();
      // Already logged inside startRefresh; the stale value is served below.
      after(() => refreshing.catch(() => {}));
    }
    return memory.value;
  };
}

// For the home rows' successful responses, which are the same for every
// visitor. Vercel's CDN keeps one copy for everyone for 45 minutes
// (matching the routes' own refresh window), then keeps serving it while
// refreshing in the background. Browsers don't cache it (max-age=0), so a
// reload still gets the CDN's copy.
export const SHARED_ROW_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=0, s-maxage=2700, stale-while-revalidate=86400",
};
