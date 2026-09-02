"use client";

import { useMemo, useState } from "react";
import AlbumCard from "@/components/AlbumCard";
import AlbumDetailModal from "@/components/AlbumDetailModal";
import SearchOverlay from "@/components/SearchOverlay";
import TopNav from "@/components/TopNav";
import type { Album } from "@/lib/types";
import { useAlbums } from "@/lib/useAlbums";

type SortOption = "recent" | "title" | "artist";

const SORT_LABELS: Record<SortOption, string> = {
  recent: "Recently listened",
  title: "Title (A–Z)",
  artist: "Artist (A–Z)",
};

export default function LibraryPage() {
  const {
    library,
    loading,
    albumStatusByMbid,
    handleAddAlbum,
    handleRemove,
    handleRate,
    handleNote,
  } = useAlbums();
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailAlbum, setDetailAlbum] = useState<Album | null>(null);
  const [sortOption, setSortOption] = useState<SortOption>("recent");

  // The API already returns the library sorted by most-recently-listened,
  // so "recent" just keeps that order as-is.
  const sortedLibrary = useMemo(() => {
    if (sortOption === "recent") return library;
    const collator = new Intl.Collator(undefined, { sensitivity: "base" });
    const key = sortOption === "title" ? "title" : "artist";
    return [...library].sort((a, b) => collator.compare(a[key], b[key]));
  }, [library, sortOption]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {loading
            ? "Library"
            : `${library.length} album${library.length === 1 ? "" : "s"} in your library`}
        </p>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-white">
            Sort by
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as SortOption)}
              className="rounded-md border border-zinc-700 bg-black px-2 py-1.5 text-xs font-medium text-white focus:outline-none focus:ring-1 focus:ring-zinc-400"
            >
              {(Object.keys(SORT_LABELS) as SortOption[]).map((option) => (
                <option key={option} value={option}>
                  {SORT_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            + Add album
          </button>
        </div>
      </header>

      <TopNav />

      {loading ? (
        <p className="py-16 text-center text-sm text-zinc-400">Loading...</p>
      ) : library.length === 0 ? (
        <EmptyState
          message="No albums in your library yet."
          hint="Mark something in your wishlist as listened, or add an album straight to your library and rate it."
        />
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {sortedLibrary.map((album) => (
            <AlbumCard
              key={album.id}
              album={album}
              onRate={(rating) => handleRate(album.id, rating)}
              onNote={(note) => handleNote(album.id, note)}
              onDelete={() => handleRemove(album.id, "library")}
              onOpenDetail={() => setDetailAlbum(album)}
            />
          ))}
        </div>
      )}

      {searchOpen && (
        <SearchOverlay
          onClose={() => setSearchOpen(false)}
          onAdd={handleAddAlbum}
          albumStatusByMbid={albumStatusByMbid}
        />
      )}

      {detailAlbum && (
        <AlbumDetailModal
          album={detailAlbum}
          status={albumStatusByMbid[detailAlbum.mbid]}
          onAdd={(status) =>
            handleAddAlbum(
              {
                mbid: detailAlbum.mbid,
                title: detailAlbum.title,
                artist: detailAlbum.artist,
                year: null,
                coverArtUrl: detailAlbum.coverArtUrl ?? "",
              },
              status,
            )
          }
          onClose={() => setDetailAlbum(null)}
        />
      )}
    </div>
  );
}

function EmptyState({ message, hint }: { message: string; hint: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 py-16 text-center">
      <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
        {message}
      </p>
      <p className="max-w-xs text-xs text-zinc-400">{hint}</p>
    </div>
  );
}
