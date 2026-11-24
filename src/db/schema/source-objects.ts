import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { tenants } from "./tenants"

/** A pointer to a raw API response kept in object storage. The body itself is not in Postgres. */
export const sourceObjects = pgTable(
  "source_objects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerId: text("provider_id").notNull(),
    objectKey: text("object_key").notNull(),
    contentHash: text("content_hash").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_source_objects_tenant").on(t.tenantId),
    uniqueIndex("uq_source_objects_provider").on(
      t.tenantId,
      t.provider,
      t.providerId
    ),
  ]
)
