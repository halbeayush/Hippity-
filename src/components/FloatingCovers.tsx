"use client";

import { useEffect, useState } from "react";
import { onCoverAdded } from "@/lib/coverEvents";

type FloatingCover = {
  id: string;
  src: string;
  top: number;
  left: number;
  size: number;
  duration: number;
  delay: number;
  drift: number;
  rotate: number;
};

// A 7x4 grid gives us 28 slots, tiled across the whole viewport instead of
// scattered purely at random (which tends to clump). The user's own covers
// are looped through this grid via modulo, however few there are, so even
// one saved album densely fills the background.
const GRID_COLS = 7;
const GRID_ROWS = 4;
const COVER_COUNT = GRID_COLS * GRID_ROWS;
const MAX_COVERS = COVER_COUNT + 8;

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

// Shuffle so repeated pool entries don't consistently land in the same
// grid cells relative to each other.
function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function makeGridCover(src: string, cellIndex: number): FloatingCover {
  const col = cellIndex % GRID_COLS;
  const row = Math.floor(cellIndex / GRID_COLS);
  const cellW = 100 / GRID_COLS;
  const cellH = 100 / GRID_ROWS;
  const jitterW = cellW * 0.7;
  const jitterH = cellH * 0.7;

  return {
    id: `${src}-${cellIndex}-${Math.random().toString(36).slice(2)}`,
    src,
    top: row * cellH + cellH / 2 + randomBetween(-jitterH, jitterH) / 2,
    left: col * cellW + cellW / 2 + randomBetween(-jitterW, jitterW) / 2,
    size: randomBetween(56, 132),
    duration: randomBetween(18, 40),
    delay: randomBetween(-30, 0),
    drift: randomBetween(20, 40),
    rotate: randomBetween(-12, 12),
  };
}

function makeFreeCover(src: string): FloatingCover {
  return {
    id: `${src}-free-${Math.random().toString(36).slice(2)}`,
    src,
    top: Math.random() * 100,
    left: Math.random() * 100,
    size: randomBetween(56, 132),
    duration: randomBetween(18, 40),
    delay: randomBetween(-30, 0),
    drift: randomBetween(20, 40),
    rotate: randomBetween(-12, 12),
  };
}

function buildGrid(pool: string[]): FloatingCover[] {
  const cells = shuffled(Array.from({ length: COVER_COUNT }, (_, i) => i));
  return cells.map((cellIndex, i) =>
    makeGridCover(pool[i % pool.length], cellIndex),
  );
}

// Decorative, non-interactive backdrop shown behind every page. Only shows
// covers the user has actually added to their Library — repeated as many
// times as needed to densely fill the grid — and renders nothing at all
// (a plain background) once the Library is empty.
export default function FloatingCovers() {
  const [covers, setCovers] = useState<FloatingCover[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const res = await fetch("/api/albums?status=library");
      const data = await res.json();
      const urls = (data.albums ?? [])
        .map((a: { coverArtUrl: string | null }) => a.coverArtUrl)
        .filter((url: string | null): url is string => Boolean(url));

      if (cancelled) return;

      const uniqueUrls = Array.from(new Set(urls)) as string[];
      setCovers(uniqueUrls.length > 0 ? buildGrid(uniqueUrls) : []);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Newly-added library albums join the animation immediately instead of
  // waiting for this component's next fetch (it's mounted once in the root
  // layout and doesn't remount on client-side navigation).
  useEffect(() => {
    return onCoverAdded((coverArtUrl) => {
      setCovers((prev) => {
        const next = [...prev, makeFreeCover(coverArtUrl)];
        return next.length > MAX_COVERS
          ? next.slice(next.length - MAX_COVERS)
          : next;
      });
    });
  }, []);

  if (covers.length === 0) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      {covers.map((cover) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={cover.id}
          src={cover.src}
          alt=""
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
          className="absolute rounded-lg object-cover opacity-[0.18] blur-[1px] dark:opacity-[0.13]"
          style={{
            top: `${cover.top}%`,
            left: `${cover.left}%`,
            width: cover.size,
            height: cover.size,
            animation: `float-cover ${cover.duration}s ease-in-out ${cover.delay}s infinite`,
            // @ts-expect-error custom property consumed by the keyframes
            "--drift": `${cover.drift}px`,
            "--rotate": `${cover.rotate}deg`,
          }}
        />
      ))}
    </div>
  );
}
