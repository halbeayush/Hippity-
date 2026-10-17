import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

// Keeps a route's last good result on disk (next to the cover-art cache),
// so a server restart serves it straight away and refreshes in the
// background — instead of the first visit after every restart waiting on a
// full scrape, or getting nothing if that scrape is rate-limited. Read and
// write failures are swallowed: this only ever makes a cold start faster,
// never a reason for a request to fail.
const CACHE_DIR = path.join(process.cwd(), ".cache", "routes");

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
