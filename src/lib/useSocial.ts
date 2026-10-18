"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  FeedItem,
  FriendUser,
  PendingRequest,
  RecommendationEntry,
} from "@/lib/types";
import { apiFetch, readJson } from "@/lib/apiFetch";

// Fired after anything on the Social tab changes, so the tab's badge (see
// TopNav) recounts straight away instead of on its next poll.
export const SOCIAL_CHANGED_EVENT = "spinsheet:social-changed";

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
      apiFetch("/api/social/friends"),
      apiFetch("/api/social/activity"),
      apiFetch("/api/social/recommendations?box=incoming"),
    ]);
    const friendsData = await readJson(friendsRes);
    const activityData = await readJson(activityRes);
    const recsData = await readJson(recsRes);
    setFriends(friendsData.friends ?? []);
    setIncoming(friendsData.incoming ?? []);
    setOutgoing(friendsData.outgoing ?? []);
    setActivities(activityData.activities ?? []);
    setIncomingRecommendations(recsData.recommendations ?? []);
    setLoading(false);
    window.dispatchEvent(new Event(SOCIAL_CHANGED_EVENT));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFriends();
  }, [loadFriends]);

  async function sendRequest(username: string) {
    const res = await apiFetch("/api/social/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    const data = await readJson(res);
    if (!res.ok) return { ok: false as const, error: data.error as string };
    await loadFriends();
    return { ok: true as const };
  }

  async function acceptRequest(friendshipId: number) {
    await apiFetch(`/api/social/friends/${friendshipId}`, { method: "PATCH" });
    await loadFriends();
  }

  async function declineRequest(friendshipId: number) {
    await apiFetch(`/api/social/friends/${friendshipId}`, { method: "DELETE" });
    await loadFriends();
  }

  async function resolveRecommendation(
    recommendationId: number,
    action: "listened" | "reject",
  ) {
    setIncomingRecommendations((current) =>
      current.filter((r) => r.id !== recommendationId),
    );
    await apiFetch(`/api/social/recommendations/${recommendationId}`, {
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
