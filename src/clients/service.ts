import { and, eq, inArray, sql } from "drizzle-orm"
import { withTenant, type Database } from "../db/client"
import { mergeJson } from "../db/json"
import {
  companies,
  people,
  personIdentities,
  relationshipEdges,
} from "../db/schema/index"
import { recordCall, tregCall, tregConfigured } from "../enrichment/index"
import { queryHash } from "../intelligence/context"
import { text } from "./parse"
import { getDefaultQuery } from "./settings"
import {
  SOCIAL_PLATFORMS,
  type SocialPlatform,
  type ClientDetail,
  type ClientSummary,
  type EmployeeSocials,
  type ImportResult,
} from "./types"

/**
 * Clients are companies. Each client has employees (people with companyId = client).
 * Each employee has a network: relationship_edges owned by that employee, one per person
 * they know on a platform (linkedin, instagram, x).
 */

export class ClientError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
  }
}

/** A fit score at or above this counts as a strong match when tallying a client. */
const TOP_SCORE = 70

const now = () => new Date()

/** A parenthesised, parameterised list for a raw SQL `IN`. */
const inList = (ids: string[]) =>
  sql`(${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `
  )})`

/** "https://www.Acme.com/about" -> "acme.com". Returns null when it does not look like a domain. */
function normalizeDomain(input: string): string | null {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    ?.replace(/\.$/, "")
  return host && host.includes(".") ? host : null
}

/** "https://linkedin.com/in/jane-doe/" -> "jane-doe" */
export function linkedinSlug(url: string): string | null {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`)
    const slug = u.pathname.split("/").filter(Boolean).pop()
    return slug ? slug.toLowerCase() : null
  } catch {
    return null
  }
}

export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, "").replace(/\/$/, "").toLowerCase()
}

/**
 * Clients with their counts: one query per count, grouped by client, so the list stays fast
 * with many people. Pass `onlyClientId` to summarise a single client.
 */
export async function listClients(
  tenantId: string,
  onlyClientId?: string
): Promise<ClientSummary[]> {
  const defaultHash = queryHash(await getDefaultQuery(tenantId))
  return withTenant(tenantId, async (db) => {
    const clients = await db
      .select()
      .from(companies)
      .where(
        and(
          eq(companies.tenantId, tenantId),
          eq(companies.isClient, true),
          onlyClientId ? eq(companies.id, onlyClientId) : undefined
        )
      )
      .orderBy(companies.name)
    if (!clients.length) return []
    const clientIds = clients.map((c) => c.id)

    const employees = await db.execute<{ client_id: string; n: string }>(sql`
      SELECT company_id AS client_id, count(*) AS n
      FROM people
      WHERE tenant_id = ${tenantId}::uuid AND company_id IN ${inList(clientIds)}
      GROUP BY company_id`)

    // Distinct people per client, and how many of them strongly match the default search.
    const network = await db.execute<{
      client_id: string
      connections: string
      scored: string
      top: string
    }>(sql`
      SELECT o.company_id AS client_id,
             count(DISTINCT e.target_person_id) AS connections,
             count(DISTINCT f.person_id) AS scored,
             count(DISTINCT f.person_id) FILTER (WHERE f.score >= ${TOP_SCORE}) AS top
      FROM relationship_edges e
      JOIN people o ON o.id = e.owner_person_id
      LEFT JOIN fit_scores f
        ON f.person_id = e.target_person_id AND f.query_hash = ${defaultHash}
      WHERE e.tenant_id = ${tenantId}::uuid AND o.company_id IN ${inList(clientIds)}
      GROUP BY o.company_id`)

    const employeeCount = new Map(
      employees.rows.map((r) => [r.client_id, Number(r.n)])
    )
    const networkBy = new Map(network.rows.map((r) => [r.client_id, r]))
    return clients.map((c) => {
      const n = networkBy.get(c.id)
      return {
        id: c.id,
        name: c.name,
        domain: c.domain,
        industry: c.industry,
        location: c.location,
        employeeCount: employeeCount.get(c.id) ?? 0,
        connectionCount: Number(n?.connections ?? 0),
        topCount: n && Number(n.scored) > 0 ? Number(n.top) : null,
      }
    })
  })
}

