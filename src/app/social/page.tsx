"use client";

import ActivityFeed from "@/components/social/ActivityFeed";
import AddFriendPanel from "@/components/social/AddFriendPanel";
import FriendRequests from "@/components/social/FriendRequests";
import FriendsList from "@/components/social/FriendsList";
import IncomingRecommendations from "@/components/social/IncomingRecommendations";
import WeeklyTopTracksChart from "@/components/social/WeeklyTopTracksChart";
import TopNav from "@/components/TopNav";
import { useSocial } from "@/lib/useSocial";

export default function SocialPage() {
  const {
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
  } = useSocial();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-6">
      <TopNav />

      {loading ? (
        <p className="py-16 text-center text-sm text-zinc-400">Loading...</p>
      ) : (
        <div className="flex flex-col gap-8">
          {/* What's waiting on you comes first — it's what the Social tab's
              badge is counting. */}
          {incoming.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold">
                Friend requests
                <span className="font-normal text-zinc-400"> · {incoming.length}</span>
              </h2>
              <FriendRequests
                incoming={incoming}
                onAccept={acceptRequest}
                onDecline={declineRequest}
              />
            </section>
          )}

          <section>
            <h2 className="mb-3 text-sm font-semibold">
              Recommended to you
              {incomingRecommendations.length > 0 && (
                <span className="font-normal text-zinc-400">
                  {" "}
                  · {incomingRecommendations.length}
                </span>
              )}
            </h2>
            <IncomingRecommendations
              recommendations={incomingRecommendations}
              onResolve={resolveRecommendation}
            />
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold">Activity</h2>
            <ActivityFeed activities={activities} />
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold">Your weekly top 5</h2>
            <WeeklyTopTracksChart />
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold">Add a friend</h2>
            <AddFriendPanel
              outgoing={outgoing}
              onSendRequest={sendRequest}
              onCancel={declineRequest}
            />
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold">Friends</h2>
            <FriendsList friends={friends} />
          </section>
        </div>
      )}
    </div>
  );
}
