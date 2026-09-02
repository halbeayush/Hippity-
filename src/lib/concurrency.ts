// Runs `mapper` over `items` with at most `concurrency` in flight at once.
// Used for calls to APIs without strict rate limits (e.g. Last.fm) where
// resolving a page's worth of candidates one at a time would be too slow —
// contrast with MusicBrainz, which needs its own explicit 1 req/sec spacing
// instead of this.
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}
