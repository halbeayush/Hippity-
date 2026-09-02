import Link from "next/link";
import FriendProfile from "@/components/social/FriendProfile";
import TopNav from "@/components/TopNav";

export default async function FriendProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-6">
      <TopNav />
      <Link
        href="/social"
        className="mb-4 self-start text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
      >
        ← Back to Social
      </Link>
      <FriendProfile username={username} />
    </div>
  );
}
