import { createHmac, timingSafeEqual } from "crypto";

// The session cookie's format, kept free of any database access so the
// proxy (src/proxy.ts) can check it on every request cheaply: the random
// session token, its expiry, and an HMAC over both with SESSION_SECRET.
// The proxy only checks the signature and expiry — an optimistic check, to
// send signed-out visitors to /login. Whether the session still exists (it
// may have been signed out) is checked against the database in session.ts,
// right where each API route reads the current user.
export const SESSION_COOKIE = "spinsheet_session";

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is not configured");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function signSessionCookie(token: string, expiresAt: Date): string {
  const payload = `${token}.${expiresAt.getTime()}`;
  return `${payload}.${sign(payload)}`;
}

// The token from a cookie that's correctly signed and not expired, else
// null.
export function readSessionCookie(
  value: string | undefined,
): { token: string; expiresAt: Date } | null {
  if (!value) return null;
  const [token, expiresMs, signature] = value.split(".");
  if (!token || !expiresMs || !signature) return null;

  const expected = Buffer.from(sign(`${token}.${expiresMs}`));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }

  const expiresAt = new Date(Number(expiresMs));
  if (!(expiresAt.getTime() > Date.now())) return null;
  return { token, expiresAt };
}
