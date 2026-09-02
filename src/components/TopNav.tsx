"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SVGProps } from "react";

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

export default function TopNav() {
  const pathname = usePathname();

  return (
    <nav className="mb-6 flex gap-1 rounded-xl bg-zinc-100/90 p-1.5 text-sm font-medium backdrop-blur dark:bg-zinc-800/90">
      {NAV_ITEMS.map(({ href, label, Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-1 rounded-lg px-2 py-2 transition-colors duration-150 sm:flex-row sm:justify-center sm:gap-1.5 ${
              active
                ? "bg-white font-bold text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
                : "text-zinc-500 hover:bg-white/60 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900/50 dark:hover:text-zinc-200"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="text-[11px] sm:text-sm">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
