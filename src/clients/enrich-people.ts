import { and, eq, inArray, isNull } from "drizzle-orm"
import { withTenant } from "../db/client"
import { mergeJson } from "../db/json"
import {
  companies,
  people,
  personIdentities,
  relationshipEdges,
} from "../db/schema/index"
import { recordCall, tregCall, tregConfigured } from "../enrichment/index"
import { list, rec, text } from "./parse"
import { assertClient, findOrCreateCompany } from "./service"
import type { EnrichSummary } from "./types"

/**
 * Context for the people worth a closer look. For each person with a LinkedIn profile we fetch
 * the full profile once, keep a short digest in `people.summary` (what the fit score reads),
 * and set their title, company and industry. The raw response is stored like any treg call.
 */

const TOOL_ID = "treg.linkedin.user.profile"
/** What one profile costs, rounded up a little, for the estimate shown before running. */
export const ESTIMATE_PER_PROFILE_MICRO = 2000
/** Most profiles fetched at once. */
const CONCURRENCY = 5
const DIGEST_MAX = 1200

export interface LinkedinProfile {
  headline: string | null
  title: string | null
  company: string | null
  industry: string | null
  about: string | null
  location: string | null
  experience: { title: string | null; company: string; period: string | null }[]
  skills: string[]
}

/** Read the fields we use from treg's LinkedIn profile response (`output` summary plus `raw`). */
export function parseLinkedinProfile(body: unknown): LinkedinProfile | null {
  const root = rec(body)
  const out = rec(root?.output)
  const raw = rec(root?.raw)
  if (!out && !raw) return null

  const experience = list(raw?.experiences).flatMap((e) => {
    const company = text(e.name)
    return company
      ? [
          {
            title: text(e.jobTitle),
            company,
            period:
              text(e.dateRange) ?? text(e.duration) ?? text(e.period) ?? null,
          },
        ]
      : []
  })
  return {
    headline: text(out?.headline) ?? text(raw?.title),
    title: text(raw?.jobTitle) ?? experience[0]?.title ?? null,
    company: text(raw?.companyName) ?? experience[0]?.company ?? null,
    industry: text(raw?.industry),
    about: text(out?.about) ?? text(raw?.description),
    location: text(out?.location) ?? text(raw?.location),
    experience,
    skills: list(raw?.skills).flatMap((s) => text(s.name) ?? []),
  }
}

/** The short text the fit score reads. Headline first, then the rest in order of usefulness. */
export function profileDigest(p: LinkedinProfile): string {
  const parts = [
    p.headline,
    p.about ? `About: ${p.about.slice(0, 500)}` : null,
    p.experience.length
      ? `Experience: ${p.experience
          .slice(0, 4)
          .map((e) => (e.title ? `${e.title} at ${e.company}` : e.company))
          .join("; ")}`
      : null,
    p.skills.length ? `Skills: ${p.skills.slice(0, 8).join(", ")}` : null,
  ].filter((x) => x !== null)
  return parts.join("\n").slice(0, DIGEST_MAX)
}

interface Target {
  id: string
  linkedinUrl: string | null
  enriched: boolean
}

/** The requested people who are actually in this client's networks. */
async function loadTargets(
  tenantId: string,
  clientId: string,
  personIds: string[]
): Promise<Target[]> {
  return withTenant(tenantId, async (db) => {
    await assertClient(db, tenantId, clientId)
    const employees = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.tenantId, tenantId), eq(people.companyId, clientId)))
    if (!employees.length || !personIds.length) return []

    const edges = await db
      .select({ target: relationshipEdges.targetPersonId })
      .from(relationshipEdges)
      .where(
        and(
          eq(relationshipEdges.tenantId, tenantId),
          inArray(
            relationshipEdges.ownerPersonId,
            employees.map((e) => e.id)
          ),
          inArray(relationshipEdges.targetPersonId, personIds)
        )
      )
    const ids = [...new Set(edges.map((e) => e.target))]
    if (!ids.length) return []

    const rows = await db
      .select({ id: people.id, metadata: people.metadata })
      .from(people)
      .where(and(eq(people.tenantId, tenantId), inArray(people.id, ids)))
    const linkedin = await db
      .select({
        personId: personIdentities.personId,
        url: personIdentities.url,
      })
      .from(personIdentities)
      .where(
        and(
          eq(personIdentities.tenantId, tenantId),
          eq(personIdentities.provider, "linkedin"),
          inArray(personIdentities.personId, ids)
        )
      )
    const urlBy = new Map(linkedin.map((l) => [l.personId, l.url]))
    return rows.map((r) => ({
      id: r.id,
      linkedinUrl: urlBy.get(r.id) ?? null,
      enriched: Boolean(r.metadata?.enrichedAt),
    }))
  })
}

