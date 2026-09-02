"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  FeedItem,
  FriendUser,
  PendingRequest,
  RecommendationEntry,
} from "@/lib/types";

export function useSocial() {
  const [friends, setFriends] = useState<FriendUser[]>([]);
  const [incoming, setIncoming] = useState<PendingRequest[]>([]);
  const [outgoing, setOutgoing] = useState<PendingRequest[]>([]);
  const [activities, setActivities] = useState<FeedItem[]>([]);
  const [incomingRecommendations, setIncomingRecommendations] = useState<
    RecommendationEntry[]
  >([]);
  const [loading, setLoading] = useState(true);

  const loadFriends = useCallback(async () => {
    const [friendsRes, activityRes, recsRes] = await Promise.all([
      fetch("/api/social/friends"),
      fetch("/api/social/activity"),
      fetch("/api/social/recommendations?box=incoming"),
    ]);
    const friendsData = await friendsRes.json();
    const activityData = await activityRes.json();
    const recsData = await recsRes.json();
    setFriends(friendsData.friends ?? []);
    setIncoming(friendsData.incoming ?? []);
    setOutgoing(friendsData.outgoing ?? []);
    setActivities(activityData.activities ?? []);
    setIncomingRecommendations(recsData.recommendations ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFriends();
  }, [loadFriends]);

  async function sendRequest(username: string) {
    const res = await fetch("/api/social/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false as const, error: data.error as string };
    await loadFriends();
    return { ok: true as const };
  }

  async function acceptRequest(friendshipId: number) {
    await fetch(`/api/social/friends/${friendshipId}`, { method: "PATCH" });
    await loadFriends();
  }

  async function declineRequest(friendshipId: number) {
    await fetch(`/api/social/friends/${friendshipId}`, { method: "DELETE" });
    await loadFriends();
  }

  async function resolveRecommendation(
    recommendationId: number,
    action: "listened" | "reject",
  ) {
    setIncomingRecommendations((current) =>
      current.filter((r) => r.id !== recommendationId),
    );
    await fetch(`/api/social/recommendations/${recommendationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    await loadFriends();
  }

  return {
    friends,
    incoming,
    outgoing,
    activities,
    incomingRecommendations,
    loading,
    sendRequest,
    acceptRequest,
    declineRequest,
    resolveRecommendation,
  };
}
