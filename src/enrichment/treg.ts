import { env } from "../config"

/**
 * Minimal treg HTTP client. Docs: https://treg.to/llms.txt and https://treg.to/integrate.md
 *
 * - Auth: org-scoped token in `X-Treg-Token` (never a provider key; treg holds those).
 * - Billing tags: `X-Treg-Meta` carries tenant/feature so spend can be invoiced per tenant.
 * - Response headers: `X-Treg-Call-Id` (store it), `X-Treg-Cost-Micro`, `X-Treg-Served-By`.
 * - Failed upstream calls are not billed.
 */

export interface TregCallResult<T = unknown> {
  ok: boolean
  status: number
  body: T | null
  callId: string | null
  costMicro: number
  servedBy: string | null
  error: string | null
}

export function tregConfigured(): boolean {
  return Boolean(env.TREG_API_KEY)
}

export async function tregCall<T = Record<string, unknown>>(params: {
  toolId: string
  /** JSON body for routed tools (POST). Ignored when `query` is set. */
  body?: Record<string, unknown>
  /** Query string for catalog tools that take GET parameters. Undefined values are dropped. */
  query?: Record<string, string | number | undefined>
  tenantSlug: string
  feature: string
  /** Per-call ceiling in USD. treg refuses with 402 if the reserve would exceed it. */
  maxCostUsd?: number
  /** Ask treg to keep looking past an off-domain email hit. */
  domainStrict?: boolean
}): Promise<TregCallResult<T>> {
  if (!tregConfigured()) {
    return {
      ok: false,
      status: 0,
      body: null,
      callId: null,
      costMicro: 0,
      servedBy: null,
      error:
        "treg is not configured. Set TREG_API_KEY in .env and restart the server.",
    }
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "X-Treg-Token": env.TREG_API_KEY!,
    // Values: letters, digits, . _ - : only. Tenant slugs are constrained to that set.
    "X-Treg-Meta": `tenant=${params.tenantSlug}, feature=${params.feature}`,
    "X-Treg-Route-Max-Cost": String(params.maxCostUsd ?? 0.05),
  }
  if (params.domainStrict) headers["X-Treg-Route-Domain-Match"] = "strict"

  let res: Response
  let text: string
  try {
    const url = new URL(
      `${env.TREG_BASE_URL.replace(/\/$/, "")}/call/${params.toolId}`
    )
    if (params.query) {
      for (const [key, value] of Object.entries(params.query)) {
        if (value !== undefined && value !== "")
          url.searchParams.set(key, String(value))
      }
    }
    res = await fetch(url, {
      method: params.query ? "GET" : "POST",
      headers,
      body: params.query ? undefined : JSON.stringify(params.body ?? {}),
      signal: AbortSignal.timeout(45_000),
    })
    text = await res.text()
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: null,
      callId: null,
      costMicro: 0,
      servedBy: null,
      error: `treg unreachable: ${(err as Error).message}`,
    }
  }

  let parsed: unknown = null
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = null
  }

  const callId = res.headers.get("x-treg-call-id")
  const costMicro = Number(res.headers.get("x-treg-cost-micro")) || 0
  const servedBy = res.headers.get("x-treg-served-by")

  if (!res.ok) {
    const obj = (parsed ?? {}) as { error?: string; message?: string }
    const reason = obj.message ?? obj.error ?? text.slice(0, 200)
    return {
      ok: false,
      status: res.status,
      body: null,
      callId,
      costMicro,
      servedBy,
      error: `treg ${res.status}: ${reason}`,
    }
  }

  return {
    ok: true,
    status: res.status,
    body: (parsed ?? {}) as T,
    callId,
    costMicro,
    servedBy,
    error: null,
  }
}
