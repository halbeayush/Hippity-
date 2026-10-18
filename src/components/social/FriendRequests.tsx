import type { PendingRequest } from "@/lib/types";
import Avatar from "@/components/Avatar";

// Friend requests waiting on the current user — shown at the top of the
// Social tab, since they're half of what the tab's badge counts (see
// /api/social/notifications).
export default function FriendRequests({
  incoming,
  onAccept,
  onDecline,
}: {
  incoming: PendingRequest[];
  onAccept: (friendshipId: number) => Promise<void>;
  onDecline: (friendshipId: number) => Promise<void>;
}) {
  return (
    <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
      {incoming.map(({ friendshipId, user }) => (
        <li key={friendshipId} className="flex items-center gap-3 py-2">
          <Avatar displayName={user.displayName} color={user.avatarColor} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user.displayName}</p>
            <p className="truncate text-xs text-zinc-400">
              @{user.username} wants to be friends
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={() => onAccept(friendshipId)}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => onDecline(friendshipId)}
              className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 dark:border-zinc-700"
            >
              Decline
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
