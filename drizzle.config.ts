import { defineConfig } from "drizzle-kit"
import { env } from "./src/config"

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL },
  strict: true,
  verbose: true,
})
