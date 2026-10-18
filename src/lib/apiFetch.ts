// fetch() for this app's own API, used by every client component and hook
// in place of plain fetch. A 401 means the session is gone even though the
// browser still has a cookie for it (signed out on another device, or the
// database was reset) — the proxy only checks the cookie itself, so the
// page loaded but its data can't. Rather than let each caller render a
// half-broken page, sign out properly and go to /login.
//
// Left alone: /api/auth/*, where a 401 is an expected answer (e.g. the nav
// bar asking /api/auth/me who's signed in), and anything on /login itself,
// where nobody is signed in by definition — the backdrop (FloatingCovers)
// still asks for Library covers there, and its caller handles the 401.
export async function apiFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(input, init);
  if (
    res.status === 401 &&
    !input.startsWith("/api/auth/") &&
    window.location.pathname !== "/login"
  ) {
    signOutStaleSession();
    // Never settles: the page is about to go to /login, and resolving would
    // only have the caller render an error or an empty list first.
    return new Promise<Response>(() => {});
  }
  return res;
}

let signingOut = false;

function signOutStaleSession() {
  // Several requests usually fail together (a page loads more than one
  // thing); only the first needs to act.
  if (signingOut) return;
  signingOut = true;

  const { pathname, search } = window.location;
  const login =
    pathname === "/" ? "/login" : `/login?next=${encodeURIComponent(pathname + search)}`;
  // Clears the stale cookie (the 401 already asked the browser to; this
  // makes sure), then a full page load so nothing from the old session
  // stays on screen — the same as logging out from the nav bar.
  fetch("/api/auth/logout", { method: "POST" })
    .catch(() => {})
    .finally(() => window.location.replace(login));
}

// res.json(), but an empty object when the body isn't JSON (e.g. an empty
// 500 or a host's HTML error page), so callers fall through to their usual
// `data.x ?? default` / `!res.ok` handling instead of throwing "Unexpected
// end of JSON input".
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJson(res: Response): Promise<any> {
  return res.json().catch(() => ({}));
}
