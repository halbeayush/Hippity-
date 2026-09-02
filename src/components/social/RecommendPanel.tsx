"use client";

import { useCallback, useEffect, useState } from "react";
import type { RecommendationEntry, SearchResult } from "@/lib/types";
import { useAlbumSearch } from "@/lib/useAlbumSearch";
import CoverImage from "@/components/CoverImage";

export default function RecommendPanel({
  friendUsername,
  friendDisplayName,
}: {
  friendUsername: string;
  friendDisplayName: string;
}) {
  const [max, setMax] = useState(3);
  const [remaining, setRemaining] = useState(0);
  const [pending, setPending] = useState<RecommendationEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [query, setQuery] = useState("");
  const { results } = useAlbumSearch(query);
  const [sendingMbid, setSendingMbid] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadSlots = useCallback(async () => {
    const res = await fetch(
      `/api/social/recommendations?to=${encodeURIComponent(friendUsername)}`,
    );
    const data = await res.json();
    setMax(data.max ?? 3);
    setRemaining(data.remaining ?? 0);
    setPending(data.pending ?? []);
    setLoaded(true);
  }, [friendUsername]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSlots();
  }, [loadSlots]);

  async function handleSend(result: SearchResult) {
    setSendingMbid(result.mbid);
    setMessage(null);
    const res = await fetch("/api/social/recommendations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipientUsername: friendUsername,
        mbid: result.mbid,
        title: result.title,
        artist: result.artist,
        coverArtUrl: result.coverArtUrl,
      }),
    });
    const data = await res.json();
    setSendingMbid(null);
    if (!res.ok) {
      setMessage(data.error ?? "Something went wrong.");
      return;
    }
    setMessage(`Sent "${result.title}" to ${friendDisplayName}.`);
    setQuery("");
    await loadSlots();
  }

  if (!loaded) {
    return <p className="py-4 text-center text-xs text-zinc-400">Loading...</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-400">
        {remaining} of {max} recommendation slots open to {friendDisplayName}
      </p>

      {pending.length > 0 && (
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {pending.map((rec) => (
            <li key={rec.id} className="flex items-center gap-3 py-2">
              <div className="h-10 w-10 shrink-0">
                <CoverImage
                  src={rec.album.coverArtUrl}
                  alt={`${rec.album.title} cover art`}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{rec.album.title}</p>
                <p className="truncate text-xs text-zinc-400">{rec.album.artist}</p>
              </div>
              <span className="shrink-0 text-[11px] text-zinc-400">
                Waiting on {friendDisplayName}
              </span>
            </li>
          ))}
        </ul>
      )}

      {remaining > 0 ? (
        <div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search albums or artists..."
            className="w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700"
          />
          {message && <p className="mt-1.5 text-xs text-zinc-400">{message}</p>}
          {results.length > 0 && (
            <ul className="mt-2 flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
              {results.map((result) => (
                <li key={result.mbid} className="flex items-center gap-3 py-2">
                  <div className="h-10 w-10 shrink-0">
                    <CoverImage
                      src={result.coverArtUrl}
                      alt={`${result.title} cover art`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{result.title}</p>
                    <p className="truncate text-xs text-zinc-400">{result.artist}</p>
                  </div>
                  <button
                    type="button"
                    disabled={sendingMbid === result.mbid}
                    onClick={() => handleSend(result)}
                    className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    {sendingMbid === result.mbid ? "Sending..." : "Recommend"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-xs text-zinc-400">
          {message ??
            `No open slots — wait for ${friendDisplayName} to listen or pass on one of the above.`}
        </p>
      )}
    </div>
  );
}
