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
        // Two columns on wide screens: the feed on the left, people on the
        // right (kept in view while scrolling). On a phone the people column
        // stacks first, so friend requests — half of what the Social tab's
        // badge counts — are still the first thing on the page.
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
          <aside className="flex flex-col gap-8 lg:sticky lg:top-6 lg:order-last lg:w-80 lg:shrink-0">
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
                Friends
                {friends.length > 0 && (
                  <span className="font-normal text-zinc-400"> · {friends.length}</span>
                )}
              </h2>
              <FriendsList friends={friends} />
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold">Add a friend</h2>
              <AddFriendPanel
                outgoing={outgoing}
                onSendRequest={sendRequest}
                onCancel={declineRequest}
              />
            </section>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col gap-8">
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
          </div>
        </div>
      )}
    </div>
  );
}
