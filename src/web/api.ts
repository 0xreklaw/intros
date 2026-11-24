import { sql } from "drizzle-orm"
import { z, ZodError } from "zod"
import { db } from "../db/client"
import {
  ClientError,
  createClient,
  createEmployee,
  getClientDetail,
  importEmployees,
  listClients,
} from "../clients/service"
import { enrichPeople } from "../clients/enrich-people"
import { findReferrals } from "../clients/finder"
import { getProspectProfile } from "../clients/person"
import { importEmployeeNetwork, setEmployeeSocials } from "../clients/social"
import {
  getCountrySettings,
  getSearchSettings,
  getSocialSettings,
  saveCountrySettings,
  saveSearchSettings,
  saveSocialSettings,
} from "../clients/settings"
import { MAX_SEARCH_BUDGET_MICRO, SOCIAL_PLATFORMS } from "../clients/types"
import { getAppTenant } from "./tenant"

/**
 * JSON API for the client workspace, independent of any HTTP framework. The Next.js route
 * handler in app/api/[...path]/route.ts adapts requests to this and responses from it.
 * Every route runs for the tenant chosen by APP_TENANT_SLUG. Writes go through withTenant,
 * so Postgres RLS still applies.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const text = (max: number) => z.string().trim().min(1).max(max)
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null))

const clientBody = z.object({
  name: text(200),
  domain: text(200),
})

const employeeBody = z.object({ name: text(200) })

const socialsBody = z.object({
  x: optText(200),
  instagram: optText(200),
  linkedin: optText(500),
})

const socialSettingsBody = z.object({
  platforms: z.array(z.enum(SOCIAL_PLATFORMS)).max(SOCIAL_PLATFORMS.length),
  maxPerList: z.number().int().min(10).max(2000),
  mutualOnly: z.boolean(),
})

const searchSettingsBody = z.object({
  query: text(500),
  budgetMicro: z.number().int().min(0).max(MAX_SEARCH_BUDGET_MICRO),
})

const countrySettingsBody = z.object({
  blocked: z.array(z.string().length(2)).max(300),
  allowed: z.array(z.string().length(2)).max(300),
})

const searchBody = z.object({
  /** Empty or missing runs the default search. */
  query: optText(500),
  /** False returns saved judgements only, for quick page loads. */
  score: z.boolean().default(true),
  /** Run the review agent on the top matches. Separate from reading so no request runs long. */
  review: z.boolean().default(false),
})

const enrichBody = z.object({
  personIds: z.array(z.string().regex(UUID)).min(1).max(50),
  dryRun: z.boolean().default(false),
})

export interface ApiRequest {
  method: string
  /** Path starting with /api, for example /api/clients/123/search */
  path: string
  query: URLSearchParams
  /** Parsed lazily so routes without a body never touch it. Must throw ClientError(400) on bad JSON. */
  readBody: () => Promise<unknown>
}

export interface ApiResponse {
  status: number
  body: unknown
}

const ok = (body: unknown, status = 200): ApiResponse => ({ status, body })

function requireId(value: string | undefined): string {
  if (!value || !UUID.test(value)) throw new ClientError("Invalid id", 400)
  return value
}

/** Answers when the app can reach its database. For load balancers and uptime checks. */
async function health(): Promise<ApiResponse> {
  try {
    await db.execute(sql`select 1`)
    return ok({ status: "ok" })
  } catch (err) {
    console.error("[health]", err)
    return { status: 503, body: { status: "unavailable" } }
  }
}

