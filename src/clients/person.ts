import { and, eq, inArray } from "drizzle-orm"
import { withTenant } from "../db/client"
import { mergeJson } from "../db/json"
import {
  companies,
  people,
  personIdentities,
  relationshipEdges,
} from "../db/schema/index"
import { factsBrief, factsText, hasFacts } from "../intelligence/brief"
import { sha1 } from "../intelligence/context"
import { llmConfigured, writeBrief } from "../intelligence/llm"
import { text } from "./parse"
import { profileLinks, prospectFacts } from "./profiles"
import { ClientError, assertClient } from "./service"
import { SOCIAL_PLATFORMS, type ProspectProfile } from "./types"

/**
 * One prospect in full: every fact we hold, and a short written profile of them. The profile
 * is written by the LLM once per version of the facts and kept on the person; without an LLM,
 * or if the call fails, it is assembled from the facts directly.
 */

interface StoredBrief {
  text: string
  factsHash: string
}

export async function getProspectProfile(params: {
  tenantId: string
  clientId: string
  personId: string
  /** Allow a model call to write the profile when none is saved for the current facts. */
  write: boolean
}): Promise<ProspectProfile> {
  const { tenantId, personId } = params

  const loaded = await withTenant(tenantId, async (db) => {
    await assertClient(db, tenantId, params.clientId)

    // Only people in this client's networks are shown here.
    const employees = await db
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.tenantId, tenantId),
          eq(people.companyId, params.clientId)
        )
      )
    const known = employees.length
      ? await db
          .select({ id: relationshipEdges.id })
          .from(relationshipEdges)
          .where(
            and(
              eq(relationshipEdges.tenantId, tenantId),
              eq(relationshipEdges.targetPersonId, personId),
              inArray(
                relationshipEdges.ownerPersonId,
                employees.map((e) => e.id)
              )
            )
          )
          .limit(1)
      : []
    if (!known.length) return null

    const [row] = await db
      .select({
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
      .where(and(eq(people.tenantId, tenantId), eq(people.id, personId)))
      .limit(1)
    if (!row) return null

    const identities = await db
      .select({
        provider: personIdentities.provider,
        handle: personIdentities.handle,
        url: personIdentities.url,
      })
      .from(personIdentities)
      .where(
        and(
          eq(personIdentities.tenantId, tenantId),
          eq(personIdentities.personId, personId),
          inArray(personIdentities.provider, [...SOCIAL_PLATFORMS])
        )
      )
    return { row, identities }
  })
  if (!loaded)
    throw new ClientError("Person not found in this client's networks", 404)

  const { row, identities } = loaded
  const facts = prospectFacts(row)

  // The written profile: saved copy if the facts have not changed, else write one.
  const factsString = factsText(facts)
  const factsHash = sha1(factsString)
  const saved = row.metadata?.brief as StoredBrief | undefined
  let brief: ProspectProfile["brief"] | null =
    saved?.text && saved.factsHash === factsHash
      ? { text: saved.text, source: "ai" }
      : null

  if (!brief && params.write && llmConfigured() && hasFacts(facts)) {
    try {
      const written = await writeBrief(factsString)
      brief = { text: written, source: "ai" }
      await withTenant(tenantId, async (db) => {
        await db
          .update(people)
          .set({
            metadata: mergeJson(people.metadata, {
              brief: { text: written, factsHash } satisfies StoredBrief,
            }),
          })
          .where(and(eq(people.tenantId, tenantId), eq(people.id, personId)))
      })
    } catch (err) {
      // Fall through to the plain version; the page still works.
      console.error("Could not write a prospect brief:", (err as Error).message)
    }
  }

  return {
    personId,
    name: row.name,
    title: row.title,
    company: row.company,
    industry: row.industry,
    location: facts.location,
    headline: facts.headline,
    about: facts.about,
    experience: facts.experience.map((e) => ({
      title: e.title,
      company: e.company,
      period: e.period ?? null,
    })),
    skills: facts.skills,
    enrichedAt: text(row.metadata?.enrichedAt),
    profiles: profileLinks(identities),
    brief: brief ?? { text: factsBrief(facts), source: "facts" },
  }
}
