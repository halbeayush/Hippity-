"use client";

import { useCallback, useEffect, useState } from "react";
import { announceCoverAdded } from "@/lib/coverEvents";
import type { Album, SearchResult } from "@/lib/types";

type Status = "queue" | "library";

// Shared by the Library and To-do pages: both list saved albums and both
// need to add/remove/rate/note them the same way the single-page app did.
export function useAlbums() {
  const [library, setLibrary] = useState<Album[]>([]);
  const [queue, setQueue] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLists = useCallback(async () => {
    const [libRes, queueRes] = await Promise.all([
      fetch("/api/albums?status=library"),
      fetch("/api/albums?status=queue"),
    ]);
    const libData = await libRes.json();
    const queueData = await queueRes.json();
    setLibrary(libData.albums ?? []);
    setQueue(queueData.albums ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadLists();
  }, [loadLists]);

  async function handleAddAlbum(result: SearchResult, status: Status) {
    await fetch("/api/albums", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...result, status }),
    });
    // The floating background only shows Library covers, not the to-do list.
    if (status === "library") announceCoverAdded(result.coverArtUrl);
    await loadLists();
  }

  async function handleMarkListened(id: number) {
    const album = queue.find((a) => a.id === id);
    setQueue((q) => q.filter((a) => a.id !== id));
    await fetch(`/api/albums/${id}/listened`, { method: "POST" });
    // Marking as listened promotes the album into the Library.
    if (album) announceCoverAdded(album.coverArtUrl);
    await loadLists();
  }

  async function handleRemove(id: number, from: Status) {
    if (from === "queue") setQueue((q) => q.filter((a) => a.id !== id));
    else setLibrary((l) => l.filter((a) => a.id !== id));
    await fetch(`/api/albums/${id}`, { method: "DELETE" });
  }

  async function handleRate(id: number, rating: number) {
    setLibrary((l) => l.map((a) => (a.id === id ? { ...a, rating } : a)));
    await fetch(`/api/albums/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating }),
    });
  }

  async function handleNote(id: number, note: string) {
    setLibrary((l) => l.map((a) => (a.id === id ? { ...a, note } : a)));
    await fetch(`/api/albums/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
  }

  const albumStatusByMbid: Record<string, Status> = {};
  for (const album of queue) albumStatusByMbid[album.mbid] = "queue";
  for (const album of library) albumStatusByMbid[album.mbid] = "library";

  return {
    library,
    queue,
    loading,
    albumStatusByMbid,
    handleAddAlbum,
    handleMarkListened,
    handleRemove,
    handleRate,
    handleNote,
  };
}
