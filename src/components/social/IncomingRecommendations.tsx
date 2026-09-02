"use client";

import { useState } from "react";
import type { RecommendationEntry } from "@/lib/types";
import Avatar from "@/components/Avatar";
import CoverImage from "@/components/CoverImage";

export default function IncomingRecommendations({
  recommendations,
  onResolve,
}: {
  recommendations: RecommendationEntry[];
  onResolve: (id: number, action: "listened" | "reject") => Promise<void>;
}) {
  const [resolvingId, setResolvingId] = useState<number | null>(null);

  if (recommendations.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-zinc-400">
        No recommendations from friends right now.
      </p>
    );
  }

  async function handle(id: number, action: "listened" | "reject") {
    setResolvingId(id);
    await onResolve(id, action);
    setResolvingId(null);
  }

  return (
    <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
      {recommendations.map((rec) => (
        <li key={rec.id} className="flex items-center gap-3 py-2.5">
          <div className="h-12 w-12 shrink-0">
            <CoverImage
              src={rec.album.coverArtUrl}
              alt={`${rec.album.title} cover art`}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{rec.album.title}</p>
            <p className="truncate text-xs text-zinc-400">{rec.album.artist}</p>
            <div className="mt-0.5 flex items-center gap-1.5">
              <Avatar
                displayName={rec.sender.displayName}
                color={rec.sender.avatarColor}
                size="sm"
              />
              <p className="truncate text-[11px] text-zinc-400">
                Recommended by {rec.sender.displayName}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-1.5">
            <button
              type="button"
              disabled={resolvingId === rec.id}
              onClick={() => handle(rec.id, "listened")}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Mark as listened
            </button>
            <button
              type="button"
              disabled={resolvingId === rec.id}
              onClick={() => handle(rec.id, "reject")}
              className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 disabled:opacity-50 dark:border-zinc-700"
            >
              Reject
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
