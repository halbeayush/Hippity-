"use client";

import { useEffect, useState } from "react";
import { dedupeKey, relevanceScore } from "./searchRelevance";
import type { SearchResult } from "./types";

const DEBOUNCE_MS = 400;

function sortByRelevance(
  results: SearchResult[],
  query: string,
): SearchResult[] {
  return [...results].sort(
    (a, b) =>
      relevanceScore(query, b.title, b.artist, b.trackCount) -
      relevanceScore(query, a.title, a.artist, a.trackCount),
  );
}

async function fetchResults(
  url: string,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const res = await fetch(url, { signal });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error ?? "Search failed");
  return data.results ?? [];
}

// Album search backed by two sources fired in parallel: iTunes (fast,
// includes artwork, but an incomplete catalog — see /api/search) and
// MusicBrainz (slower — a separate Cover Art Archive lookup per result —
// but far more exhaustive, see /api/search/musicbrainz). Whichever
// resolves first is shown immediately, typically iTunes; the other
// source's *new* results (deduped by artist+title) merge in and the whole
// list is re-sorted by relevance once it arrives, rather than making the
// fast path wait on the slow one. Shared by SearchOverlay and
// RecommendPanel — both search the same way.
export function useAlbumSearch(query: string) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      setError(false);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setLoading(true);
      setError(false);
      setResults([]);

      const seen = new Set<string>();
      function merge(sourceResults: SearchResult[]) {
        const fresh = sourceResults.filter(
          (r) => !seen.has(dedupeKey(r.artist, r.title)),
        );
        for (const r of fresh) seen.add(dedupeKey(r.artist, r.title));
        if (fresh.length > 0) {
          setResults((current) => sortByRelevance([...current, ...fresh], trimmed));
        }
      }

      const iTunes = fetchResults(
        `/api/search?q=${encodeURIComponent(trimmed)}`,
        controller.signal,
      );
      const musicBrainz = fetchResults(
        `/api/search/musicbrainz?q=${encodeURIComponent(trimmed)}`,
        controller.signal,
      );

      iTunes
        .then(merge)
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });

      musicBrainz.then(merge).catch(() => {});

      Promise.allSettled([iTunes, musicBrainz]).then((outcomes) => {
        if (controller.signal.aborted) return;
        if (outcomes.every((o) => o.status === "rejected")) setError(true);
      });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  return { results, loading, error };
}
