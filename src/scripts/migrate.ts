import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"
import { env } from "../config"

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")

async function main() {
  // Migrations run as the owner role. The app's own role is restricted by RLS.
  const pool = new pg.Pool({
    connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL,
  })
  try {
    console.log("Running migrations...")
    await migrate(drizzle(pool), {
      migrationsFolder: join(root, "drizzle"),
    })

    console.log("Applying row-level security...")
    await pool.query(readFileSync(join(root, "src/db/rls.sql"), "utf8"))

    console.log("Done.")
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
