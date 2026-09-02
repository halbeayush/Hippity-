"use client";

import { useState } from "react";
import AlbumDetailModal from "@/components/AlbumDetailModal";
import QueueCard from "@/components/QueueCard";
import SearchOverlay from "@/components/SearchOverlay";
import TopNav from "@/components/TopNav";
import type { Album } from "@/lib/types";
import { useAlbums } from "@/lib/useAlbums";

export default function TodoPage() {
  const {
    queue,
    loading,
    albumStatusByMbid,
    handleAddAlbum,
    handleMarkListened,
    handleRemove,
  } = useAlbums();
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailAlbum, setDetailAlbum] = useState<Album | null>(null);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-6">
      <header className="mb-6 flex items-center justify-end">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          + Add album
        </button>
      </header>

      <TopNav />

      {loading ? (
        <p className="py-16 text-center text-sm text-zinc-400">Loading...</p>
      ) : queue.length === 0 ? (
        <EmptyState
          message="Your listen wishlist is empty."
          hint="Tap “+ Add album” to search MusicBrainz and save something for later."
        />
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {queue.map((album) => (
            <QueueCard
              key={album.id}
              album={album}
              onMarkListened={() => handleMarkListened(album.id)}
              onRemove={() => handleRemove(album.id, "queue")}
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
