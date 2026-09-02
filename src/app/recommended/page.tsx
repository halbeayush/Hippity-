"use client";

import { useEffect, useRef, useState } from "react";
import AlbumDetailModal from "@/components/AlbumDetailModal";
import RecommendedAlbumCard from "@/components/RecommendedAlbumCard";
import TopNav from "@/components/TopNav";
import type { AlbumSummary } from "@/lib/types";
import { useAlbums } from "@/lib/useAlbums";

type Mode = "library" | "artist" | "genre";
type SaveStatus = "queue" | "library";

const MODE_LABELS: Record<Mode, string> = {
  library: "Based on my library",
  artist: "Based on an artist",
  genre: "Based on a genre",
};

const GENRES = [
  "Rock",
  "Pop",
  "Hip-Hop",
  "Electronic",
  "Jazz",
  "Metal",
  "Indie",
  "R&B",
  "Folk",
  "Classical",
  "Punk",
  "Reggae",
  "Country",
  "Blues",
  "Soul",
  "K-Pop",
  "Shoegaze",
  "Ambient",
  "Techno",
  "House",
];

// How many recommendation cards the grid shows at once. The API returns a
// larger pool than this (see recommendations.ts) so that adding or
// dismissing a card can pull the next candidate from the pool already sent
// down, instead of triggering a fresh request.
const VISIBLE_COUNT = 12;

