"use client";

import { useState } from "react";

export const COVER_LOADING_CLASS =
  "animate-pulse bg-zinc-200 dark:bg-zinc-800";

// Not every release has cover art on the Cover Art Archive, so the image
// request can 404. This swaps in a plain placeholder instead of a broken
// image icon when that happens.
export default function CoverImage({
  src,
  alt,
}: {
  src: string | null;
  alt: string;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (!src || failed) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-10 w-10"
        >
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </div>
    );
  }

  return (
    // While the cover is still being looked up (see lazyArtworkUrl), a
    // pulsing tile fills the square instead of a blank gap.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      className={`aspect-square w-full rounded-lg object-cover ${
        loaded ? "" : COVER_LOADING_CLASS
      }`}
    />
  );
}
