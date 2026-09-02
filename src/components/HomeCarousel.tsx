"use client";

import { useEffect, useState } from "react";
import type { HomeAlbum, SearchResult } from "@/lib/types";
import AlbumDetailModal from "./AlbumDetailModal";
import CoverImage from "./CoverImage";

type SaveStatus = "queue" | "library";

// Upcoming albums may not have Cover Art Archive art yet (they haven't been
// released). Tries the real cover first; if it 404s, shows a placeholder
// instead of a broken image or a generic stock graphic — the artist's most
// recent album art, desaturated, behind a "not yet revealed" label with the
// title/artist overlaid, replacing the normal cover+caption layout entirely
// so the text isn't shown twice. Once Cover Art Archive does get art for the
// release, the next data refresh picks it up automatically since this
// always tries the real URL first.
function UpcomingAlbumTile({ album }: { album: HomeAlbum }) {
  const [failed, setFailed] = useState(false);

  if (!album.coverArtUrl || failed) {
    return (
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-zinc-300 dark:bg-zinc-700">
        {album.fallbackArtUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={album.fallbackArtUrl}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-[2px] grayscale"
          />
        )}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/35 p-2 text-center">
          <span className="rounded-full bg-black/60 px-2 py-0.5 text-[8px] font-medium uppercase tracking-wide text-white">
            Artwork not yet revealed
          </span>
          <p className="line-clamp-2 text-xs font-semibold text-white drop-shadow">
            {album.title}
          </p>
          <p className="truncate text-[11px] text-white/80 drop-shadow">
            {album.artist}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={album.coverArtUrl}
        alt={`${album.title} cover art`}
        onError={() => setFailed(true)}
        className="aspect-square w-full rounded-lg object-cover"
      />
      <div>
        <p className="truncate text-xs font-medium">{album.title}</p>
        <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
          {album.artist}
        </p>
      </div>
    </>
  );
}

export default function HomeCarousel({
  title,
  apiPath,
  variant,
  albumStatusByMbid,
  onAdd,
}: {
  title: string;
  apiPath: string;
  variant: "new" | "upcoming";
  albumStatusByMbid: Record<string, SaveStatus>;
  onAdd: (result: SearchResult, status: SaveStatus) => Promise<void>;
}) {
  const [page, setPage] = useState(0);
  const [albums, setAlbums] = useState<HomeAlbum[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [detailAlbum, setDetailAlbum] = useState<HomeAlbum | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(false);

    fetch(`${apiPath}?page=${page}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error);
        setAlbums(data.albums ?? []);
        setHasMore(Boolean(data.hasMore));
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [apiPath, page]);

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          {title}
        </h2>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            aria-label={`Show previous ${title.toLowerCase()}`}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-200 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => (hasMore ? p + 1 : p))}
            disabled={!hasMore}
            aria-label={`Show more ${title.toLowerCase()}`}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-200 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            ›
          </button>
        </div>
      </div>

      {loading ? (
        <p className="py-6 text-center text-xs text-zinc-400">Loading...</p>
      ) : error ? (
        <p className="py-6 text-center text-xs text-zinc-400">
          Couldn&apos;t load these right now.
        </p>
      ) : albums.length === 0 ? (
        <p className="py-6 text-center text-xs text-zinc-400">
          Nothing to show right now.
        </p>
      ) : (
        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
          {albums.map((album) => (
            <button
              key={album.mbid}
              type="button"
              onClick={() => setDetailAlbum(album)}
              className="flex w-[42%] shrink-0 snap-start flex-col gap-2 text-left sm:w-[calc((100%-3rem)/5)]"
            >
              {variant === "upcoming" ? (
                <UpcomingAlbumTile album={album} />
              ) : (
                <>
                  <CoverImage
                    src={album.coverArtUrl}
                    alt={`${album.title} cover art`}
                  />
                  <div>
                    <p className="truncate text-xs font-medium">
                      {album.title}
                    </p>
                    <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                      {album.artist}
                    </p>
                  </div>
                </>
              )}
            </button>
          ))}
        </div>
      )}

      {detailAlbum && (
        <AlbumDetailModal
          album={detailAlbum}
          status={albumStatusByMbid[detailAlbum.mbid]}
          onAdd={(status) =>
            onAdd(
              {
                mbid: detailAlbum.mbid,
                title: detailAlbum.title,
                artist: detailAlbum.artist,
                year: detailAlbum.releaseDate.slice(0, 4),
                coverArtUrl: detailAlbum.coverArtUrl ?? "",
              },
              status,
            )
          }
          onClose={() => setDetailAlbum(null)}
        />
      )}
    </section>
  );
}
