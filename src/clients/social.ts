import { and, eq, inArray, isNotNull, ne } from "drizzle-orm"
import { withTenant } from "../db/client"
import { people, personIdentities, relationshipEdges } from "../db/schema/index"
import {
  recordCall,
  tregCall,
  tregConfigured,
  type TregCallResult,
} from "../enrichment/index"
import {
  ClientError,
  assertClient,
  linkedinSlug,
  normalizeHandle,
  upsertPerson,
} from "./service"
import { list, rec, text } from "./parse"
import { findAccounts } from "./find-accounts"
import { fetchInstagramProfile, profileSummary } from "./instagram-profile"
import { getSocialSettings } from "./settings"
import {
  PLATFORM_LABEL,
  SOCIAL_PLATFORMS,
  profileUrl,
  type EmployeeSocials,
  type SocialImportResult,
  type SocialPlatform,
} from "./types"

/**
 * Social import. For each employee we read who they follow and who follows them.
 *
 * - X and Instagram give both lists. Two accounts that follow each other know each other, so
 *   those become "mutual" edges. With mutualOnly off we also keep one-way follows.
 * - LinkedIn only gives followers, so those are always one-way "follower" edges.
 *
 * Each import replaces the employee's earlier edges for that network, so re-running is safe.
 */

const MUTUAL_STRENGTH = 0.8
const ONE_WAY_STRENGTH = 0.4
const LINKEDIN_STRENGTH = 0.35
/** Hard stop for the cost of one employee import, in micro-USD. */
const RUN_BUDGET_MICRO = 1_000_000
const MAX_PAGES = 30
const BIO_MAX = 160
const LOCATION_MAX = 120

/* ------------------------------------------------------------------ */
/* Employee accounts                                                   */
/* ------------------------------------------------------------------ */

/** "https://x.com/jane", "@Jane" and "jane" all become "jane". */
function handleFrom(value: string): string {
  const v = value.trim()
  if (!v.includes("/")) return normalizeHandle(v)
  const last = v.split(/[?#]/)[0]!.split("/").filter(Boolean).pop()
  return normalizeHandle(last ?? "")
}

async function readSocials(
  tenantId: string,
  employeeId: string
): Promise<EmployeeSocials> {
  const rows = await withTenant(tenantId, async (db) =>
    db
      .select({
        provider: personIdentities.provider,
        handle: personIdentities.handle,
        url: personIdentities.url,
      })
      .from(personIdentities)
      .where(
        and(
          eq(personIdentities.tenantId, tenantId),
          eq(personIdentities.personId, employeeId),
          inArray(personIdentities.provider, [...SOCIAL_PLATFORMS])
        )
      )
  )
  const socials: EmployeeSocials = { x: null, instagram: null, linkedin: null }
  for (const r of rows) {
    if (r.provider === "x") socials.x = r.handle
    else if (r.provider === "instagram") socials.instagram = r.handle
    else if (r.provider === "linkedin") socials.linkedin = r.handle
  }
  return socials
}

/**
 * Set an employee's accounts. A key left out is untouched; a blank value removes that account.
 * Every network takes a handle or a profile URL, and keeps the handle.
 */
export async function setEmployeeSocials(
  tenantId: string,
  clientId: string,
  employeeId: string,
  input: Partial<Record<SocialPlatform, string | null>>
): Promise<EmployeeSocials> {
  await withTenant(tenantId, async (db) => {
    await assertClient(db, tenantId, clientId)
    const [employee] = await db
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.tenantId, tenantId),
          eq(people.id, employeeId),
          eq(people.companyId, clientId)
        )
      )
      .limit(1)
    if (!employee) throw new ClientError("Employee not found", 404)

    for (const platform of SOCIAL_PLATFORMS) {
      const raw = input[platform]
      if (raw === undefined) continue

      const value = raw?.trim() ?? ""
      const handle = !value
        ? ""
        : platform === "linkedin"
          ? (linkedinSlug(value) ?? "")
          : handleFrom(value)
      if (value && !handle)
        throw new ClientError(
          `Could not read the ${PLATFORM_LABEL[platform]} account`,
          400
        )

      const providerId = `${platform}:${handle}`
      await db
        .delete(personIdentities)
        .where(
          and(
            eq(personIdentities.tenantId, tenantId),
            eq(personIdentities.personId, employeeId),
            eq(personIdentities.provider, platform),
            ne(personIdentities.providerId, providerId)
          )
        )
      if (!handle) continue

      const url = profileUrl(platform, handle)
      await db
        .insert(personIdentities)
        .values({
          tenantId,
          personId: employeeId,
          provider: platform,
          providerId,
          handle,
          url,
        })
        .onConflictDoUpdate({
          target: [
            personIdentities.tenantId,
            personIdentities.provider,
            personIdentities.providerId,
          ],
          set: { personId: employeeId, handle, url },
        })
    }
  })
  return readSocials(tenantId, employeeId)
}

