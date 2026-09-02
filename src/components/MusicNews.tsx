"use client";

import { useEffect, useState } from "react";
import { formatRelativeTime } from "@/lib/relativeTime";
import type { NewsItem } from "@/lib/types";

export default function MusicNews() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/home/music-news", { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error);
        setItems(data.items ?? []);
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
        Music news
      </h2>

      {loading ? (
        <p className="py-6 text-center text-xs text-zinc-400">Loading...</p>
      ) : error ? (
        <p className="py-6 text-center text-xs text-zinc-400">
          Couldn&apos;t load music news right now.
        </p>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-xs text-zinc-400">
          Nothing to show right now.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {items.map((item) => (
            <li key={item.link}>
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 py-2.5 hover:opacity-80"
              >
                {item.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbnailUrl}
                    alt=""
                    aria-hidden
                    className="h-12 w-12 shrink-0 rounded-lg object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <div
                    aria-hidden
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      className="h-5 w-5"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4 5h16M4 12h16M4 19h10"
                      />
                    </svg>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {item.title}
                  </p>
                  {item.excerpt && (
                    <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {item.excerpt}
                    </p>
                  )}
                  <p className="mt-0.5 text-[11px] text-zinc-400">
                    {item.source}
                    {item.publishedAt &&
                      ` · ${formatRelativeTime(item.publishedAt)}`}
                  </p>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
