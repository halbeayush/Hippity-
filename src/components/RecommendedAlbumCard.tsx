"use client";

import type { AlbumSummary } from "@/lib/types";
import CoverImage from "./CoverImage";

type SaveStatus = "queue" | "library";

// Mirrors SearchOverlay's result tile: cover art (clickable to open the
// tracklist/detail view) plus inline Add to library / Add to to-do buttons,
// since these results — like search results — aren't saved yet.
export default function RecommendedAlbumCard({
  album,
  status,
  addingStatus,
  onOpenDetail,
  onAdd,
  onDismiss,
}: {
  album: AlbumSummary;
  status?: SaveStatus;
  addingStatus: SaveStatus | null;
  onOpenDetail: () => void;
  onAdd: (status: SaveStatus) => void;
  onDismiss: () => void;
}) {
  const inLibrary = status === "library";
  const inTodo = status === "queue";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <button
          type="button"
          onClick={onOpenDetail}
          aria-label={`View tracklist for ${album.title}`}
          className="block w-full"
        >
          <CoverImage
            src={album.coverArtUrl}
            alt={`${album.title} cover art`}
          />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          aria-label={`Dismiss ${album.title}`}
          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs leading-none text-white hover:bg-black/80"
        >
          ✕
        </button>
      </div>
      <p className="truncate text-xs font-medium">{album.title}</p>
      <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
        {album.artist}
      </p>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          disabled={inLibrary || addingStatus === "library"}
          onClick={() => onAdd("library")}
          className="rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {inLibrary
            ? "In library"
            : addingStatus === "library"
              ? "Adding..."
              : "Add to library"}
        </button>
        <button
          type="button"
          disabled={inTodo || inLibrary || addingStatus === "queue"}
          onClick={() => onAdd("queue")}
          className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] font-medium disabled:opacity-50 dark:border-zinc-700"
        >
          {inLibrary
            ? "In library"
            : inTodo
              ? "In to-do"
              : addingStatus === "queue"
                ? "Adding..."
                : "Add to to-do"}
        </button>
      </div>
    </div>
  );
}
