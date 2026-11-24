import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import pg from "pg"
import { env } from "../config"
import * as schema from "./schema/index"

const { Pool } = pg

// Next.js dev reloads modules often. Reuse one pool so connections are not leaked on every reload.
const globalForPool = globalThis as unknown as { __referPool?: pg.Pool }

function createPool(): pg.Pool {
  const created = new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })
  // An idle connection dropped by the server emits "error". Unhandled, it would crash the process.
  created.on("error", (err) => {
    console.error("[postgres] idle client error:", err.message)
  })
  return created
}

const pool = globalForPool.__referPool ?? createPool()
if (process.env.NODE_ENV !== "production") globalForPool.__referPool = pool

export const db = drizzle(pool, { schema })

export type Database = NodePgDatabase<typeof schema>

/** Run `fn` in one transaction with the tenant set, so row-level security applies to every query. */
export async function withTenant<T>(
  tenantId: string,
  fn: (database: Database) => Promise<T>
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [
      tenantId,
    ])
    const result = await fn(drizzle(client, { schema }))
    await client.query("COMMIT")
    return result
  } catch (err) {
    // If the connection itself is gone, the rollback fails too. Report the original error.
    await client.query("ROLLBACK").catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}
