import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import {
  readSessionCookie,
  SESSION_COOKIE,
  signSessionCookie,
} from "./sessionCookie";

// Database sessions (see the Session model): the cookie carries a random
// token, the database stores only its hash. Signing out deletes the row,
// which ends that session everywhere immediately — something a cookie-only
// session can't do.
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await prisma.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, signSessionCookie(token, expiresAt), {
    httpOnly: true,
    // Plain http on localhost in dev; https everywhere else.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

// The signed-in user for this request, or null — the cookie must be validly
// signed *and* its session still present and unexpired in the database.
export async function getSessionUser() {
  const cookieStore = await cookies();
  const cookie = readSessionCookie(cookieStore.get(SESSION_COOKIE)?.value);
  if (!cookie) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(cookie.token) },
    include: { user: true },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  return session.user;
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const cookie = readSessionCookie(cookieStore.get(SESSION_COOKIE)?.value);
  if (cookie) {
    await prisma.session.deleteMany({
      where: { tokenHash: hashToken(cookie.token) },
    });
  }
  cookieStore.delete(SESSION_COOKIE);
}
