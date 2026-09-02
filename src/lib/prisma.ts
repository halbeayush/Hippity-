import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

// Next.js reloads modules on every save in dev mode. Without this cache,
// each reload would create a brand new database connection and eventually
// exhaust SQLite's connection limit. Stashing the client on `globalThis`
// keeps one instance alive across reloads.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// better-sqlite3 wants a plain file path, not Prisma's "file:./dev.db" URL.
const adapter = new PrismaBetterSqlite3({
  url: (process.env.DATABASE_URL ?? "file:./dev.db").replace(/^file:/, ""),
});

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
