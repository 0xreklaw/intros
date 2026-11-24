import { pgEnum } from "drizzle-orm/pg-core"

/** Networks a person's account can be on. */
export const identityProviderEnum = pgEnum("identity_provider", [
  "linkedin",
  "instagram",
  "x",
])

/** How one person is tied to another. */
export const relationshipTypeEnum = pgEnum("relationship_type", [
  "mutual",
  "follower",
  "following",
])
