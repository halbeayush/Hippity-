"use client";

import { useState } from "react";
import type { SearchResult } from "@/lib/types";
import { useAlbumSearch } from "@/lib/useAlbumSearch";
import AlbumDetailModal from "./AlbumDetailModal";
import CoverImage from "./CoverImage";

type SaveStatus = "queue" | "library";

export default function SearchOverlay({
  onClose,
  onAdd,
  albumStatusByMbid,
}: {
  onClose: () => void;
  onAdd: (result: SearchResult, status: SaveStatus) => Promise<void>;
  albumStatusByMbid: Record<string, SaveStatus>;
}) {
  const [query, setQuery] = useState("");
  const { results, loading, error } = useAlbumSearch(query);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [detailResult, setDetailResult] = useState<SearchResult | null>(null);

  async function handleAdd(result: SearchResult, status: SaveStatus) {
    setAddingKey(`${result.mbid}:${status}`);
    await onAdd(result, status);
    setAddingKey(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-16 backdrop-blur-sm">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl dark:bg-zinc-900">
        <div className="flex items-center gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search albums or artists..."
            className="flex-1 bg-transparent px-1 text-sm focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="rounded-md px-2 py-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading && (
            <p className="p-4 text-center text-sm text-zinc-400">Searching...</p>
          )}
          {!loading && query.trim() && error && (
            <p className="p-4 text-center text-sm text-zinc-400">
              Search is temporarily unavailable. Try again in a moment.
            </p>
          )}
          {!loading && query.trim() && !error && results.length === 0 && (
            <p className="p-4 text-center text-sm text-zinc-400">
              No albums found.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {results.map((result) => {
              const savedStatus = albumStatusByMbid[result.mbid];
              const inLibrary = savedStatus === "library";
              const inTodo = savedStatus === "queue";
              const addingTodo = addingKey === `${result.mbid}:queue`;
              const addingLibrary = addingKey === `${result.mbid}:library`;

              return (
                <div key={result.mbid} className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDetailResult(result)}
                    aria-label={`View tracklist for ${result.title}`}
                    className="block w-full"
                  >
                    <CoverImage
                      src={result.coverArtUrl}
                      alt={`${result.title} cover art`}
                    />
                  </button>
                  <p className="truncate text-xs font-medium">{result.title}</p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {result.artist}
                    {result.year ? ` · ${result.year}` : ""}
                  </p>
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      disabled={inLibrary || addingLibrary}
                      onClick={() => handleAdd(result, "library")}
                      className="rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                    >
                      {inLibrary
                        ? "In library"
                        : addingLibrary
                          ? "Adding..."
                          : "Add to library"}
                    </button>
                    <button
                      type="button"
                      disabled={inTodo || inLibrary || addingTodo}
                      onClick={() => handleAdd(result, "queue")}
                      className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] font-medium disabled:opacity-50 dark:border-zinc-700"
                    >
                      {inLibrary
                        ? "In library"
                        : inTodo
                          ? "In to-do"
                          : addingTodo
                            ? "Adding..."
                            : "Add to to-do"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {detailResult && (
        <AlbumDetailModal
          album={detailResult}
          status={albumStatusByMbid[detailResult.mbid]}
          onAdd={(status) => handleAdd(detailResult, status)}
          onClose={() => setDetailResult(null)}
        />
      )}
    </div>
  );
}