export async function routeApi(req: ApiRequest): Promise<ApiResponse> {
  const method = req.method.toUpperCase()
  const path = req.path.replace(/\/+$/, "")
  try {
    if (path === "/api/health" && method === "GET") return health()

    const tenant = await getAppTenant()

    if (path === "/api/settings/search" && method === "GET")
      return ok({ settings: await getSearchSettings(tenant.id) })
    if (path === "/api/settings/search" && method === "PUT") {
      const body = searchSettingsBody.parse(await req.readBody())
      return ok({ settings: await saveSearchSettings(tenant.id, body) })
    }

    if (path === "/api/settings/countries" && method === "GET")
      return ok({ settings: await getCountrySettings(tenant.id) })
    if (path === "/api/settings/countries" && method === "PUT") {
      const body = countrySettingsBody.parse(await req.readBody())
      return ok({ settings: await saveCountrySettings(tenant.id, body) })
    }

    if (path === "/api/settings/social" && method === "GET")
      return ok({ settings: await getSocialSettings(tenant.id) })
    if (path === "/api/settings/social" && method === "PUT") {
      const body = socialSettingsBody.parse(await req.readBody())
      return ok({ settings: await saveSocialSettings(tenant.id, body) })
    }

    if (path === "/api/clients" && method === "GET")
      return ok({ clients: await listClients(tenant.id) })
    if (path === "/api/clients" && method === "POST") {
      const body = clientBody.parse(await req.readBody())
      return ok({ client: await createClient(tenant.id, body) }, 201)
    }

    const employeeRoute = path.match(
      /^\/api\/clients\/([^/]+)\/employees\/([^/]+)\/(socials|import-network)$/
    )
    if (employeeRoute) {
      const clientId = requireId(employeeRoute[1])
      const employeeId = requireId(employeeRoute[2])
      if (employeeRoute[3] === "socials" && method === "PUT") {
        const body = socialsBody.parse(await req.readBody())
        return ok({
          socials: await setEmployeeSocials(
            tenant.id,
            clientId,
            employeeId,
            body
          ),
        })
      }
      if (employeeRoute[3] === "import-network" && method === "POST") {
        // Always 200: the result carries ok/message, so the UI can show what went wrong.
        const result = await importEmployeeNetwork({
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          clientId,
          employeeId,
        })
        return ok({ result })
      }
    }

    const personRoute = path.match(/^\/api\/clients\/([^/]+)\/people\/([^/]+)$/)
    if (personRoute && method === "GET") {
      return ok({
        profile: await getProspectProfile({
          tenantId: tenant.id,
          clientId: requireId(personRoute[1]),
          personId: requireId(personRoute[2]),
          write: req.query.get("write") !== "0",
        }),
      })
    }

    const m = path.match(
      /^\/api\/clients\/([^/]+)(?:\/(employees|import-employees|search|enrich))?$/
    )
    if (m) {
      const clientId = requireId(m[1])
      const sub = m[2]

      if (!sub && method === "GET") {
        const detail = await getClientDetail(tenant.id, clientId)
        if (!detail) throw new ClientError("Client not found", 404)
        return ok(detail)
      }
      if (sub === "search" && method === "POST") {
        const body = searchBody.parse(await req.readBody())
        return ok(
          await findReferrals({
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
            clientId,
            query: body.query,
            score: body.score,
            review: body.review,
          })
        )
      }
      if (sub === "enrich" && method === "POST") {
        const body = enrichBody.parse(await req.readBody())
        return ok({
          summary: await enrichPeople({
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
            clientId,
            personIds: body.personIds,
            dryRun: body.dryRun,
          }),
        })
      }
      if (sub === "employees" && method === "POST") {
        const body = employeeBody.parse(await req.readBody())
        return ok(
          { employee: await createEmployee(tenant.id, clientId, body) },
          201
        )
      }
      if (sub === "import-employees" && method === "POST") {
        // Always 200: the result carries ok/message, so the UI can show treg's reason.
        const result = await importEmployees({
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          clientId,
        })
        return ok({ result })
      }
    }

    return { status: 404, body: { error: "Not found" } }
  } catch (err) {
    if (err instanceof ClientError)
      return { status: err.status, body: { error: err.message } }
    if (err instanceof ZodError) {
      const first = err.issues[0]
      return {
        status: 400,
        body: {
          error: first
            ? `${first.path.join(".") || "body"}: ${first.message}`
            : "Invalid body",
        },
      }
    }
    // Details stay in the server log; the browser gets a message that leaks nothing.
    console.error(err)
    return { status: 500, body: { error: "Something went wrong. Try again." } }
  }
}
