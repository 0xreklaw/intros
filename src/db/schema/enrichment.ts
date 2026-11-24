import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { tenants } from "./tenants"
import { people } from "./people"
import { companies } from "./companies"
import { sourceObjects } from "./source-objects"

/**
 * One row per paid external lookup (treg). Keeps the treg call id and cost so
 * spend can be reconciled against treg's ledger, and links to the raw response.
 */
export const enrichmentCalls = pgTable(
  "enrichment_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    personId: uuid("person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull().default("treg"),
    toolId: text("tool_id").notNull(),
    servedBy: text("served_by"),
    tregCallId: text("treg_call_id"),
    costMicro: integer("cost_micro").notNull().default(0),
    outcome: text("outcome").notNull(),
    error: text("error"),
    sourceObjectId: uuid("source_object_id").references(
      () => sourceObjects.id,
      {
        onDelete: "set null",
      }
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_enrichment_calls_tenant_created").on(t.tenantId, t.createdAt),
    index("idx_enrichment_calls_tenant_person").on(t.tenantId, t.personId),
  ]
)
