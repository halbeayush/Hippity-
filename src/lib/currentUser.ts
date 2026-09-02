import { prisma } from "@/lib/prisma";

// The app has no login yet, so a single seeded row (see the
// add_social_features migration and prisma/seed.ts) stands in for whoever
// is using the app. Every API route that needs "the current user" goes
// through here so swapping in real auth later only touches this file.
export const CURRENT_USERNAME = "me";

let cachedUserId: number | null = null;

export async function getCurrentUserId(): Promise<number> {
  if (cachedUserId !== null) return cachedUserId;
  const user = await prisma.user.findUniqueOrThrow({
    where: { username: CURRENT_USERNAME },
    select: { id: true },
  });
  cachedUserId = user.id;
  return cachedUserId;
}
