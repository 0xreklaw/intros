import { and, eq } from "drizzle-orm"
import { withTenant } from "../db/client"
import { mergeJson } from "../db/json"
import { people } from "../db/schema/index"
import { countriesOf } from "../intelligence/llm"
import {
  countryAllowed,
  isCountryCode,
  type CountrySettings,
} from "./countries"
import { rec, text } from "./parse"
import type { PoolPerson } from "./pool"

/**
 * Country filtering. A person's country is read from the place they list, by the model, once
 * per distinct place, and kept on the person with the place it was read from, so it is read
 * again only when their location changes. People outside the allowed countries are removed
 * before anyone is scored, so nobody who will not be shown is paid for.
 */

/** What `people.metadata.country` holds. */
export function storedCountry(
  metadata: Record<string, unknown> | null | undefined
): PoolPerson["country"] {
  const c = rec(metadata?.country)
  const location = text(c?.location)
  if (!location) return null
  const code =
    typeof c?.code === "string" && isCountryCode(c.code) ? c.code : null
  return { code, location }
}

const locationOf = (p: PoolPerson) => text(p.facts.location)

/** The person's country, or null when it is not known (no location, or not read yet). */
const countryOf = (p: PoolPerson) => {
  const location = locationOf(p)
  return location && p.country?.location === location ? p.country.code : null
}

export interface CountryFilterResult {
  pool: PoolPerson[]
  /** People removed. */
  hidden: number
  /** Of those, people removed only because we could not tell where they are (allow list). */
  unknown: number
}

/** Read the country of everyone whose location has not been read, and save it. */
async function resolve(
  tenantId: string,
  pool: PoolPerson[]
): Promise<PoolPerson[]> {
  const todo = pool.filter((p) => {
    const location = locationOf(p)
    return location && p.country?.location !== location
  })
  if (!todo.length) return pool

  const places = [...new Set(todo.map((p) => locationOf(p)!))]
  let read: Map<string, string | null>
  try {
    read = await countriesOf(places)
  } catch (err) {
    // The filter still runs on what is known; the people not read stay unknown and are read next time.
    console.error("Could not read countries:", (err as Error).message)
    return pool
  }

  const found = new Map<string, PoolPerson["country"]>()
  await withTenant(tenantId, async (db) => {
    for (const p of todo) {
      const location = locationOf(p)!
      if (!read.has(location)) continue
      const raw = read.get(location)
      const country = {
        code: raw && isCountryCode(raw) ? raw : null,
        location,
      }
      found.set(p.id, country)
      await db
        .update(people)
        .set({ metadata: mergeJson(people.metadata, { country }) })
        .where(and(eq(people.tenantId, tenantId), eq(people.id, p.id)))
    }
  })
  return pool.map((p) =>
    found.has(p.id) ? { ...p, country: found.get(p.id)! } : p
  )
}

/**
 * Remove the people the country settings rule out. With no lists set this does nothing and
 * costs nothing. `read` lets countries be read by the model; without it only saved ones count.
 */
export async function filterByCountry(
  tenantId: string,
  pool: PoolPerson[],
  settings: CountrySettings,
  read: boolean
): Promise<CountryFilterResult> {
  if (!settings.blocked.length && !settings.allowed.length)
    return { pool, hidden: 0, unknown: 0 }

  const known = read ? await resolve(tenantId, pool) : pool
  const kept: PoolPerson[] = []
  let hidden = 0
  let unknown = 0
  for (const p of known) {
    const code = countryOf(p)
    if (countryAllowed(code, settings)) kept.push(p)
    else {
      hidden++
      if (code === null) unknown++
    }
  }
  return { pool: kept, hidden, unknown }
}
