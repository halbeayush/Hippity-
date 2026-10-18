"use client";

import { useEffect, useState } from "react";
import type { TopTracksResponse } from "@/lib/types";
import CoverImage from "@/components/CoverImage";
import { apiFetch, readJson } from "@/lib/apiFetch";

// What came back from signing in with Last.fm (/api/lastfm/callback adds
// ?lastfm=... to the Social tab's URL).
const SIGN_IN_MESSAGES: Record<string, string> = {
  connected: "Connected to Last.fm.",
  error: "Couldn't connect to Last.fm. Please try again.",
  "not-configured": "Last.fm sign-in isn't set up on this server yet.",
};

// A user's five most-played tracks over the last 7 days, from Last.fm (see
// /api/social/top-tracks). Without a userId it's the signed-in user's own
// chart, which offers "Sign in with Last.fm" until they've connected.
export default function WeeklyTopTracksChart({
  userId,
  displayName,
}: {
  userId?: number;
  displayName?: string;
}) {
  const [data, setData] = useState<TopTracksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [signInMessage, setSignInMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    apiFetch(`/api/social/top-tracks${userId ? `?userId=${userId}` : ""}`, {
      signal: controller.signal,
    })
      .then(readJson)
      .then((body) => setData(body.tracks ? body : null))
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setData(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [userId]);

  // Shown once after coming back from Last.fm, then dropped from the URL so
  // a reload doesn't repeat it.
  useEffect(() => {
    if (userId) return;
    const url = new URL(window.location.href);
    const result = url.searchParams.get("lastfm");
    if (!result) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSignInMessage(SIGN_IN_MESSAGES[result] ?? null);
    url.searchParams.delete("lastfm");
    window.history.replaceState(null, "", url);
  }, [userId]);

  async function disconnect() {
    await apiFetch("/api/lastfm/connect", { method: "DELETE" });
    setSignInMessage(null);
    setData((current) =>
      current ? { ...current, source: null, lastfmUsername: null, tracks: [] } : current,
    );
  }

  if (loading) {
    return <p className="py-6 text-center text-xs text-zinc-400">Loading...</p>;
  }

  const message = signInMessage && (
    <p className="mb-2 text-xs text-zinc-400">{signInMessage}</p>
  );

  if (!data || (data.isSelf && !data.lastfmUsername)) {
    if (!data?.isSelf) {
      return (
        <p className="py-6 text-center text-xs text-zinc-400">
          No weekly top tracks yet.
        </p>
      );
    }
    return (
      <div>
        {message}
        <div className="flex flex-col items-center gap-2 rounded-xl border border-zinc-200 px-4 py-6 text-center dark:border-zinc-800">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Sign in with Last.fm to show your weekly top 5.
          </p>
          <p className="max-w-xs text-xs text-zinc-400">
            Your friends will see the tracks you&apos;ve played most over the
            last 7 days, from your Last.fm scrobbles.
          </p>
          {/* A full page load, not a client navigation — it ends on Last.fm. */}
          <a
            href="/api/lastfm/connect"
            className="mt-1 rounded-full bg-[#d51007] px-4 py-2 text-sm font-medium text-white hover:bg-[#b00d06]"
          >
            Sign in with Last.fm
          </a>
        </div>
      </div>
    );
  }

  if (data.tracks.length === 0) {
    return (
      <div>
        {message}
        <p className="py-6 text-center text-xs text-zinc-400">
          {data.lastfmUsername
            ? `No scrobbles in the last 7 days${data.isSelf ? "" : ` for ${displayName ?? "them"}`}.`
            : `${displayName ?? "They"} ${displayName ? "hasn't" : "haven't"} connected Last.fm yet.`}
        </p>
        {data.isSelf && data.lastfmUsername && (
          <ConnectedAs username={data.lastfmUsername} onDisconnect={disconnect} />
        )}
      </div>
    );
  }

  return (
    <div>
      {message}
      <p className="mb-2 text-xs text-zinc-400">
        {data.source === "lastfm"
          ? "Last 7 days, from Last.fm"
          : data.weekStart
            ? `Week of ${new Date(data.weekStart).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}`
            : null}
      </p>
      <ol className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {data.tracks.map((track) => (
          <li key={track.rank} className="flex items-center gap-3 py-2">
            <span className="w-4 shrink-0 text-sm font-semibold text-zinc-400">
              {track.rank}
            </span>
            <div className="h-10 w-10 shrink-0">
              <CoverImage
                src={track.coverArtUrl}
                alt={`${track.trackName} cover art`}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{track.trackName}</p>
              <p className="truncate text-xs text-zinc-400">{track.artist}</p>
            </div>
            {track.playcount != null && (
              <span className="shrink-0 text-xs text-zinc-400">
                {track.playcount} play{track.playcount === 1 ? "" : "s"}
              </span>
            )}
          </li>
        ))}
      </ol>
      {data.isSelf && data.lastfmUsername && (
        <ConnectedAs username={data.lastfmUsername} onDisconnect={disconnect} />
      )}
    </div>
  );
}

function ConnectedAs({
  username,
  onDisconnect,
}: {
  username: string;
  onDisconnect: () => void;
}) {
  return (
    <p className="mt-2 text-xs text-zinc-400">
      Connected as{" "}
      <a
        href={`https://www.last.fm/user/${encodeURIComponent(username)}`}
        target="_blank"
        rel="noreferrer"
        className="underline hover:text-zinc-600 dark:hover:text-zinc-200"
      >
        {username}
      </a>{" "}
      ·{" "}
      <button
        type="button"
        onClick={onDisconnect}
        className="underline hover:text-zinc-600 dark:hover:text-zinc-200"
      >
        Disconnect
      </button>
    </p>
  );
}
