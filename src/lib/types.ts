export type Album = {
  id: number;
  mbid: string;
  title: string;
  artist: string;
  coverArtUrl: string | null;
  status: string;
  rating: number | null;
  note: string | null;
  addedAt: string;
  listenedAt: string | null;
};

export type SearchResult = {
  mbid: string;
  title: string;
  artist: string;
  year: string | null;
  coverArtUrl: string;
  // iTunes-only signal (favors a real album over a same-titled single) —
  // absent/0 for MusicBrainz-sourced results. See searchRelevance.ts.
  trackCount?: number;
};

// The minimal shape needed to show an album's detail view, satisfied by
// both Album and SearchResult.
export type AlbumSummary = {
  mbid: string;
  title: string;
  artist: string;
  coverArtUrl: string | null;
};

export type Track = {
  disc: number;
  position: number;
  title: string;
  length: number | null;
};

// One album in a home page carousel row (New releases / Upcoming albums).
export type HomeAlbum = AlbumSummary & {
  releaseDate: string;
  // Upcoming albums only: an artist-photo/album-art fallback to show,
  // desaturated, when the release has no Cover Art Archive art yet.
  fallbackArtUrl?: string | null;
};

export type HomeAlbumPage = {
  albums: HomeAlbum[];
  hasMore: boolean;
};

export type NewsItem = {
  title: string;
  link: string;
  source: string;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  excerpt: string | null;
};

export type FriendUser = {
  id: number;
  username: string;
  displayName: string;
  avatarColor: string;
};

export type PendingRequest = {
  friendshipId: number;
  user: FriendUser;
};

export type ActivityType = "added_library" | "added_todo" | "rated";

// The Social/Home feed merges Activity rows and RecommendationSent rows
// into one chronological list — "kind" tells FeedList which shape it's
// looking at.
export type FeedAlbum = {
  title: string;
  artist: string;
  coverArtUrl: string | null;
};

export type ActivityFeedItem = {
  kind: "activity";
  id: number;
  activityType: ActivityType;
  rating: number | null;
  createdAt: string;
  user: FriendUser;
  album: FeedAlbum;
};

export type RecommendationStatus = "pending" | "rejected" | "listened";

export type RecommendationFeedItem = {
  kind: "recommendation";
  id: number;
  status: RecommendationStatus;
  createdAt: string;
  sender: FriendUser;
  recipient: FriendUser;
  // True when the current viewer is the recipient, so the UI can say "to
  // you" instead of the recipient's name.
  isRecipientViewer: boolean;
  album: FeedAlbum;
};

export type FeedItem = ActivityFeedItem | RecommendationFeedItem;

export type RecommendationEntry = {
  id: number;
  mbid: string;
  status: RecommendationStatus;
  createdAt: string;
  sender: FriendUser;
  recipient: FriendUser;
  album: FeedAlbum;
};

export type WeeklyTopTrack = {
  id: number;
  rank: number;
  trackName: string;
  artist: string;
  coverArtUrl: string | null;
};
