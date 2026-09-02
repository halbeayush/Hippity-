"use client";

import type { Album } from "@/lib/types";
import CoverImage from "./CoverImage";

export default function QueueCard({
  album,
  onMarkListened,
  onRemove,
  onOpenDetail,
}: {
  album: Album;
  // Omit both (e.g. when viewing a friend's to-do list) to render read-only.
  onMarkListened?: () => void;
  onRemove?: () => void;
  onOpenDetail: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onOpenDetail}
        aria-label={`View tracklist for ${album.title}`}
        className="block w-full"
      >
        <CoverImage src={album.coverArtUrl} alt={`${album.title} cover art`} />
      </button>
      <div>
        <p className="truncate text-sm font-medium">{album.title}</p>
        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
          {album.artist}
        </p>
      </div>
      {(onMarkListened || onRemove) && (
        <div className="flex gap-2">
          {onMarkListened && (
            <button
              type="button"
              onClick={onMarkListened}
              className="flex-1 rounded-md bg-zinc-900 px-2 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Mark as listened
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label="Remove from wishlist"
              className="rounded-md border border-zinc-200 px-2 py-1.5 text-xs text-zinc-400 hover:text-red-500 dark:border-zinc-700"
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}
