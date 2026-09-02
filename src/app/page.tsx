"use client";

import HomeCarousel from "@/components/HomeCarousel";
import MusicNews from "@/components/MusicNews";
import TopNav from "@/components/TopNav";
import { useAlbums } from "@/lib/useAlbums";

export default function Home() {
  const { albumStatusByMbid, handleAddAlbum } = useAlbums();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-6">
      <TopNav />

      <div className="flex flex-col">
        <HomeCarousel
          title="New releases"
          apiPath="/api/home/new-releases"
          variant="new"
          albumStatusByMbid={albumStatusByMbid}
          onAdd={handleAddAlbum}
        />
        <HomeCarousel
          title="Upcoming albums"
          apiPath="/api/home/upcoming"
          variant="upcoming"
          albumStatusByMbid={albumStatusByMbid}
          onAdd={handleAddAlbum}
        />
        <MusicNews />
      </div>
    </div>
  );
}