/* ------------------------------------------------------------------ */
/* Reading lists through treg                                          */
/* ------------------------------------------------------------------ */

interface Account {
  /** The network's own id, used to match followers against following. */
  id: string
  handle: string
  name: string
  /** LinkedIn position. */
  title: string | null
  /** X bio. */
  bio: string | null
  /** Where they say they are, when the network gives it: LinkedIn and X do. */
  location: string | null
  url: string | null
}

interface Page {
  accounts: Account[]
  next: string | null
  /** The answer looks cut short and asking again may give the whole page. */
  retry?: boolean
}

type Link = {
  account: Account
  type: "mutual" | "follower" | "following"
  strength: number
}

const idOf = (v: unknown): string | null =>
  typeof v === "string" || typeof v === "number" ? String(v) : null

/** X: body.data.followers | following, 70 per page, cursor in data.next_cursor. */
function parseX(body: unknown): Page {
  const data = rec(rec(body)?.data)
  const rows = list(data?.followers ?? data?.following ?? data?.followings)
  const accounts = rows.flatMap((u) => {
    const handle = text(u.screen_name)
    if (!handle) return []
    return [
      {
        id: idOf(u.user_id) ?? handle.toLowerCase(),
        handle: handle.toLowerCase(),
        name: text(u.name) ?? handle,
        title: null,
        bio: text(u.description)?.slice(0, BIO_MAX) ?? null,
        location: text(u.location)?.slice(0, LOCATION_MAX) ?? null,
        url: `https://x.com/${handle}`,
      },
    ]
  })
  return {
    accounts,
    next: data?.more_users === true ? text(data.next_cursor) : null,
  }
}

/** Instagram: body.data.data.items, token in body.data.pagination_token. No bios. */
function parseInstagram(body: unknown): Page {
  const data = rec(rec(body)?.data)
  const rows = list(rec(data?.data)?.items)
  const accounts = rows.flatMap((u) => {
    const handle = text(u.username)
    if (!handle) return []
    return [
      {
        id: idOf(u.id) ?? handle.toLowerCase(),
        handle: handle.toLowerCase(),
        name: text(u.full_name) ?? handle,
        title: null,
        bio: null,
        location: null,
        url: `https://instagram.com/${handle}`,
      },
    ]
  })
  return { accounts, next: text(data?.pagination_token) }
}

/** LinkedIn (HarvestAPI): body.elements, 10 per page, page number as the cursor. */
function parseLinkedin(body: unknown): Page {
  const b = rec(body)
  const accounts = list(b?.elements).flatMap((u) => {
    const url = text(u.linkedinUrl)
    const handle = url
      ? linkedinSlug(url)
      : (text(u.publicIdentifier)?.toLowerCase() ?? null)
    if (!handle) return []
    return [
      {
        id: idOf(u.id) ?? handle,
        handle,
        name: text(u.name) ?? handle,
        title: text(u.position)?.slice(0, BIO_MAX) ?? null,
        bio: null,
        // `{ linkedinText: "Lahore, Punjab, Pakistan" }`, sometimes just a city.
        location:
          text(rec(u.location)?.linkedinText)?.slice(0, LOCATION_MAX) ?? null,
        url,
      },
    ]
  })
  const paging = rec(b?.pagination)
  const page = Number(paging?.pageNumber)
  const pages = Number(paging?.totalPages)
  // Now and then the service answers with a few people and no more pages although it reports
  // thousands of results. It lists at most 1000 (100 pages), so less than that is a short answer.
  const reachable = Math.min(Number(paging?.totalResultCount), 1000)
  return {
    accounts,
    next: page < pages ? String(page + 1) : null,
    retry: page >= pages && Number(paging?.totalElements) < reachable,
  }
}

