import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { tenants } from "./tenants"
import { people } from "./people"

/**
 * Cached LLM fit score for one person against one search. `queryHash` identifies the search
 * text (the default search or a custom one); `contextHash` identifies what we knew about the
 * person when it was scored, so new context makes the score stale.
 */
export const fitScores = pgTable(
  "fit_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    queryHash: text("query_hash").notNull(),
    contextHash: text("context_hash").notNull(),
    /** 0 to 100. */
    score: integer("score").notNull(),
    /** How sure the judge was given the facts it had: "high" or "low". */
    confidence: text("confidence")
      .$type<"high" | "low">()
      .notNull()
      .default("low"),
    reason: text("reason").notNull(),
    /** Who set the score: the first read of everyone ("llm") or the review agent ("agent"). */
    source: text("source").$type<"llm" | "agent">().notNull().default("llm"),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_fit_scores_person_query").on(
      t.tenantId,
      t.personId,
      t.queryHash
    ),
    index("idx_fit_scores_query").on(t.tenantId, t.queryHash),
  ]
)
