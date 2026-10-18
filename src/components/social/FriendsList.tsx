import Link from "next/link";
import type { FriendUser } from "@/lib/types";
import Avatar from "@/components/Avatar";

// Each friend is a card linking to their profile (library, to-do, top 5).
// The border, hover highlight, "View profile" label and arrow are there so
// it's obvious the whole card can be clicked.
export default function FriendsList({ friends }: { friends: FriendUser[] }) {
  if (friends.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-zinc-400">
        No friends yet. Search for a username below to add one.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {friends.map((friend) => (
        <li key={friend.id}>
          <Link
            href={`/social/${friend.username}`}
            title={`View ${friend.displayName}'s profile`}
            className="group flex items-center gap-3 rounded-xl border border-zinc-200 px-3 py-2.5 transition-colors hover:border-zinc-400 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/60"
          >
            <Avatar displayName={friend.displayName} color={friend.avatarColor} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium group-hover:underline">
                {friend.displayName}
              </p>
              <p className="truncate text-xs text-zinc-400">
                @{friend.username} · View profile
              </p>
            </div>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className="h-4 w-4 shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-600 dark:group-hover:text-zinc-200"
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
          </Link>
        </li>
      ))}
    </ul>
  );
}