interface Run {
  tenantId: string
  tenantSlug: string
  employeeId: string
  maxPerList: number
  costMicro: number
}

type ListResult = { accounts: Account[]; error: string | null }

/** Read one list page by page until it is long enough or runs out. */
async function readList(
  run: Run,
  source: {
    toolId: string
    call: (cursor: string | null) => Promise<TregCallResult<unknown>>
    parse: (body: unknown) => Page
  }
): Promise<ListResult> {
  const accounts: Account[] = []
  let cursor: string | null = null
  for (let pages = 0; pages < MAX_PAGES; pages++) {
    if (run.costMicro >= RUN_BUDGET_MICRO)
      return { accounts, error: "Stopped at the $1.00 limit for one import." }

    let page: Page = { accounts: [], next: null }
    // A short answer is asked for again, twice at most.
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await source.call(cursor)
      run.costMicro += result.costMicro
      await recordCall({
        tenantId: run.tenantId,
        toolId: source.toolId,
        personId: run.employeeId,
        result,
        outcome: result.ok ? "hit" : "error",
      })
      if (!result.ok)
        return { accounts, error: result.error ?? "treg call failed" }
      page = source.parse(result.body)
      if (!page.retry) break
    }
    accounts.push(...page.accounts)
    if (!page.next || accounts.length >= run.maxPerList) break
    cursor = page.next
  }
  return { accounts: accounts.slice(0, run.maxPerList), error: null }
}

function tregList(
  run: Run,
  toolId: string,
  query: (cursor: string | null) => Record<string, string | undefined>,
  parse: (body: unknown) => Page
) {
  return readList(run, {
    toolId,
    parse,
    call: (cursor) =>
      tregCall({
        toolId,
        query: query(cursor),
        tenantSlug: run.tenantSlug,
        feature: "social-import",
        maxCostUsd: 0.05,
      }),
  })
}

/** Followers and following from X or Instagram, as links to keep. */
async function readTwoWay(
  run: Run,
  platform: "x" | "instagram",
  handle: string,
  mutualOnly: boolean
): Promise<{ links: Link[]; error: string | null }> {
  const read = (which: "followers" | "following") =>
    platform === "x"
      ? tregList(
          run,
          `tikhub.x.twitter-web-fetch-user-${which === "followers" ? "followers" : "followings"}`,
          (cursor) => ({ screen_name: handle, cursor: cursor ?? undefined }),
          parseX
        )
      : tregList(
          run,
          `tikhub.x.instagram-v2-fetch-user-${which}`,
          (cursor) => ({
            username: handle,
            pagination_token: cursor ?? undefined,
          }),
          parseInstagram
        )

  const followers = await read("followers")
  if (followers.error) return { links: [], error: followers.error }
  const following = await read("following")
  if (following.error) return { links: [], error: following.error }

  const followingIds = new Set(following.accounts.map((a) => a.id))
  const followerIds = new Set(followers.accounts.map((a) => a.id))
  const links: Link[] = []
  for (const account of followers.accounts) {
    if (followingIds.has(account.id))
      links.push({ account, type: "mutual", strength: MUTUAL_STRENGTH })
    else if (!mutualOnly)
      links.push({ account, type: "follower", strength: ONE_WAY_STRENGTH })
  }
  if (!mutualOnly)
    for (const account of following.accounts)
      if (!followerIds.has(account.id))
        links.push({ account, type: "following", strength: ONE_WAY_STRENGTH })
  return { links, error: null }
}

