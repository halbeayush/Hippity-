import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { SESSION_COOKIE } from "@/lib/sessionCookie";

// Before accounts existed, this seeded row stood in for whoever was using
// the app. It's still what the seed script fills in as "you", and the first
// account created claims it (see claimPlaceholderOrCreate in auth.ts), so
// nothing saved before login existed is lost.
export const PLACEHOLDER_USERNAME = "me";

export class NotSignedInError extends Error {
  constructor() {
    super("Not signed in");
  }
}

// Every API route that needs "the current user" goes through here — the
// signed-in user's id, from their session (see session.ts). Throws
// NotSignedInError when there's no valid session; the proxy already turns
// most of those away with a 401 before a route runs (see src/proxy.ts), so
// this mainly catches a cookie whose session is gone: signed out elsewhere,
// or from a database that has since been reset. Routes that call this are
// wrapped in withSignIn, which turns the error into a 401.
export async function getCurrentUserId(): Promise<number> {
  const user = await getSessionUser();
  if (!user) throw new NotSignedInError();
  return user.id;
}

// Wraps an API route handler so a NotSignedInError thrown anywhere inside
// it answers 401 JSON — the same response the proxy gives a signed-out
// request — instead of a 500. The response also clears the cookie, which no
// longer matches any session, so the next page load goes to /login.
export function withSignIn<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (!(err instanceof NotSignedInError)) throw err;
      const response = NextResponse.json({ error: "Not signed in" }, { status: 401 });
      response.cookies.delete(SESSION_COOKIE);
      return response;
    }
  };
}
