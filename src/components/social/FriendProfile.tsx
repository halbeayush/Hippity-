"use client";

import { useEffect, useState } from "react";
import AlbumCard from "@/components/AlbumCard";
import AlbumDetailModal from "@/components/AlbumDetailModal";
import Avatar from "@/components/Avatar";
import QueueCard from "@/components/QueueCard";
import RecommendPanel from "@/components/social/RecommendPanel";
import WeeklyTopTracksChart from "@/components/social/WeeklyTopTracksChart";
import type { Album, FriendUser } from "@/lib/types";
import { useAlbums } from "@/lib/useAlbums";
import { useFriendAlbums } from "@/lib/useFriendAlbums";

export default function FriendProfile({ username }: { username: string }) {
  const [profile, setProfile] = useState<FriendUser | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [detailAlbum, setDetailAlbum] = useState<Album | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/social/profile/${encodeURIComponent(username)}`)
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (res.status === 404) return setNotFound(true);
        if (res.status === 403) return setForbidden(true);
        setProfile(data.user);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  const { library, queue, loading } = useFriendAlbums(profile?.id ?? null);
  // The friend's own view is read-only, but tapping into an album detail
  // still lets *you* save it to your own lists — same as Library/To-do.
  const { albumStatusByMbid, handleAddAlbum } = useAlbums();

  if (notFound) {
    return (
      <EmptyState message="User not found." hint="Double check the username." />
    );
  }
  if (forbidden) {
    return (
      <EmptyState
        message="You're not friends with this user yet."
        hint="Send them a friend request from the Social tab first."
      />
    );
  }
  if (!profile) {
    return <p className="py-16 text-center text-sm text-zinc-400">Loading...</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-3">
        <Avatar displayName={profile.displayName} color={profile.avatarColor} size="lg" />
        <div>
          <p className="text-lg font-semibold">{profile.displayName}</p>
          <p className="text-sm text-zinc-400">@{profile.username}</p>
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Recommend an album</h2>
        <RecommendPanel
          friendUsername={profile.username}
          friendDisplayName={profile.displayName}
        />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">This week&apos;s top 5</h2>
        <WeeklyTopTracksChart userId={profile.id} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Library</h2>
        {loading ? (
          <p className="py-6 text-center text-xs text-zinc-400">Loading...</p>
        ) : library.length === 0 ? (
          <p className="py-6 text-center text-xs text-zinc-400">
            Nothing in their library yet.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4">
            {library.map((album) => (
              <AlbumCard
                key={album.id}
                album={album}
                onOpenDetail={() => setDetailAlbum(album)}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">To-do</h2>
        {loading ? (
          <p className="py-6 text-center text-xs text-zinc-400">Loading...</p>
        ) : queue.length === 0 ? (
          <p className="py-6 text-center text-xs text-zinc-400">
            Nothing on their to-do list yet.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4">
            {queue.map((album) => (
              <QueueCard
                key={album.id}
                album={album}
                onOpenDetail={() => setDetailAlbum(album)}
              />
            ))}
          </div>
        )}
      </section>

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