export default function RecommendedPage() {
  const { albumStatusByMbid, handleAddAlbum } = useAlbums();
  const [mode, setMode] = useState<Mode>("library");

  const [artistQuery, setArtistQuery] = useState("");
  const [artistSuggestions, setArtistSuggestions] = useState<string[]>([]);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [genre, setGenre] = useState(GENRES[0]);

  // The full candidate pool for the current mode/params, ordered — the
  // grid displays the first VISIBLE_COUNT; removing an entry (added or
  // dismissed) automatically pulls the next pooled candidate into view.
  const [candidates, setCandidates] = useState<AlbumSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [detailAlbum, setDetailAlbum] = useState<AlbumSummary | null>(null);
  const [addingKey, setAddingKey] = useState<string | null>(null);

  // Every mbid shown so far for the current mode/params — cleared whenever
  // that selection changes, since "avoid repeats" only applies within one
  // browsing session on one selection. Sent back as `exclude` on refresh so
  // the algorithm generally surfaces something new (see preferFresh in
  // recommendations.ts) without permanently blacklisting a strong match.
  const seenMbids = useRef<Set<string>>(new Set());
  const refreshController = useRef<AbortController | null>(null);

  const albums = candidates.slice(0, VISIBLE_COUNT);

  function removeCandidate(mbid: string) {
    setCandidates((current) => current.filter((a) => a.mbid !== mbid));
  }

  function activeUrl(): string | null {
    if (mode === "library") return "/api/recommended/library-based";
    if (mode === "artist" && selectedArtist) {
      return `/api/recommended/artist?artist=${encodeURIComponent(selectedArtist)}`;
    }
    if (mode === "genre") {
      return `/api/recommended/genre?tag=${encodeURIComponent(genre)}`;
    }
    return null;
  }

  // Artist name autocomplete, debounced — only relevant in "artist" mode.
  useEffect(() => {
    if (mode !== "artist") return;
    const trimmed = artistQuery.trim();
    if (!trimmed || trimmed === selectedArtist) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setArtistSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/recommended/artist-search?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );
        const data = await res.json();
        setArtistSuggestions(data.artists ?? []);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setArtistSuggestions([]);
      }
    }, 350);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [mode, artistQuery, selectedArtist]);

  // Loads recommendations whenever the active mode (or its params) change.
  useEffect(() => {
    const url = activeUrl();
    seenMbids.current = new Set();

    if (!url) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCandidates([]);
      setMessage(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setMessage(null);

    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error);
        const newAlbums: AlbumSummary[] = data.albums ?? [];
        setCandidates(newAlbums);
        setMessage(data.message ?? null);
        for (const a of newAlbums) seenMbids.current.add(a.mbid);
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedArtist, genre]);

  async function handleRefresh() {
    const url = activeUrl();
    if (!url || loading || refreshing) return;

    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;

    setRefreshing(true);
    setError(false);

    const exclude = Array.from(seenMbids.current).join(",");
    const withExclude = exclude
      ? `${url}${url.includes("?") ? "&" : "?"}exclude=${encodeURIComponent(exclude)}`
      : url;

    try {
      const res = await fetch(withExclude, { signal: controller.signal });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error);
      const newAlbums: AlbumSummary[] = data.albums ?? [];
      setCandidates(newAlbums);
      setMessage(data.message ?? null);
      for (const a of newAlbums) seenMbids.current.add(a.mbid);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError(true);
    } finally {
      if (!controller.signal.aborted) setRefreshing(false);
    }
  }

  async function handleAdd(album: AlbumSummary, status: SaveStatus) {
    setAddingKey(`${album.mbid}:${status}`);
    await handleAddAlbum(
      {
        mbid: album.mbid,
        title: album.title,
        artist: album.artist,
        year: null,
        coverArtUrl: album.coverArtUrl ?? "",
      },
      status,
    );
    setAddingKey(null);
    removeCandidate(album.mbid);
  }

  function handleDismiss(album: AlbumSummary) {
    removeCandidate(album.mbid);
    if (detailAlbum?.mbid === album.mbid) setDetailAlbum(null);
  }

  const canRefresh = activeUrl() !== null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-6">
      <TopNav />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                mode === m
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={!canRefresh || loading || refreshing}
          onClick={handleRefresh}
          className="rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {refreshing ? "Refreshing..." : "↻ Refresh"}
        </button>
      </div>

      {mode === "artist" && (
        <div className="relative mb-6 max-w-sm">
          <input
            type="text"
            value={artistQuery}
            onChange={(e) => {
              setArtistQuery(e.target.value);
              setSelectedArtist(null);
            }}
            placeholder="Type an artist name..."
            className="w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700"
          />
          {artistSuggestions.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {artistSuggestions.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedArtist(name);
                      setArtistQuery(name);
                      setArtistSuggestions([]);
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {mode === "genre" && (
        <div className="mb-6">
          <select
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            {GENRES.map((g) => (
              <option
                key={g}
                value={g}
                className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
              >
                {g}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center gap-1 py-16 text-center">
          <p className="text-sm text-zinc-400">Finding recommendations...</p>
        </div>
      ) : error ? (
        <p className="py-16 text-center text-sm text-zinc-400">
          Couldn&apos;t load recommendations right now.
        </p>
      ) : mode === "artist" && !selectedArtist ? (
        <p className="py-16 text-center text-sm text-zinc-400">
          Search for an artist above to see albums from their catalog.
        </p>
      ) : message ? (
        <p className="py-16 text-center text-sm text-zinc-400">{message}</p>
      ) : albums.length === 0 ? (
        <p className="py-16 text-center text-sm text-zinc-400">
          No recommendations found.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {albums.map((album) => (
            <RecommendedAlbumCard
              key={album.mbid}
              album={album}
              status={albumStatusByMbid[album.mbid]}
              addingStatus={
                addingKey === `${album.mbid}:library`
                  ? "library"
                  : addingKey === `${album.mbid}:queue`
                    ? "queue"
                    : null
              }
              onOpenDetail={() => setDetailAlbum(album)}
              onAdd={(status) => handleAdd(album, status)}
              onDismiss={() => handleDismiss(album)}
            />
          ))}
        </div>
      )}

      {detailAlbum && (
        <AlbumDetailModal
          album={detailAlbum}
          status={albumStatusByMbid[detailAlbum.mbid]}
          onAdd={(status) => handleAdd(detailAlbum, status)}
          onClose={() => setDetailAlbum(null)}
        />
      )}
    </div>
  );
}
