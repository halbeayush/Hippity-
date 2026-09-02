"use client";

import { useEffect, useState } from "react";
import type { FriendUser, PendingRequest } from "@/lib/types";
import Avatar from "@/components/Avatar";

export default function AddFriendPanel({
  incoming,
  outgoing,
  onSendRequest,
  onAccept,
  onDecline,
}: {
  incoming: PendingRequest[];
  outgoing: PendingRequest[];
  onSendRequest: (
    username: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  onAccept: (friendshipId: number) => Promise<void>;
  onDecline: (friendshipId: number) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FriendUser[]>([]);
  const [sendingUsername, setSendingUsername] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/social/users/search?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );
        const data = await res.json();
        setResults(data.users ?? []);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setResults([]);
      }
    }, 300);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  async function handleSend(username: string) {
    setSendingUsername(username);
    setMessage(null);
    const result = await onSendRequest(username);
    setMessage(
      result.ok ? `Friend request sent to @${username}.` : (result.error ?? "Something went wrong."),
    );
    setSendingUsername(null);
    if (result.ok) {
      setQuery("");
      setResults([]);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by username..."
          className="w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700"
        />
        {message && <p className="mt-1.5 text-xs text-zinc-400">{message}</p>}
        {results.length > 0 && (
          <ul className="mt-2 flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {results.map((user) => (
              <li key={user.id} className="flex items-center gap-3 py-2">
                <Avatar displayName={user.displayName} color={user.avatarColor} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{user.displayName}</p>
                  <p className="truncate text-xs text-zinc-400">@{user.username}</p>
                </div>
                <button
                  type="button"
                  disabled={sendingUsername === user.username}
                  onClick={() => handleSend(user.username)}
                  className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {sendingUsername === user.username ? "Sending..." : "Add"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {incoming.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            Incoming requests
          </p>
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {incoming.map(({ friendshipId, user }) => (
              <li key={friendshipId} className="flex items-center gap-3 py-2">
                <Avatar displayName={user.displayName} color={user.avatarColor} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{user.displayName}</p>
                  <p className="truncate text-xs text-zinc-400">@{user.username}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => onAccept(friendshipId)}
                    className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => onDecline(friendshipId)}
                    className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 dark:border-zinc-700"
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {outgoing.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            Outgoing requests
          </p>
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {outgoing.map(({ friendshipId, user }) => (
              <li key={friendshipId} className="flex items-center gap-3 py-2">
                <Avatar displayName={user.displayName} color={user.avatarColor} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{user.displayName}</p>
                  <p className="truncate text-xs text-zinc-400">@{user.username}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-zinc-400">Pending</span>
                  <button
                    type="button"
                    onClick={() => onDecline(friendshipId)}
                    className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 dark:border-zinc-700"
                  >
                    Cancel
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
