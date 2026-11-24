import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { tenants } from "./tenants"

/**
 * Per-tenant settings. `defaultQuery` is the default search: plain words describing who your
 * clients should introduce you to. It drives the general fit score. One row per tenant.
 */
export const tenantProfiles = pgTable("tenant_profiles", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  defaultQuery: text("default_query")
    .notNull()
    .default("Founders, CEOs and business owners"),
  /** Social networks to import for each employee: x, instagram, linkedin. */
  socialPlatforms: text("social_platforms")
    .array()
    .notNull()
    .default(["x", "instagram", "linkedin"]),
  /** Most accounts to read from any one followers or following list. */
  socialMaxPerList: integer("social_max_per_list").notNull().default(200),
  /** Keep only accounts that follow each other (X and Instagram). */
  socialMutualOnly: boolean("social_mutual_only").notNull().default(true),
  /** What the review agent may spend on fetching profiles in one search, in micro-USD. */
  searchBudgetMicro: integer("search_budget_micro").notNull().default(100_000),
  /** ISO country codes whose people are never shown. */
  blockedCountries: text("blocked_countries").array().notNull().default([]),
  /** ISO country codes. When not empty, only people in these countries are shown. */
  allowedCountries: text("allowed_countries").array().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})