export async function getClientDetail(
  tenantId: string,
  clientId: string
): Promise<ClientDetail | null> {
  const [client] = await listClients(tenantId, clientId)
  if (!client) return null

  return withTenant(tenantId, async (db) => {
    const rows = await db
      .select({
        id: people.id,
        name: people.name,
        title: people.title,
      })
      .from(people)
      .where(and(eq(people.tenantId, tenantId), eq(people.companyId, clientId)))
      .orderBy(people.name)
    const ids = rows.map((r) => r.id)

    const identities = ids.length
      ? await db
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
              inArray(personIdentities.provider, [...SOCIAL_PLATFORMS]),
              inArray(personIdentities.personId, ids)
            )
          )
      : []
    const socialsBy = new Map<string, EmployeeSocials>()
    for (const r of identities) {
      const s = socialsBy.get(r.personId) ?? {
        x: null,
        instagram: null,
        linkedin: null,
      }
      if (r.provider === "x") s.x = r.handle
      else if (r.provider === "instagram") s.instagram = r.handle
      else if (r.provider === "linkedin") s.linkedin = r.handle
      socialsBy.set(r.personId, s)
    }

    const counts = ids.length
      ? await db
          .select({
            owner: relationshipEdges.ownerPersonId,
            n: sql<number>`count(DISTINCT ${relationshipEdges.targetPersonId})`,
          })
          .from(relationshipEdges)
          .where(
            and(
              eq(relationshipEdges.tenantId, tenantId),
              inArray(relationshipEdges.ownerPersonId, ids)
            )
          )
          .groupBy(relationshipEdges.ownerPersonId)
      : []
    const countBy = new Map(counts.map((c) => [c.owner, Number(c.n)]))

    return {
      client,
      employees: rows.map((r) => ({
        id: r.id,
        clientId,
        name: r.name,
        title: r.title,
        socials: socialsBy.get(r.id) ?? {
          x: null,
          instagram: null,
          linkedin: null,
        },
        connectionCount: countBy.get(r.id) ?? 0,
      })),
    }
  })
}

export async function assertClient(
  db: Database,
  tenantId: string,
  clientId: string
) {
  const [client] = await db
    .select()
    .from(companies)
    .where(
      and(
        eq(companies.tenantId, tenantId),
        eq(companies.id, clientId),
        eq(companies.isClient, true)
      )
    )
    .limit(1)
  if (!client) throw new ClientError("Client not found", 404)
  return client
}

export async function createClient(
  tenantId: string,
  input: { name: string; domain: string }
) {
  const domain = normalizeDomain(input.domain)
  if (!domain)
    throw new ClientError(
      "That does not look like a company domain (e.g. acme.com)",
      400
    )

  return withTenant(tenantId, async (db) => {
    const values = {
      tenantId,
      name: input.name.trim(),
      domain,
      isClient: true,
    }
    // A company with this domain may already exist as a prospect. Promote it to a client.
    const query = db.insert(companies).values(values)
    const [row] = domain
      ? await query
          .onConflictDoUpdate({
            target: [companies.tenantId, companies.domain],
            set: { isClient: true, updatedAt: now() },
          })
          .returning()
      : await query.returning()
    return row!
  })
}

interface Identity {
  provider: SocialPlatform
  providerId: string
  handle?: string | null
  url?: string | null
}

/**
 * Find or create a person. Identity (provider + providerId) is the strongest match. Without an
 * identity, match on name within the same company. Otherwise create.
 */
