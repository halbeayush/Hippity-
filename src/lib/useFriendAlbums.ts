"use client";

import { useCallback, useEffect, useState } from "react";
import type { Album } from "@/lib/types";

// Read-only counterpart to useAlbums, for viewing a friend's Library and
// To-do list (via the same /api/albums endpoint, scoped by userId).
export function useFriendAlbums(userId: number | null) {
  const [library, setLibrary] = useState<Album[]>([]);
  const [queue, setQueue] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (userId === null) return;
    setLoading(true);
    setError(false);
    try {
      const [libRes, queueRes] = await Promise.all([
        fetch(`/api/albums?status=library&userId=${userId}`),
        fetch(`/api/albums?status=queue&userId=${userId}`),
      ]);
      if (!libRes.ok || !queueRes.ok) throw new Error("Failed to load");
      const libData = await libRes.json();
      const queueData = await queueRes.json();
      setLibrary(libData.albums ?? []);
      setQueue(queueData.albums ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { library, queue, loading, error };
}
