import { and, eq } from "drizzle-orm"
import { withTenant } from "../db/client"
import { mergeJson } from "../db/json"
import { people } from "../db/schema/index"
import { recordCall, tregCall, type TregCallResult } from "../enrichment/index"
import {
  llmConfigured,
  pickAccount,
  type AccountCandidate,
} from "../intelligence/llm"
import { fetchInstagramProfile, profileSummary } from "./instagram-profile"
import { list, rec, text } from "./parse"
import { assertClient, extractRows, mapTregPerson } from "./service"
import type { SocialPlatform } from "./types"

/**
 * Given only an employee's name and the client's website, find their LinkedIn, X and
 * Instagram accounts through treg, so the networks can be read without anyone typing handles.
 *
 * A name search returns many people, and reading the wrong person's network would put a
 * stranger's contacts in the results. So every search result is shown to the model together
 * with who we are looking for, and an account is kept only when it is clearly the same person.
 * When unsure, nothing is saved. The pencil on the employee page fixes or adds an account by
 * hand. This only finds accounts; the caller saves them. Each network is looked up once per person: a miss is remembered so repeat clicks do
 * not pay for the same search.
 */

/** Most one person's lookup may cost, in micro-USD. */
const BUDGET_MICRO = 100_000
const MAX_CANDIDATES = 8
/** Instagram candidates whose profile is opened before choosing. */
const PROFILES_OPENED = 4

const NAME: Record<SocialPlatform, string> = {
  linkedin: "LinkedIn",
  x: "X",
  instagram: "Instagram",
}

export interface FoundAccounts {
  found: Partial<Record<SocialPlatform, string>>
  costMicro: number
  /** One line per network that could not be settled, saying why. */
  notes: string[]
}

type Rows = AccountCandidate[] | null

/** Read search results into candidates. Null means the answer was not a list at all. */
const readX = (body: unknown): Rows => {
  const output = rec(rec(body)?.output)
  if (!output) return null
  if (output.found === false) return []
  const data = output.data
  const rows = Array.isArray(data)
    ? list(data)
    : list(
        rec(data)?.users ??
          rec(data)?.results ??
          rec(data)?.items ??
          rec(data)?.accounts
      )
  if (!rows.length && !rec(data)) return null
  return rows.flatMap((u) => {
    const handle =
      text(u.username) ?? text(u.screen_name) ?? text(u.handle) ?? null
    return handle
      ? [
          {
            key: handle.replace(/^@/, ""),
            name: text(u.name) ?? text(u.displayName) ?? text(u.display_name),
            about: text(u.bio) ?? text(u.description) ?? null,
          },
        ]
      : []
  })
}

const readInstagram = (body: unknown): Rows => {
  const users = rec(rec(body)?.output)?.users
  if (!Array.isArray(users)) return null
  return list(users).flatMap((u) => {
    const handle = text(u.username)
    return handle
      ? [
          {
            key: handle,
            name: text(u.full_name),
            about: text(u.biography),
          },
        ]
      : []
  })
}

const readLinkedin = (body: unknown): Rows => {
  const rows = extractRows(body)
  if (!rows) return null
  return rows.flatMap((row) => {
    const p = mapTregPerson(row)
    const company = text(row.company) ?? text(row.company_name)
    return p.linkedin
      ? [
          {
            key: p.linkedin,
            name: p.name,
            about: [p.title, company].filter(Boolean).join(" at ") || null,
          },
        ]
      : []
  })
}

