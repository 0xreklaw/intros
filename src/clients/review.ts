import { factsText } from "../intelligence/brief"
import {
  reviewCandidates,
  type AgentCandidate,
  type AgentHooks,
} from "../intelligence/agent"
import { openRouterChat } from "../intelligence/llm"
import { tregConfigured } from "../enrichment/index"
import { rankScore } from "../intelligence/verdict"
import { ESTIMATE_PER_PROFILE_MICRO, enrichPeople } from "./enrich-people"
import { loadPool, warmthOf, type PoolPerson } from "./pool"
import {
  ensureBrief,
  saveJudgements,
  scoreAndSave,
  type Judged,
} from "./scoring"
import { getSearchSettings } from "./settings"
import type { AgentActivity } from "./types"

/**
 * Wires the review agent to the app: which people it looks at, how it fetches profiles, and
 * how what it decides is kept.
 */

/** Most people the agent is asked to look at in one search. */
const REVIEW_SIZE = 40
/** Below this (0 to 100) a person is not close enough to be worth a second look. */
const MIN_REVIEW_SCORE = 30

/**
 * The best matches by final rank that the agent has not yet looked at. Empty means nothing
 * is left to review, so asking again is free.
 */
export function reviewTargets(
  pool: PoolPerson[],
  judged: Map<string, Judged>
): PoolPerson[] {
  return pool
    .flatMap((p) => {
      const j = judged.get(p.id)
      return j && j.score >= MIN_REVIEW_SCORE
        ? [{ p, j, rank: rankScore(j.score / 100, warmthOf(p)) }]
        : []
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, REVIEW_SIZE)
    .filter((x) => x.j.source !== "agent")
    .map((x) => x.p)
}

const introducers = (p: PoolPerson) =>
  p.paths
    .slice(0, 3)
    .map(
      (path) =>
        `${path.employeeName ?? "An employee"} (${path.relationshipType} on ${path.platform})`
    )
    .join("; ")

export async function runReview(params: {
  tenantId: string
  tenantSlug: string
  clientId: string
  query: string
  qHash: string
  pool: PoolPerson[]
  judged: Map<string, Judged>
}): Promise<{
  /** Judgements to show, with the agent's changes. */
  judged: Map<string, Judged>
  /** People whose facts changed during the review. */
  refreshed: PoolPerson[]
  activity: AgentActivity
} | null> {
  const targets = reviewTargets(params.pool, params.judged)
  if (!targets.length) return null

  const brief = await ensureBrief(params.tenantId, params.query, params.qHash)
  const canFetch = tregConfigured()
  const budgetMicro = canFetch
    ? (await getSearchSettings(params.tenantId)).budgetMicro
    : 0

  const candidates: AgentCandidate[] = targets.map((p) => {
    const j = params.judged.get(p.id)!
    return {
      id: p.id,
      name: p.facts.name,
      facts: factsText(p.facts),
      introducers: introducers(p),
      score: j.score,
      confidence: j.confidence,
      reason: j.reason,
      canEnrich: canFetch && Boolean(p.linkedinUrl) && !p.enriched,
    }
  })

  const fetchedIds = new Set<string>()
  const hooks: AgentHooks = {
    enrich: async (ids) => {
      const summary = await enrichPeople({
        tenantId: params.tenantId,
        tenantSlug: params.tenantSlug,
        clientId: params.clientId,
        personIds: ids,
      })
      // Who was really fetched: those now marked as enriched.
      const after = await loadPool(params.tenantId, params.clientId, ids)
      const fetched = after.filter((p) => p.enriched).map((p) => p.id)
      for (const id of fetched) fetchedIds.add(id)
      return { fetched, costMicro: summary.costMicro, errors: summary.errors }
    },
    rescore: async (ids) => {
      const fresh = await loadPool(params.tenantId, params.clientId, ids)
      const scored = await scoreAndSave({
        tenantId: params.tenantId,
        query: params.query,
        qHash: params.qHash,
        brief,
        people: fresh,
      })
      return new Map(
        fresh.flatMap((p) => {
          const s = scored.get(p.id)
          return s ? [[p.id, { ...s, facts: factsText(p.facts) }] as const] : []
        })
      )
    },
  }

  const result = await reviewCandidates({
    query: params.query,
    brief,
    candidates,
    hooks,
    chat: openRouterChat,
    budgetMicro,
    costPerProfileMicro: ESTIMATE_PER_PROFILE_MICRO,
  })

  const activity: AgentActivity = {
    reviewed: result.reviewed,
    enriched: result.enriched,
    costMicro: result.costMicro,
    notes: result.notes,
    error: result.error,
  }

  // If the model never answered, nothing was reviewed: leave these people for a retry.
  if (result.error && result.reviewed === 0)
    return { judged: params.judged, refreshed: [], activity }

  const refreshed = fetchedIds.size
    ? await loadPool(params.tenantId, params.clientId, [...fetchedIds])
    : []
  const freshBy = new Map(refreshed.map((p) => [p.id, p]))

  const judged = new Map(params.judged)
  const rows = targets.flatMap((target) => {
    const j = result.judgements.get(target.id)
    if (!j) return []
    const reviewed: Judged = { ...j, source: "agent" }
    judged.set(target.id, reviewed)
    return [{ person: freshBy.get(target.id) ?? target, judged: reviewed }]
  })
  await saveJudgements(params.tenantId, params.qHash, rows)
  return { judged, refreshed, activity }
}
