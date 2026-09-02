"use client";

import { useEffect, useState } from "react";
import type { AlbumSummary, Track } from "@/lib/types";
import CoverImage from "./CoverImage";

type SaveStatus = "queue" | "library";

function formatDuration(ms: number | null) {
  if (ms === null) return "";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function AlbumDetailModal({
  album,
  status,
  onAdd,
  onClose,
}: {
  album: AlbumSummary;
  status?: SaveStatus;
  onAdd: (status: SaveStatus) => Promise<void>;
  onClose: () => void;
}) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [addingStatus, setAddingStatus] = useState<SaveStatus | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(false);

    fetch(
      `/api/tracklist?mbid=${encodeURIComponent(album.mbid)}&artist=${encodeURIComponent(album.artist)}&title=${encodeURIComponent(album.title)}`,
      { signal: controller.signal },
    )
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error);
        setTracks(data.tracks ?? []);
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
    // album.artist/title are stable for a given album.mbid within one
    // open modal — no need to re-run for them alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album.mbid]);

  async function handleAdd(target: SaveStatus) {
    setAddingStatus(target);
    await onAdd(target);
    setAddingStatus(null);
  }

  const inLibrary = status === "library";
  const inTodo = status === "queue";
  const multiDisc = tracks.some((t) => t.disc !== tracks[0]?.disc);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-4 pt-16 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
          <p className="truncate text-sm font-semibold">{album.title}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close album details"
            className="rounded-md px-2 py-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex gap-4">
            <div className="w-28 shrink-0">
              <CoverImage
                src={album.coverArtUrl}
                alt={`${album.title} cover art`}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div>
                <p className="truncate text-base font-medium">
                  {album.title}
                </p>
                <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                  {album.artist}
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  disabled={inLibrary || addingStatus === "library"}
                  onClick={() => handleAdd("library")}
                  className="rounded-md bg-zinc-900 px-2 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
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
                  onClick={() => handleAdd("queue")}
                  className="rounded-md border border-zinc-300 px-2 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-zinc-700"
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
          </div>

          <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            {loading && (
              <p className="py-4 text-center text-sm text-zinc-400">
                Loading tracklist...
              </p>
            )}
            {!loading && error && (
              <p className="py-4 text-center text-sm text-zinc-400">
                Couldn&apos;t load the tracklist. Try again in a moment.
              </p>
            )}
            {!loading && !error && tracks.length === 0 && (
              <p className="py-4 text-center text-sm text-zinc-400">
                No tracklist available for this release.
              </p>
            )}
            {!loading && !error && tracks.length > 0 && (
              <ol className="flex flex-col gap-1">
                {tracks.map((track, index) => {
                  const isNewDisc =
                    multiDisc &&
                    (index === 0 || tracks[index - 1].disc !== track.disc);
                  return (
                    <li key={`${track.disc}-${track.position}`}>
                      {isNewDisc && (
                        <p className="mb-1 mt-2 text-xs font-semibold text-zinc-400 first:mt-0">
                          Disc {track.disc}
                        </p>
                      )}
                      <div className="flex items-baseline gap-2 text-sm">
                        <span className="w-5 shrink-0 text-right text-zinc-400">
                          {track.position}.
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {track.title}
                        </span>
                        <span className="shrink-0 text-xs text-zinc-400">
                          {formatDuration(track.length)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