export async function findAccounts(params: {
  tenantId: string
  tenantSlug: string
  clientId: string
  employeeId: string
  platforms: SocialPlatform[]
  /** Networks that already have an account, which are left alone. */
  have: Partial<Record<SocialPlatform, string | null>>
}): Promise<FoundAccounts> {
  const out: FoundAccounts = { found: {}, costMicro: 0, notes: [] }

  const loaded = await withTenant(params.tenantId, async (db) => {
    const client = await assertClient(db, params.tenantId, params.clientId)
    const [row] = await db
      .select({
        name: people.name,
        title: people.title,
        metadata: people.metadata,
      })
      .from(people)
      .where(
        and(
          eq(people.tenantId, params.tenantId),
          eq(people.id, params.employeeId),
          eq(people.companyId, params.clientId)
        )
      )
      .limit(1)
    return row ? { client, employee: row } : null
  })
  if (!loaded?.employee.name) return out
  const { client, employee } = loaded
  const name = employee.name!

  const looked = rec(employee.metadata?.accountLookup) ?? {}
  const todo = params.platforms.filter(
    (p) => !params.have[p] && !text(looked[p])
  )
  if (!todo.length) return out

  if (!llmConfigured()) {
    out.notes.push(
      "Looking up accounts needs OPENROUTER_API_KEY, to tell the right person from others with the same name. Add accounts by hand (the pencil)."
    )
    return out
  }
  if (name.trim().split(/\s+/).length < 2) {
    out.notes.push(
      `${name} needs a full name for an account lookup. Add accounts by hand (the pencil).`
    )
    return out
  }

  const who = {
    name,
    title: employee.title,
    company: client.name,
  }
  const words = `${name} ${client.name}`

  const call = async (
    toolId: string,
    body: Record<string, unknown>
  ): Promise<TregCallResult<unknown>> => {
    const result = await tregCall({
      toolId,
      body,
      tenantSlug: params.tenantSlug,
      feature: "find-accounts",
      maxCostUsd: 0.05,
    })
    out.costMicro += result.costMicro
    return result
  }

  /** Search once, record it, and return the candidates, or why there are none. */
  async function search(
    toolId: string,
    body: Record<string, unknown>,
    read: (body: unknown) => Rows
  ): Promise<{ rows: AccountCandidate[]; problem: string | null }> {
    if (out.costMicro >= BUDGET_MICRO)
      return { rows: [], problem: "reached the cost limit for one lookup" }
    const result = await call(toolId, body)
    const rows = result.ok ? read(result.body) : null
    await recordCall({
      tenantId: params.tenantId,
      toolId,
      personId: params.employeeId,
      result,
      outcome: !result.ok ? "error" : rows?.length ? "hit" : "miss",
    })
    if (!result.ok) return { rows: [], problem: result.error ?? "treg failed" }
    if (!rows)
      return { rows: [], problem: "treg answered with an unexpected shape" }
    return { rows: rows.slice(0, MAX_CANDIDATES), problem: null }
  }

  const settled: SocialPlatform[] = []
  for (const platform of todo) {
    let account: string | null = null
    let problem: string | null = null

    if (platform === "linkedin") {
      const found = await search(
        "treg.people.search",
        { q: name, company_domain: client.domain, limit: 5 },
        readLinkedin
      )
      problem = found.problem
      account = await pickAccount(who, NAME[platform], found.rows).catch(
        () => null
      )
      if (!account && !problem && client.domain) {
        // The people directory missed. The enrichment tool matches on name and domain together.
        const result = await call("treg.people.enrich", {
          full_name: name,
          domain: client.domain,
        })
        await recordCall({
          tenantId: params.tenantId,
          toolId: "treg.people.enrich",
          personId: params.employeeId,
          result,
          outcome: !result.ok ? "error" : "hit",
        })
        const url = result.ok
          ? text(rec(rec(result.body)?.output)?.linkedin_url)
          : null
        if (url) account = url
      }
    } else {
      const toolId =
        platform === "x"
          ? "anyapi.twitter.search_users"
          : "treg.instagram.search.users"
      const read = platform === "x" ? readX : readInstagram
      const ask = (q: string) =>
        search(toolId, platform === "x" ? { query: q } : { q }, read)
      let found = await ask(words)
      // Name and company together can miss where the name alone finds them.
      if (!found.rows.length && !found.problem) found = await ask(name)
      problem = found.problem
      // A search hit shows a name and often no bio. Instagram's profiles are cheap, so the few
      // best candidates are opened: their bio, website and size are what settle who is who.
      if (platform === "instagram" && found.rows.length) {
        found.rows = await Promise.all(
          found.rows.map(async (row, i) => {
            if (i >= PROFILES_OPENED || out.costMicro >= BUDGET_MICRO)
              return row
            const opened = await fetchInstagramProfile({
              tenantId: params.tenantId,
              tenantSlug: params.tenantSlug,
              handle: row.key,
              personId: params.employeeId,
              feature: "find-accounts",
            })
            out.costMicro += opened.costMicro
            return opened.profile
              ? {
                  key: row.key,
                  name: opened.profile.name ?? row.name,
                  about: profileSummary(opened.profile),
                }
              : row
          })
        )
      }
      account = await pickAccount(who, NAME[platform], found.rows).catch(
        () => null
      )
    }

    // A lookup that ran and found nothing is remembered; one that failed is retried next time.
    if (!problem || account) settled.push(platform)
    if (account) {
      out.found[platform] = account
    } else {
      out.notes.push(
        problem
          ? `${NAME[platform]}: lookup failed (${problem}).`
          : `${NAME[platform]}: no account clearly matched.`
      )
    }
  }

  if (settled.length) {
    const at = new Date().toISOString()
    await withTenant(params.tenantId, async (db) => {
      await db
        .update(people)
        .set({
          metadata: mergeJson(people.metadata, {
            accountLookup: {
              ...looked,
              ...Object.fromEntries(settled.map((p) => [p, at])),
            },
          }),
        })
        .where(
          and(
            eq(people.tenantId, params.tenantId),
            eq(people.id, params.employeeId)
          )
        )
    })
  }
  return out
}
