import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Next.js reloads modules on every save in dev mode. Without this cache,
// each reload would create a brand new connection pool and eventually
// exhaust the database's connection limit. Stashing the client on
// `globalThis` keeps one instance alive across reloads.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// DATABASE_URL is Neon's pooled connection string (host contains
// "-pooler"), which suits serverless functions that each open their own
// connections. Migrations use the direct one instead — see prisma.config.ts.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
