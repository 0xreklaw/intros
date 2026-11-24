import { and, eq, inArray, notInArray } from "drizzle-orm"
import { withTenant } from "../db/client"
import {
  companies,
  people,
  personIdentities,
  relationshipEdges,
} from "../db/schema/index"
import type { ProspectFacts } from "../intelligence/brief"
import { factsHash } from "../intelligence/context"
import { storedCountry } from "./country-filter"
import { profileLinks, prospectFacts } from "./profiles"
import { assertClient } from "./service"
import { SOCIAL_PLATFORMS, type ProfileLink, type ReferralPath } from "./types"

/**
 * The pool is everyone the client's employees know: every person on the far end of an
 * employee's connections, once each, with every way an employee reaches them.
 */

export interface PoolPerson {
  id: string
  facts: ProspectFacts
  /** Identifies `facts`, so a score can tell whether it is out of date. */
  factsHash: string
  enriched: boolean
  /** The country read from `facts.location`, once someone has looked. Null code: could not be told. */
  country: { code: string | null; location: string } | null
  /** Strongest tie first. */
  paths: ReferralPath[]
  profiles: ProfileLink[]
  linkedinUrl: string | null
}

export const warmthOf = (p: PoolPerson) => p.paths[0]?.strength ?? 0

/** Load the pool, or only `only` of it (people outside the pool are never returned). */
export async function loadPool(
  tenantId: string,
  clientId: string,
  only?: string[]
): Promise<PoolPerson[]> {
  if (only && !only.length) return []
  return withTenant(tenantId, async (db) => {
    await assertClient(db, tenantId, clientId)

    const employees = await db
      .select({ id: people.id, name: people.name })
      .from(people)
      .where(and(eq(people.tenantId, tenantId), eq(people.companyId, clientId)))
    if (!employees.length) return []
    const employeeBy = new Map(employees.map((e) => [e.id, e.name]))

    // People inside the client are already close; they are not introductions.
    const reach = and(
      eq(relationshipEdges.tenantId, tenantId),
      inArray(relationshipEdges.ownerPersonId, [...employeeBy.keys()]),
      notInArray(relationshipEdges.targetPersonId, [...employeeBy.keys()])
    )

    const edges = await db
      .select({
        owner: relationshipEdges.ownerPersonId,
        target: relationshipEdges.targetPersonId,
        platform: relationshipEdges.platform,
        type: relationshipEdges.relationshipType,
        strength: relationshipEdges.strengthScore,
      })
      .from(relationshipEdges)
      .where(
        and(
          reach,
          only ? inArray(relationshipEdges.targetPersonId, only) : undefined
        )
      )
    if (!edges.length) return []

    // Later queries select by subquery rather than by a list of ids, which has no size limit.
    const targets = db
      .selectDistinct({ id: relationshipEdges.targetPersonId })
      .from(relationshipEdges)
      .where(
        and(
          reach,
          only ? inArray(relationshipEdges.targetPersonId, only) : undefined
        )
      )

    const rows = await db
      .select({
        id: people.id,
        name: people.name,
        title: people.title,
        summary: people.summary,
        metadata: people.metadata,
        company: companies.name,
        industry: companies.industry,
      })
      .from(people)
      .leftJoin(
        companies,
        and(
          eq(companies.id, people.companyId),
          eq(companies.tenantId, people.tenantId)
        )
      )
      .where(and(eq(people.tenantId, tenantId), inArray(people.id, targets)))

    const identities = await db
      .select({
        personId: personIdentities.personId,
        provider: personIdentities.provider,
        handle: personIdentities.handle,
        url: personIdentities.url,
      })
      .from(personIdentities)
      .where(
        and(
          eq(personIdentities.tenantId, tenantId),
          inArray(personIdentities.personId, targets),
          inArray(personIdentities.provider, [...SOCIAL_PLATFORMS])
        )
      )

    const pathsBy = new Map<string, ReferralPath[]>()
    for (const e of edges) {
      const list = pathsBy.get(e.target) ?? []
      list.push({
        employeeId: e.owner,
        employeeName: employeeBy.get(e.owner) ?? null,
        platform: e.platform,
        relationshipType: e.type,
        strength: e.strength ?? 0,
      })
      pathsBy.set(e.target, list)
    }

    const identitiesBy = new Map<string, typeof identities>()
    for (const i of identities) {
      const list = identitiesBy.get(i.personId) ?? []
      list.push(i)
      identitiesBy.set(i.personId, list)
    }

    return rows.map((r) => {
      const mine = identitiesBy.get(r.id) ?? []
      const facts = prospectFacts(r)
      return {
        id: r.id,
        facts,
        factsHash: factsHash(facts),
        enriched: Boolean(r.metadata?.enrichedAt),
        country: storedCountry(r.metadata),
        paths: (pathsBy.get(r.id) ?? []).sort(
          (a, b) => b.strength - a.strength
        ),
        profiles: profileLinks(mine),
        linkedinUrl: mine.find((i) => i.provider === "linkedin")?.url ?? null,
      }
    })
  })
}
