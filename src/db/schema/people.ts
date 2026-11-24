import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { identityProviderEnum } from "./enums"
import { tenants } from "./tenants"
import { companies } from "./companies"

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Set for a client's employees. */
    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    name: text("name"),
    title: text("title"),
    summary: text("summary"),
    /** Fetched profile, location, country, written profile and similar. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_people_tenant_company").on(t.tenantId, t.companyId),
    index("idx_people_tenant_name").on(t.tenantId, t.name),
  ]
)

/** One account of a person on a network. The same account is never two people. */
export const personIdentities = pgTable(
  "person_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    provider: identityProviderEnum("provider").notNull(),
    providerId: text("provider_id").notNull(),
    handle: text("handle"),
    url: text("url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_person_identity_provider").on(
      t.tenantId,
      t.provider,
      t.providerId
    ),
    index("idx_person_identities_person").on(t.tenantId, t.personId),
  ]
)