export async function upsertPerson(
  db: Database,
  tenantId: string,
  input: {
    name: string
    title?: string | null
    /** Bio or profile text. */
    summary?: string | null
    companyId?: string | null
    identity?: Identity
    /** Where they say they are. Kept unless a fetched profile already gave a better one. */
    location?: string | null
  }
): Promise<{ id: string; created: boolean }> {
  let existingId: string | null = null

  if (input.identity) {
    const [ident] = await db
      .select({ personId: personIdentities.personId })
      .from(personIdentities)
      .where(
        and(
          eq(personIdentities.tenantId, tenantId),
          eq(personIdentities.provider, input.identity.provider),
          eq(personIdentities.providerId, input.identity.providerId)
        )
      )
      .limit(1)
    existingId = ident?.personId ?? null
  } else if (input.companyId) {
    const [byName] = await db
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.tenantId, tenantId),
          eq(people.companyId, input.companyId),
          sql`lower(${people.name}) = lower(${input.name})`
        )
      )
      .limit(1)
    existingId = byName?.id ?? null
  }

  let id: string
  let created = false
  if (existingId) {
    const [current] = await db
      .select()
      .from(people)
      .where(eq(people.id, existingId))
      .limit(1)
    await db
      .update(people)
      .set({
        name: current?.name ?? input.name,
        title: input.title ?? current?.title ?? null,
        summary: input.summary ?? current?.summary ?? null,
        companyId: input.companyId ?? current?.companyId ?? null,
        ...(input.location && !current?.metadata?.enrichedAt
          ? {
              metadata: mergeJson(people.metadata, {
                location: input.location,
              }),
            }
          : {}),
        updatedAt: now(),
      })
      .where(eq(people.id, existingId))
    id = existingId
  } else {
    const [row] = await db
      .insert(people)
      .values({
        tenantId,
        name: input.name,
        title: input.title ?? null,
        summary: input.summary ?? null,
        companyId: input.companyId ?? null,
        ...(input.location ? { metadata: { location: input.location } } : {}),
      })
      .returning({ id: people.id })
    id = row!.id
    created = true
  }

  if (input.identity) {
    await db
      .insert(personIdentities)
      .values({
        tenantId,
        personId: id,
        provider: input.identity.provider,
        providerId: input.identity.providerId,
        handle: input.identity.handle ?? null,
        url: input.identity.url ?? null,
      })
      .onConflictDoNothing()
  }
  return { id, created }
}

export async function findOrCreateCompany(
  db: Database,
  tenantId: string,
  name: string
): Promise<string> {
  const [existing] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(
      and(
        eq(companies.tenantId, tenantId),
        sql`lower(${companies.name}) = lower(${name})`
      )
    )
    .limit(1)
  if (existing) return existing.id
  const [row] = await db
    .insert(companies)
    .values({ tenantId, name })
    .returning({ id: companies.id })
  return row!.id
}

export async function createEmployee(
  tenantId: string,
  clientId: string,
  input: { name: string }
) {
  return withTenant(tenantId, async (db) => {
    await assertClient(db, tenantId, clientId)
    return upsertPerson(db, tenantId, {
      name: input.name.trim(),
      companyId: clientId,
    })
  })
}

/* ------------------------------------------------------------------ */
/* treg: company employees                                             */
/* ------------------------------------------------------------------ */

