import { getSessionUser } from "@/lib/session";

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
// this mainly catches a session that was signed out elsewhere.
export async function getCurrentUserId(): Promise<number> {
  const user = await getSessionUser();
  if (!user) throw new NotSignedInError();
  return user.id;
}
