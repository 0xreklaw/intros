import { eq } from "drizzle-orm"
import { withTenant } from "../db/client"
import { isCountryCode, type CountrySettings } from "./countries"
import { tenantProfiles } from "../db/schema/index"
import {
  SOCIAL_PLATFORMS,
  type SearchSettings,
  type SocialPlatform,
  type SocialSettings,
} from "./types"

/** Tenant settings, one row in `tenant_profiles`: the default search, the review budget and the social import options. */

const DEFAULT_QUERY = "Founders, CEOs and business owners"
/** Matches the column default: ten cents of profile fetching per search. */
const DEFAULT_BUDGET_MICRO = 100_000

const DEFAULT_SOCIAL: SocialSettings = {
  platforms: [...SOCIAL_PLATFORMS],
  maxPerList: 200,
  mutualOnly: true,
}

async function readRow(tenantId: string) {
  return withTenant(tenantId, async (db) => {
    const [row] = await db
      .select()
      .from(tenantProfiles)
      .where(eq(tenantProfiles.tenantId, tenantId))
      .limit(1)
    return row ?? null
  })
}

async function save(
  tenantId: string,
  values: Partial<typeof tenantProfiles.$inferInsert>
) {
  await withTenant(tenantId, async (db) => {
    await db
      .insert(tenantProfiles)
      .values({ tenantId, ...values })
      .onConflictDoUpdate({
        target: tenantProfiles.tenantId,
        set: { ...values, updatedAt: new Date() },
      })
  })
}

/** Plain words describing who clients should introduce you to. The search that runs when none is typed. */
export async function getDefaultQuery(tenantId: string): Promise<string> {
  return (await readRow(tenantId))?.defaultQuery ?? DEFAULT_QUERY
}

export async function getSearchSettings(
  tenantId: string
): Promise<SearchSettings> {
  const row = await readRow(tenantId)
  return {
    query: row?.defaultQuery ?? DEFAULT_QUERY,
    budgetMicro: row?.searchBudgetMicro ?? DEFAULT_BUDGET_MICRO,
  }
}

export async function saveSearchSettings(
  tenantId: string,
  input: SearchSettings
): Promise<SearchSettings> {
  await save(tenantId, {
    defaultQuery: input.query,
    searchBudgetMicro: input.budgetMicro,
  })
  return input
}

export async function getSocialSettings(
  tenantId: string
): Promise<SocialSettings> {
  const row = await readRow(tenantId)
  if (!row) return DEFAULT_SOCIAL
  return {
    platforms: row.socialPlatforms.filter((p): p is SocialPlatform =>
      (SOCIAL_PLATFORMS as readonly string[]).includes(p)
    ),
    maxPerList: row.socialMaxPerList,
    mutualOnly: row.socialMutualOnly,
  }
}

export async function saveSocialSettings(
  tenantId: string,
  input: SocialSettings
): Promise<SocialSettings> {
  await save(tenantId, {
    socialPlatforms: input.platforms,
    socialMaxPerList: input.maxPerList,
    socialMutualOnly: input.mutualOnly,
  })
  return input
}

/** Countries to leave out, and, when set, the only countries to keep. */
export async function getCountrySettings(
  tenantId: string
): Promise<CountrySettings> {
  const row = await readRow(tenantId)
  return {
    blocked: row?.blockedCountries.filter(isCountryCode) ?? [],
    allowed: row?.allowedCountries.filter(isCountryCode) ?? [],
  }
}

export async function saveCountrySettings(
  tenantId: string,
  input: CountrySettings
): Promise<CountrySettings> {
  const clean = (codes: string[]) => [...new Set(codes.filter(isCountryCode))]
  const blocked = clean(input.blocked)
  // A country on both lists would be blocked anyway, so it is dropped from the allow list.
  const allowed = clean(input.allowed).filter((c) => !blocked.includes(c))
  await save(tenantId, { blockedCountries: blocked, allowedCountries: allowed })
  return { blocked, allowed }
}
