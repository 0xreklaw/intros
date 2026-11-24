import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import type { SearchBrief } from "../../intelligence/search-brief"
import { tenants } from "./tenants"

export const searchBriefs = pgTable(
  "search_briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    queryHash: text("query_hash").notNull(),
    query: text("query").notNull(),
    brief: jsonb("brief").$type<SearchBrief>().notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("uq_search_briefs_query").on(t.tenantId, t.queryHash)]
)
