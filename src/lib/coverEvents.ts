const COVER_ADDED_EVENT = "spinsheet:cover-added";

// Lets any component announce a newly-saved cover so the floating background
// (mounted once in the root layout, outside the pages that add albums) can
// pick it up immediately instead of waiting for its own next fetch.
export function announceCoverAdded(coverArtUrl: string | null) {
  if (!coverArtUrl) return;
  window.dispatchEvent(
    new CustomEvent<string>(COVER_ADDED_EVENT, { detail: coverArtUrl }),
  );
}

export function onCoverAdded(handler: (coverArtUrl: string) => void) {
  const listener = (event: Event) => {
    handler((event as CustomEvent<string>).detail);
  };
  window.addEventListener(COVER_ADDED_EVENT, listener);
  return () => window.removeEventListener(COVER_ADDED_EVENT, listener);
}