/** treg's people rows vary by provider. Read the common field names and keep the raw row for reference. */
export function mapTregPerson(row: Record<string, unknown>): {
  name: string | null
  title: string | null
  linkedin: string | null
} {
  const first = text(row.first_name) ?? text(row.firstName)
  const last = text(row.last_name) ?? text(row.lastName)
  const name =
    text(row.name) ??
    text(row.full_name) ??
    text(row.fullName) ??
    ([first, last].filter(Boolean).join(" ") || null)
  const title =
    text(row.title) ??
    text(row.headline) ??
    text(row.job_title) ??
    text(row.jobTitle) ??
    text(row.position) ??
    text(row.role)
  const urls = [
    row.linkedin_url,
    row.linkedinUrl,
    row.linkedin,
    row.profile_url,
    row.profileUrl,
    row.url,
  ]
    .map(text)
    .filter((u): u is string => Boolean(u))
  const linkedin = urls.find((u) => /linkedin\.com\//i.test(u)) ?? null
  return { name, title, linkedin }
}

export function extractRows(body: unknown): Record<string, unknown>[] | null {
  const output = (body as { output?: unknown } | null)?.output as
    | { people?: unknown; results?: unknown; next_cursor?: unknown }
    | unknown[]
    | undefined
  const list = Array.isArray(output)
    ? output
    : Array.isArray((output as { people?: unknown })?.people)
      ? (output as { people: unknown[] }).people
      : Array.isArray((output as { results?: unknown })?.results)
        ? (output as { results: unknown[] }).results
        : null
  return list
    ? (list.filter((r) => r && typeof r === "object") as Record<
        string,
        unknown
      >[])
    : null
}

function nextCursor(body: unknown): boolean {
  const output = (body as { output?: { next_cursor?: unknown } } | null)?.output
  return Boolean(output && typeof output === "object" && output.next_cursor)
}

export async function importEmployees(params: {
  tenantId: string
  tenantSlug: string
  clientId: string
  limit?: number
}): Promise<ImportResult> {
  const empty = {
    found: 0,
    added: 0,
    updated: 0,
    costMicro: 0,
    callId: null,
    hasMore: false,
  }
  if (!tregConfigured()) {
    return {
      ok: false,
      message: "treg is not configured. Set TREG_API_KEY in .env and restart.",
      ...empty,
    }
  }

  const client = await withTenant(params.tenantId, async (db) =>
    assertClient(db, params.tenantId, params.clientId)
  )
  if (!client.domain) {
    return {
      ok: false,
      message:
        "Add the company domain first (for example acme.com). treg finds people by domain.",
      ...empty,
    }
  }

  const limit = params.limit ?? 20
  const result = await tregCall<{ output?: unknown; raw?: unknown }>({
    toolId: "treg.people.search",
    body: { company_domain: client.domain, limit },
    tenantSlug: params.tenantSlug,
    feature: "client-employees",
    maxCostUsd: 2,
  })

  if (!result.ok) {
    await recordCall({
      tenantId: params.tenantId,
      toolId: "treg.people.search",
      companyId: params.clientId,
      result,
      outcome: "error",
    })
    return {
      ok: false,
      message: result.error ?? "treg call failed",
      ...empty,
      costMicro: result.costMicro,
      callId: result.callId,
    }
  }

  const rows = extractRows(result.body)
  const sourceObjectId = await recordCall({
    tenantId: params.tenantId,
    toolId: "treg.people.search",
    companyId: params.clientId,
    result,
    outcome: rows?.length ? "hit" : "miss",
  })
  const hasMore = nextCursor(result.body)

  if (!rows) {
    return {
      ok: false,
      message: `treg answered, but not with a people list. Raw response saved (source ${sourceObjectId ?? "n/a"}).`,
      found: 0,
      added: 0,
      updated: 0,
      costMicro: result.costMicro,
      callId: result.callId,
      hasMore,
    }
  }

  let added = 0
  let updated = 0
  let found = 0
  await withTenant(params.tenantId, async (db) => {
    for (const raw of rows) {
      const mapped = mapTregPerson(raw)
      if (!mapped.name) continue
      found++
      const slug = mapped.linkedin ? linkedinSlug(mapped.linkedin) : null
      const r = await upsertPerson(db, params.tenantId, {
        name: mapped.name,
        title: mapped.title,
        companyId: params.clientId,
        identity: slug
          ? {
              provider: "linkedin",
              providerId: `linkedin:${slug}`,
              handle: slug,
              url: mapped.linkedin,
            }
          : undefined,
      })
      if (r.created) added++
      else updated++
    }
  })

  return {
    ok: true,
    message: `Found ${found} people at ${client.name}: ${added} new, ${updated} already known.${hasMore ? " More results are available from treg." : ""}`,
    found,
    added,
    updated,
    costMicro: result.costMicro,
    callId: result.callId,
    hasMore,
  }
}
