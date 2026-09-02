import type { FeedItem } from "@/lib/types";
import { formatRelativeTime } from "@/lib/relativeTime";
import Avatar from "@/components/Avatar";
import CoverImage from "@/components/CoverImage";

function describe(item: FeedItem): string {
  if (item.kind === "recommendation") {
    const who = item.isRecipientViewer ? "you" : item.recipient.displayName;
    const pronoun = item.isRecipientViewer ? "you" : "they";
    const base = `${item.sender.displayName} recommended ${item.album.title} to ${who}`;
    if (item.status === "listened") return `${base} — ${pronoun} listened`;
    if (item.status === "rejected") return `${base} — ${pronoun} passed`;
    return base;
  }

  const name = item.user.displayName;
  switch (item.activityType) {
    case "rated":
      return `${name} rated ${item.album.title} ${item.rating} star${
        item.rating === 1 ? "" : "s"
      }`;
    case "added_todo":
      return `${name} added ${item.album.title} to their to-do list`;
    case "added_library":
    default:
      return `${name} added ${item.album.title} to their library`;
  }
}

export default function ActivityFeed({
  activities,
  emptyHint,
}: {
  activities: FeedItem[];
  emptyHint?: string;
}) {
  if (activities.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-zinc-400">
        {emptyHint ??
          "No friend activity yet. Add some friends to see what they're spinning."}
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
      {activities.map((item) => {
        const actor = item.kind === "recommendation" ? item.sender : item.user;
        return (
          <li key={`${item.kind}-${item.id}`} className="flex items-center gap-3 py-2.5">
            <Avatar
              displayName={actor.displayName}
              color={actor.avatarColor}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-zinc-700 dark:text-zinc-200">
                {describe(item)}
              </p>
              <p className="text-[11px] text-zinc-400">
                {formatRelativeTime(item.createdAt)}
              </p>
            </div>
            <div className="h-9 w-9 shrink-0">
              <CoverImage
                src={item.album.coverArtUrl}
                alt={`${item.album.title} cover art`}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