async function saveProfile(
  tenantId: string,
  personId: string,
  profile: LinkedinProfile
) {
  await withTenant(tenantId, async (db) => {
    const [current] = await db
      .select()
      .from(people)
      .where(and(eq(people.tenantId, tenantId), eq(people.id, personId)))
      .limit(1)
    if (!current) return

    let companyId = current.companyId
    if (profile.company) {
      companyId = await findOrCreateCompany(db, tenantId, profile.company)
      // Only fill a missing industry; never overwrite one someone entered.
      if (profile.industry)
        await db
          .update(companies)
          .set({ industry: profile.industry, updatedAt: new Date() })
          .where(
            and(
              eq(companies.tenantId, tenantId),
              eq(companies.id, companyId),
              isNull(companies.industry)
            )
          )
    }

    await db
      .update(people)
      .set({
        title: profile.title ?? current.title,
        summary: profileDigest(profile) || current.summary,
        companyId,
        metadata: mergeJson(people.metadata, {
          enrichedAt: new Date().toISOString(),
          location: profile.location,
          // Everything parsed, kept in full so the prospect view can show it all.
          profile,
        }),
        updatedAt: new Date(),
      })
      .where(and(eq(people.tenantId, tenantId), eq(people.id, personId)))
  })
}

/**
 * Fetch full profiles for the given people. With `dryRun` nothing is fetched or spent; the
 * result is the estimate to show before the user confirms.
 */
export async function enrichPeople(params: {
  tenantId: string
  tenantSlug: string
  clientId: string
  personIds: string[]
  dryRun?: boolean
}): Promise<EnrichSummary> {
  const personIds = [...new Set(params.personIds)]
  const targets = await loadTargets(params.tenantId, params.clientId, personIds)
  const todo = targets.filter((t) => t.linkedinUrl && !t.enriched)
  const summary: EnrichSummary = {
    people: todo.length,
    skipped: personIds.length - todo.length,
    costMicro: todo.length * ESTIMATE_PER_PROFILE_MICRO,
    errors: [],
  }
  if (params.dryRun || !todo.length) return summary
  if (!tregConfigured()) {
    summary.errors.push(
      "treg is not configured. Set TREG_API_KEY in .env and restart."
    )
    summary.people = 0
    summary.costMicro = 0
    return summary
  }

  summary.costMicro = 0
  summary.people = 0

  const enrichOne = async (target: Target) => {
    const result = await tregCall({
      toolId: TOOL_ID,
      body: { linkedin_url: target.linkedinUrl },
      tenantSlug: params.tenantSlug,
      feature: "person-profile",
      maxCostUsd: 0.1,
    })
    summary.costMicro += result.costMicro
    const profile = result.ok ? parseLinkedinProfile(result.body) : null
    await recordCall({
      tenantId: params.tenantId,
      toolId: TOOL_ID,
      personId: target.id,
      result,
      outcome: profile ? "hit" : "error",
    })
    if (!profile) {
      summary.errors.push(result.error ?? "No profile returned")
      return
    }
    await saveProfile(params.tenantId, target.id, profile)
    summary.people++
  }

  let next = 0
  const worker = async () => {
    while (next < todo.length) {
      const target = todo[next++]!
      try {
        await enrichOne(target)
      } catch (err) {
        // One person's failure (say, a database error after the fetch) must not stop the rest.
        summary.errors.push((err as Error).message)
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker)
  )
  summary.skipped = personIds.length - summary.people
  return summary
}
