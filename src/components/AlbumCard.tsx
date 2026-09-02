"use client";

import { useState } from "react";
import type { Album } from "@/lib/types";
import CoverImage from "./CoverImage";
import StarRating from "./StarRating";

export default function AlbumCard({
  album,
  onRate,
  onNote,
  onDelete,
  onOpenDetail,
}: {
  album: Album;
  // Omit these (e.g. when viewing a friend's library) to render read-only:
  // the star rating and note still show, just without editing controls.
  onRate?: (rating: number) => void;
  onNote?: (note: string) => void;
  onDelete?: () => void;
  onOpenDetail: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [noteDraft, setNoteDraft] = useState(album.note ?? "");

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <button
          type="button"
          onClick={onOpenDetail}
          aria-label={`View tracklist for ${album.title}`}
          className="block w-full"
        >
          <CoverImage src={album.coverArtUrl} alt={`${album.title} cover art`} />
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Hide rating and note" : "Show rating and note"}
          aria-expanded={expanded}
          className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition hover:bg-black/75"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>

      <div>
        <p className="truncate text-sm font-medium">{album.title}</p>
        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
          {album.artist}
        </p>
      </div>

      {expanded && (
        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
          <StarRating value={album.rating} onChange={onRate} size="sm" />
          {onNote ? (
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onBlur={() => {
                if (noteDraft !== (album.note ?? "")) onNote(noteDraft);
              }}
              placeholder="Notes on this album..."
              rows={2}
              className="w-full resize-none rounded-md border border-zinc-200 bg-transparent p-1.5 text-xs placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700"
            />
          ) : (
            album.note && (
              <p className="whitespace-pre-wrap text-xs italic text-zinc-500 dark:text-zinc-400">
                {album.note}
              </p>
            )
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="self-start text-xs text-zinc-400 hover:text-red-500"
            >
              Remove from library
            </button>
          )}
        </div>
      )}
    </div>
  );
}
