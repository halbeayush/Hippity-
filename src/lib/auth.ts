import { PLACEHOLDER_USERNAME } from "./currentUser";
import { hashPassword, verifyPassword } from "./password";
import { prisma } from "./prisma";

// Account creation and sign-in. Two ways in, both ending in a session (see
// session.ts): username + password, and Google. They're separate accounts —
// a Google sign-in doesn't attach to an existing password account.

export const USERNAME_RULES =
  "3-20 characters: lowercase letters, numbers and underscores";
const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
export const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
const MAX_DISPLAY_NAME_LENGTH = 40;

type AuthResult<T> = { ok: true; user: T } | { ok: false; error: string };

type NewAccount = {
  username: string;
  displayName: string;
  passwordHash?: string;
  googleId?: string;
  email?: string;
};

// The very first account created takes over the pre-login placeholder user
// (and with it, everything saved before accounts existed — library, to-do
// list, friends, activity). Only while no one has signed up yet; after that,
// every account starts fresh.
async function claimPlaceholderOrCreate(data: NewAccount) {
  return prisma.$transaction(async (tx) => {
    const anyAccount = await tx.user.findFirst({
      where: { OR: [{ passwordHash: { not: null } }, { googleId: { not: null } }] },
      select: { id: true },
    });
    const placeholder = anyAccount
      ? null
      : await tx.user.findUnique({ where: { username: PLACEHOLDER_USERNAME } });
    return placeholder
      ? tx.user.update({ where: { id: placeholder.id }, data })
      : tx.user.create({ data });
  });
}

function cleanDisplayName(name: string | undefined, fallback: string): string {
  const trimmed = name?.trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
  return trimmed || fallback;
}

export async function signUpWithPassword(input: {
  username: string;
  password: string;
  displayName?: string;
}): Promise<AuthResult<{ id: number }>> {
  const username = input.username.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    return { ok: false, error: `Username must be ${USERNAME_RULES}.` };
  }
  if (
    input.password.length < MIN_PASSWORD_LENGTH ||
    input.password.length > MAX_PASSWORD_LENGTH
  ) {
    return {
      ok: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  const taken = await prisma.user.findUnique({ where: { username } });
  // The placeholder's own name is only free while it's still unclaimed —
  // claiming it under that name is the one case where it isn't "taken".
  const claimingPlaceholder =
    taken?.username === PLACEHOLDER_USERNAME && !taken.passwordHash && !taken.googleId;
  if (taken && !claimingPlaceholder) {
    return { ok: false, error: "That username is taken." };
  }

  const user = await claimPlaceholderOrCreate({
    username,
    displayName: cleanDisplayName(input.displayName, username),
    passwordHash: await hashPassword(input.password),
  });
  return { ok: true, user };
}

// Verifying against this when the username doesn't exist keeps a wrong
// username as slow as a wrong password, so timing doesn't reveal which
// usernames have accounts.
let dummyHash: Promise<string> | null = null;

export async function logInWithPassword(input: {
  username: string;
  password: string;
}): Promise<AuthResult<{ id: number }>> {
  const failure = { ok: false as const, error: "Incorrect username or password." };
  const user = await prisma.user.findUnique({
    where: { username: input.username.trim().toLowerCase() },
  });
  if (!user?.passwordHash) {
    dummyHash ??= hashPassword("not-a-real-password");
    await verifyPassword(input.password, await dummyHash);
    return failure;
  }
  return (await verifyPassword(input.password, user.passwordHash))
    ? { ok: true, user }
    : failure;
}

// A username for a new Google account, from the email's local part —
// "Jane.Doe@gmail.com" -> "janedoe", or "janedoe2" etc. if taken.
async function availableUsername(email: string | undefined): Promise<string> {
  const base =
    (email?.split("@")[0] ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 16)
      .padEnd(3, "0") || "user";
  for (let n = 0; ; n++) {
    const candidate = n === 0 ? base : `${base}${n + 1}`;
    if (!(await prisma.user.findUnique({ where: { username: candidate } }))) {
      return candidate;
    }
  }
}

export async function signInWithGoogle(profile: {
  googleId: string;
  email?: string;
  name?: string;
}): Promise<{ id: number }> {
  const existing = await prisma.user.findUnique({
    where: { googleId: profile.googleId },
  });
  if (existing) return existing;

  const username = await availableUsername(profile.email);
  return claimPlaceholderOrCreate({
    username,
    displayName: cleanDisplayName(profile.name, username),
    googleId: profile.googleId,
    email: profile.email,
  });
}
