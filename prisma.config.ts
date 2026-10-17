// Loads .env for local CLI runs (migrate, seed, studio). On Vercel the
// variables come from the project settings and there is no .env file.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations need a direct (unpooled) connection: Neon's pooler doesn't
    // support the session-level locks `prisma migrate` takes. Falls back to
    // DATABASE_URL when no separate direct URL is set.
    url: process.env["DATABASE_URL_UNPOOLED"] ?? process.env["DATABASE_URL"],
  },
});
