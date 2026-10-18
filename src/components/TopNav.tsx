"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type SVGProps } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { SOCIAL_CHANGED_EVENT } from "@/lib/useSocial";
import Avatar from "./Avatar";

function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="m3 10 9-7 9 7" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </svg>
  );
}

function LibraryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function TodoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="m3.5 6 1.5 1.5L7.5 5" />
      <path d="M11 6h10" />
      <path d="m3.5 12 1.5 1.5 2.5-2.5" />
      <path d="M11 12h10" />
      <path d="m3.5 18 1.5 1.5 2.5-2.5" />
      <path d="M11 18h10" />
    </svg>
  );
}

function RecommendedIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="m12 2.5 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3 1.1-6.5-4.7-4.6 6.5-.9Z" />
    </svg>
  );
}

function SocialIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="9" cy="8" r="3.25" />
      <path d="M2.75 20.5v-.75a5.75 5.75 0 0 1 5.75-5.75h1a5.75 5.75 0 0 1 5.75 5.75v.75" />
      <circle cx="17.5" cy="8.5" r="2.5" />
      <path d="M15.75 14.25c2.9.2 4.75 1.9 4.75 5v1.25" />
    </svg>
  );
}

const NAV_ITEMS = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/library", label: "Library", Icon: LibraryIcon },
  { href: "/todo", label: "To-do", Icon: TodoIcon },
  { href: "/recommended", label: "Recommended", Icon: RecommendedIcon },
  { href: "/social", label: "Social", Icon: SocialIcon },
] as const;

type Me = { username: string; displayName: string; avatarColor: string };

// Who's signed in, with a way to sign out. Signing out is a full page load
// to /login, so nothing from this account stays on screen.
function AccountMenu() {
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setMe(data?.user ?? null))
      .catch(() => {});
  }, []);

  async function logOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    // Deliberately a full page load, not router.push — see above.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }

  if (!me) return null;
  return (
    <div className="relative flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Account: ${me.displayName}`}
        className="flex items-center rounded-lg px-2 hover:bg-white/60 dark:hover:bg-zinc-900/50"
      >
        <Avatar displayName={me.displayName} color={me.avatarColor} size="sm" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-48 rounded-xl bg-white p-2 text-sm shadow-lg dark:bg-zinc-900">
          <p className="truncate px-2 pt-1 font-medium">{me.displayName}</p>
          <p className="truncate px-2 pb-2 text-xs text-zinc-500">@{me.username}</p>
          <button
            type="button"
            onClick={logOut}
            className="w-full rounded-lg px-2 py-1.5 text-left text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

const BADGE_POLL_MS = 60_000;

// How many friend requests and recommended albums are waiting on the
// signed-in user (see /api/social/notifications). Rechecked on every page
// change, when the browser tab regains focus, right after anything changes
// on the Social tab, and once a minute while the page is visible.
function useSocialBadgeCount(pathname: string): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    function load() {
      apiFetch("/api/social/notifications")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!cancelled && data) {
            setCount((data.friendRequests ?? 0) + (data.recommendations ?? 0));
          }
        })
        .catch(() => {});
    }
    function loadIfVisible() {
      if (document.visibilityState === "visible") load();
    }

    load();
    const interval = setInterval(loadIfVisible, BADGE_POLL_MS);
    window.addEventListener("focus", load);
    window.addEventListener(SOCIAL_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", load);
      window.removeEventListener(SOCIAL_CHANGED_EVENT, load);
    };
  }, [pathname]);

  return count;
}

export default function TopNav() {
  const pathname = usePathname();
  const socialBadge = useSocialBadgeCount(pathname);

  return (
    <nav className="mb-6 flex gap-1 rounded-xl bg-zinc-100/90 p-1.5 text-sm font-medium backdrop-blur dark:bg-zinc-800/90">
      {NAV_ITEMS.map(({ href, label, Icon }) => {
        const active = pathname === href;
        const badge = href === "/social" ? socialBadge : 0;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            aria-label={badge > 0 ? `${label}, ${badge} waiting` : undefined}
            className={`flex flex-1 flex-col items-center gap-1 rounded-lg px-2 py-2 transition-colors duration-150 sm:flex-row sm:justify-center sm:gap-1.5 ${
              active
                ? "bg-white font-bold text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
                : "text-zinc-500 hover:bg-white/60 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900/50 dark:hover:text-zinc-200"
            }`}
          >
            <span className="relative shrink-0">
              <Icon className="h-4 w-4" />
              {badge > 0 && (
                <span className="absolute -right-2.5 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-zinc-100 dark:ring-zinc-800">
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </span>
            <span className="text-[11px] sm:text-sm">{label}</span>
          </Link>
        );
      })}
      <AccountMenu />
    </nav>
  );
}
