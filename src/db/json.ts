import { sql, type AnyColumn } from "drizzle-orm"

/**
 * An UPDATE value that merges `patch` into a jsonb column inside Postgres, so two writers that
 * touch different keys (a fetched profile, a written brief) cannot overwrite each other.
 */
export const mergeJson = (column: AnyColumn, patch: Record<string, unknown>) =>
  sql`coalesce(${column}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`
