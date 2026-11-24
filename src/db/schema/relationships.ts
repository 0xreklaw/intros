import {
  index,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import type { SocialPlatform } from "../../clients/types"
import { relationshipTypeEnum } from "./enums"
import { tenants } from "./tenants"
import { people } from "./people"

/** `owner` knows `target`, on one network, in one way. Each employee's network is their edges. */
export const relationshipEdges = pgTable(
  "relationship_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    ownerPersonId: uuid("owner_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    targetPersonId: uuid("target_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    platform: text("platform").$type<SocialPlatform>().notNull(),
    relationshipType: relationshipTypeEnum("relationship_type").notNull(),
    /** 0 to 1: how close the tie is. */
    strengthScore: real("strength_score").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_relation_owner").on(t.tenantId, t.ownerPersonId),
    index("idx_relation_target").on(t.tenantId, t.targetPersonId),
    uniqueIndex("uq_relation_edge").on(
      t.tenantId,
      t.ownerPersonId,
      t.targetPersonId,
      t.platform,
      t.relationshipType
    ),
  ]
)
