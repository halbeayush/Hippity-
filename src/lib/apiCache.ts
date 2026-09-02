// Small in-memory TTL cache shared by the Last.fm and MusicBrainz clients.
// Recommendation modes frequently share underlying artists (e.g. the same
// artist turning up as "similar" for two different genres), so caching at
// this lower level — not just the final assembled album list — means that
// overlap doesn't re-hit the external API.
export function createTtlCache<V>(ttlMs: number) {
  const store = new Map<string, { at: number; value: V }>();

  return {
    get(key: string): V | undefined {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (Date.now() - hit.at > ttlMs) {
        store.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key: string, value: V): void {
      store.set(key, { at: Date.now(), value });
    },
  };
}
