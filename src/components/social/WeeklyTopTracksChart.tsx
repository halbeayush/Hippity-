"use client";

import { useEffect, useState } from "react";
import type { WeeklyTopTrack } from "@/lib/types";
import CoverImage from "@/components/CoverImage";

// Renders a user's top-5 tracks for their most recent week. Fetches by
// userId so the same component works for the current user or a friend
// (see /api/social/top-tracks).
export default function WeeklyTopTracksChart({ userId }: { userId: number }) {
  const [tracks, setTracks] = useState<WeeklyTopTrack[]>([]);
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/social/top-tracks?userId=${userId}`, {
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data) => {
        setTracks(data.tracks ?? []);
        setWeekStart(data.weekStart ?? null);
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setTracks([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [userId]);

  if (loading) {
    return <p className="py-6 text-center text-xs text-zinc-400">Loading...</p>;
  }

  if (tracks.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-zinc-400">
        No weekly top tracks yet.
      </p>
    );
  }

  return (
    <div>
      {weekStart && (
        <p className="mb-2 text-xs text-zinc-400">
          Week of{" "}
          {new Date(weekStart).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </p>
      )}
      <ol className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {tracks.map((track) => (
          <li key={track.id} className="flex items-center gap-3 py-2">
            <span className="w-4 shrink-0 text-sm font-semibold text-zinc-400">
              {track.rank}
            </span>
            <div className="h-10 w-10 shrink-0">
              <CoverImage
                src={track.coverArtUrl}
                alt={`${track.trackName} cover art`}
              />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{track.trackName}</p>
              <p className="truncate text-xs text-zinc-400">{track.artist}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