async function readLinkedin(
  run: Run,
  profileUrl: string
): Promise<{ links: Link[]; error: string | null }> {
  const followers = await tregList(
    run,
    "harvestapi.linkedin.profile.search",
    (cursor) => ({ followerOf: profileUrl, page: cursor ?? "1" }),
    parseLinkedin
  )
  if (followers.error) return { links: [], error: followers.error }
  return {
    links: followers.accounts.map((account) => ({
      account,
      type: "follower" as const,
      strength: LINKEDIN_STRENGTH,
    })),
    error: null,
  }
}

/** Most Instagram contacts whose profile is opened in one import. */
const MAX_CONTACT_PROFILES = 100
const PROFILE_CONCURRENCY = 4
const SUMMARY_MAX = 400

/**
 * A follower list gives Instagram contacts as a handle and a name only, which is nothing to
 * judge them on. Open each new contact's profile for their bio, website and size, so they can
 * be searched like anyone else. Contacts that already have a bio are not paid for again.
 */
async function enrichInstagramContacts(
  run: Run,
  links: Link[]
): Promise<Link[]> {
  if (!links.length) return links
  const handles = links.map((l) => `instagram:${l.account.handle}`)
  const known = await withTenant(run.tenantId, async (db) =>
    db
      .select({ providerId: personIdentities.providerId })
      .from(personIdentities)
      .innerJoin(people, eq(people.id, personIdentities.personId))
      .where(
        and(
          eq(personIdentities.tenantId, run.tenantId),
          inArray(personIdentities.providerId, handles),
          isNotNull(people.summary)
        )
      )
  )
  const have = new Set(known.map((k) => k.providerId))
  const todo = links
    .filter((l) => !have.has(`instagram:${l.account.handle}`))
    .slice(0, MAX_CONTACT_PROFILES)

  let next = 0
  const worker = async () => {
    while (next < todo.length && run.costMicro < RUN_BUDGET_MICRO) {
      const link = todo[next++]!
      const opened = await fetchInstagramProfile({
        tenantId: run.tenantId,
        tenantSlug: run.tenantSlug,
        handle: link.account.handle,
        feature: "social-import",
      })
      run.costMicro += opened.costMicro
      if (!opened.profile) continue
      link.account.name = opened.profile.name ?? link.account.name
      link.account.bio = profileSummary(opened.profile).slice(0, SUMMARY_MAX)
    }
  }
  await Promise.all(Array.from({ length: PROFILE_CONCURRENCY }, worker))
  return links
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

/**
 * Replace the employee's edges on X or Instagram with the accounts we just read: those lists
 * are read in full, so what is missing has been unfollowed. LinkedIn only gives a sample of
 * followers, so each read adds to what is there and nothing is removed.
 */
async function saveLinks(
  tenantId: string,
  employeeId: string,
  platform: SocialPlatform,
  ownHandle: string,
  links: Link[]
): Promise<number> {
  return withTenant(tenantId, async (db) => {
    if (platform !== "linkedin")
      await db
        .delete(relationshipEdges)
        .where(
          and(
            eq(relationshipEdges.tenantId, tenantId),
            eq(relationshipEdges.ownerPersonId, employeeId),
            eq(relationshipEdges.platform, platform)
          )
        )

    let saved = 0
    for (const { account, type, strength } of links) {
      if (account.handle === ownHandle) continue
      const person = await upsertPerson(db, tenantId, {
        name: account.name,
        title: account.title,
        summary: account.bio,
        identity: {
          provider: platform,
          providerId: `${platform}:${account.handle}`,
          handle: account.handle,
          url: account.url,
        },
        location: account.location,
      })
      if (person.id === employeeId) continue
      await db
        .insert(relationshipEdges)
        .values({
          tenantId,
          ownerPersonId: employeeId,
          targetPersonId: person.id,
          platform,
          relationshipType: type,
          strengthScore: strength,
        })
        .onConflictDoUpdate({
          target: [
            relationshipEdges.tenantId,
            relationshipEdges.ownerPersonId,
            relationshipEdges.targetPersonId,
            relationshipEdges.platform,
            relationshipEdges.relationshipType,
          ],
          set: {
            strengthScore: strength,
            updatedAt: new Date(),
          },
        })
      saved++
    }
    return saved
  })
}

export async function importEmployeeNetwork(params: {
  tenantId: string
  tenantSlug: string
  clientId: string
  employeeId: string
}): Promise<SocialImportResult> {
  const fail = (message: string): SocialImportResult => ({
    ok: false,
    message,
    platforms: [],
    saved: 0,
    costMicro: 0,
  })
  if (!tregConfigured())
    return fail("treg is not configured. Set TREG_API_KEY in .env and restart.")

  const settings = await getSocialSettings(params.tenantId)
  if (!settings.platforms.length)
    return fail("No networks are turned on. Choose some in Settings.")

  const employee = await withTenant(params.tenantId, async (db) => {
    await assertClient(db, params.tenantId, params.clientId)
    const [row] = await db
      .select({ id: people.id, name: people.name })
      .from(people)
      .where(
        and(
          eq(people.tenantId, params.tenantId),
          eq(people.id, params.employeeId),
          eq(people.companyId, params.clientId)
        )
      )
      .limit(1)
    return row ?? null
  })
  if (!employee) throw new ClientError("Employee not found", 404)

  let socials = await readSocials(params.tenantId, params.employeeId)
  const run: Run = {
    tenantId: params.tenantId,
    tenantSlug: params.tenantSlug,
    employeeId: params.employeeId,
    maxPerList: settings.maxPerList,
    costMicro: 0,
  }

  // Only a name is needed to add someone: find the accounts we are missing first.
  const lookup = await findAccounts({
    tenantId: params.tenantId,
    tenantSlug: params.tenantSlug,
    clientId: params.clientId,
    employeeId: params.employeeId,
    platforms: settings.platforms,
    have: socials,
  })
  run.costMicro += lookup.costMicro
  if (Object.keys(lookup.found).length)
    socials = await setEmployeeSocials(
      params.tenantId,
      params.clientId,
      params.employeeId,
      lookup.found
    )
  const found = SOCIAL_PLATFORMS.filter((p) => lookup.found[p])
  const notes = lookup.notes.join(" ")

  const platforms: SocialImportResult["platforms"] = []
  for (const platform of SOCIAL_PLATFORMS) {
    if (!settings.platforms.includes(platform)) continue
    const account = socials[platform]
    if (!account) {
      platforms.push({
        platform,
        status: "skipped",
        saved: 0,
        message: `No ${PLATFORM_LABEL[platform]} account added.`,
      })
      continue
    }

    const read =
      platform === "linkedin"
        ? await readLinkedin(run, profileUrl("linkedin", account))
        : await readTwoWay(run, platform, account, settings.mutualOnly)
    if (read.error) {
      platforms.push({
        platform,
        status: "error",
        saved: 0,
        message: read.error,
      })
      continue
    }

    const links =
      platform === "instagram"
        ? await enrichInstagramContacts(run, read.links)
        : read.links
    const saved = await saveLinks(
      params.tenantId,
      params.employeeId,
      platform,
      account,
      links
    )
    platforms.push({
      platform,
      status: "imported",
      saved,
      message:
        platform === "linkedin"
          ? `${saved} followers.`
          : settings.mutualOnly
            ? `${saved} mutual follows.`
            : `${saved} accounts.`,
    })
  }

  const saved = platforms.reduce((n, p) => n + p.saved, 0)
  const failed = platforms.filter((p) => p.status === "error")
  const imported = platforms.some((p) => p.status === "imported")
  const detail = platforms
    .filter((p) => p.status !== "skipped")
    .map((p) => `${PLATFORM_LABEL[p.platform]}: ${p.message}`)
    .join(" ")
  const message = [
    found.length
      ? `Found ${found.map((p) => `${PLATFORM_LABEL[p]} (${socials[p]})`).join(", ")}.`
      : null,
    detail,
    notes || (imported ? null : "No accounts to read yet."),
  ]
    .filter(Boolean)
    .join(" ")
  return {
    ok: imported && !failed.length,
    message: `${employee.name ?? "Employee"}: ${message}`,
    platforms,
    saved,
    costMicro: run.costMicro,
  }
}
