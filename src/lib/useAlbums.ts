"use client";

import { useCallback, useEffect, useState } from "react";
import { announceCoverAdded } from "@/lib/coverEvents";
import type { Album, SearchResult } from "@/lib/types";
import { apiFetch, readJson } from "@/lib/apiFetch";
import { albumVariantKey } from "@/lib/searchRelevance";

type Status = "queue" | "library";

// Enough of an album to tell whether it's already saved (see statusFor).
export type SavedAlbumKey = { mbid: string; artist: string; title: string };

// Shared by the Library and To-do pages: both list saved albums and both
// need to add/remove/rate/note them the same way the single-page app did.
export function useAlbums() {
  const [library, setLibrary] = useState<Album[]>([]);
  const [queue, setQueue] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLists = useCallback(async () => {
    const [libRes, queueRes] = await Promise.all([
      apiFetch("/api/albums?status=library"),
      apiFetch("/api/albums?status=queue"),
    ]);
    const libData = await readJson(libRes);
    const queueData = await readJson(queueRes);
    setLibrary(libData.albums ?? []);
    setQueue(queueData.albums ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadLists();
  }, [loadLists]);

  async function handleAddAlbum(result: SearchResult, status: Status) {
    await apiFetch("/api/albums", {
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
    await apiFetch(`/api/albums/${id}/listened`, { method: "POST" });
    // Marking as listened promotes the album into the Library.
    if (album) announceCoverAdded(album.coverArtUrl);
    await loadLists();
  }

  async function handleRemove(id: number, from: Status) {
    if (from === "queue") setQueue((q) => q.filter((a) => a.id !== id));
    else setLibrary((l) => l.filter((a) => a.id !== id));
    await apiFetch(`/api/albums/${id}`, { method: "DELETE" });
  }

  async function handleRate(id: number, rating: number) {
    setLibrary((l) => l.map((a) => (a.id === id ? { ...a, rating } : a)));
    await apiFetch(`/api/albums/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating }),
    });
  }

  async function handleNote(id: number, note: string) {
    setLibrary((l) => l.map((a) => (a.id === id ? { ...a, note } : a)));
    await apiFetch(`/api/albums/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
  }

  // Whether an album is already saved, and where. The same album carries a
  // different id depending on where it was found ("itunes:…" from search, a
  // MusicBrainz id from the home rows, "lastfm:…" from Recommended), so it's
  // matched by id or by artist + edition-stripped title — otherwise one
  // found a second way would offer "Add" again. Library wins over to-do.
  const byMbid = new Map<string, Status>();
  const byVariant = new Map<string, Status>();
  for (const album of [...queue, ...library]) {
    const status: Status = album.status === "library" ? "library" : "queue";
    byMbid.set(album.mbid, status);
    byVariant.set(albumVariantKey(album.artist, album.title), status);
  }
  const statusFor = (album: SavedAlbumKey): Status | undefined =>
    byMbid.get(album.mbid) ?? byVariant.get(albumVariantKey(album.artist, album.title));

  return {
    library,
    queue,
    loading,
    statusFor,
    handleAddAlbum,
    handleMarkListened,
    handleRemove,
    handleRate,
    handleNote,
  };
}
