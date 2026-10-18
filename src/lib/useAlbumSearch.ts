"use client";

import { useEffect, useState } from "react";
import {
  applyArtistFilter,
  dedupeKey,
  rankSearchResults,
  type ArtistFilter,
} from "./searchRelevance";
import type { SearchResult } from "./types";
import { apiFetch, readJson } from "@/lib/apiFetch";

const DEBOUNCE_MS = 400;

type SearchResponse = {
  results: SearchResult[];
  // Only /api/search sends these — see applyArtistFilter.
  artistFilters: ArtistFilter[];
};

async function fetchResults(
  url: string,
  signal: AbortSignal,
): Promise<SearchResponse> {
  const res = await apiFetch(url, { signal });
  const data = await readJson(res);
  if (!res.ok || data.error) throw new Error(data.error ?? "Search failed");
  return { results: data.results ?? [], artistFilters: data.artistFilters ?? [] };
}

// Album search backed by two sources fired in parallel: iTunes (fast,
// includes artwork, but an incomplete catalog — see /api/search) and
// MusicBrainz (slower — a separate Cover Art Archive lookup per result —
// but far more exhaustive, see /api/search/musicbrainz). iTunes' results
// show as soon as they arrive; MusicBrainz's *new* results (deduped by
// artist+title) merge in after, and the whole list is re-ranked (see
// rankSearchResults), rather than making the fast path wait on the slow
// one. Shared by SearchOverlay and
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
      const all: SearchResult[] = [];
      let artistFilters: ArtistFilter[] = [];
      function merge(sourceResults: SearchResult[]) {
        const fresh = sourceResults.filter(
          (r) => !seen.has(dedupeKey(r.artist, r.title)),
        );
        for (const r of fresh) seen.add(dedupeKey(r.artist, r.title));
        all.push(...fresh);
        setResults(
          rankSearchResults(applyArtistFilter(all, artistFilters, trimmed), trimmed),
        );
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
        .then((response) => {
          artistFilters = response.artistFilters;
          merge(response.results);
        })
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });

      // MusicBrainz results are only merged in once iTunes has answered:
      // its artistFilters decide which of them are an artist's real albums
      // (MusicBrainz lists bootlegs and fan releases too), and showing them
      // first would flash those up before they're filtered back out.
      Promise.allSettled([iTunes])
        .then(() => musicBrainz)
        .then((response) => merge(response.results))
        .catch(() => {});

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
