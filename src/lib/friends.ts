import { prisma } from "@/lib/prisma";

export async function getFriendIds(userId: number): Promise<number[]> {
  const friendships = await prisma.friendship.findMany({
    where: {
      status: "accepted",
      OR: [{ requesterId: userId }, { recipientId: userId }],
    },
    select: { requesterId: true, recipientId: true },
  });
  return friendships.map((f) =>
    f.requesterId === userId ? f.recipientId : f.requesterId,
  );
}

export async function areFriends(
  userIdA: number,
  userIdB: number,
): Promise<boolean> {
  if (userIdA === userIdB) return true;
  const friendship = await prisma.friendship.findFirst({
    where: {
      status: "accepted",
      OR: [
        { requesterId: userIdA, recipientId: userIdB },
        { requesterId: userIdB, recipientId: userIdA },
      ],
    },
    select: { id: true },
  });
  return friendship !== null;
}
