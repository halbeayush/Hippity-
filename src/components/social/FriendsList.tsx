import Link from "next/link";
import type { FriendUser } from "@/lib/types";
import Avatar from "@/components/Avatar";

export default function FriendsList({ friends }: { friends: FriendUser[] }) {
  if (friends.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-zinc-400">
        No friends yet. Search for a username above to add one.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
      {friends.map((friend) => (
        <li key={friend.id}>
          <Link
            href={`/social/${friend.username}`}
            className="flex items-center gap-3 py-2.5 hover:opacity-80"
          >
            <Avatar displayName={friend.displayName} color={friend.avatarColor} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{friend.displayName}</p>
              <p className="truncate text-xs text-zinc-400">@{friend.username}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
