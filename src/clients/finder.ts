import { hasFacts } from "../intelligence/brief"
import { queryHash } from "../intelligence/context"
import { llmConfigured } from "../intelligence/llm"
import {
  RECOMMENDATION_LABEL,
  rankScore,
  recommend,
} from "../intelligence/verdict"
import { filterByCountry } from "./country-filter"
import { loadPool, warmthOf, type PoolPerson } from "./pool"
import { reviewTargets, runReview } from "./review"
import {
  ensureBrief,
  judgeable,
  loadJudgements,
  scoreAndSave,
  type Judged,
} from "./scoring"
import { getCountrySettings, getDefaultQuery } from "./settings"
import type { AgentActivity, ReferralView, SearchResponse } from "./types"

/**
 * The finder answers one question: across everyone the client's employees know, who best
 * matches what we are looking for, and why?
 *
 *   1. Pool       every person in every employee's network, one entry per person.
 *   2. Interpret  the model turns the search into a brief, once per search.
 *   3. Read       the model rates every person from the facts we hold, in batches. Nobody is
 *                 filtered out first, so nobody the keywords would have missed is missed.
 *                 Scores are kept per search and per version of the facts.
 *   4. Review     an agent re-examines the top matches, and may pay to fetch fuller profiles
 *                 for promising ones that rest on thin facts, within a spending limit.
 *   5. Rank       fit and warmth combine; one row per person with every path to them.
 *
 * Reading and review are separate requests so none runs long: a request reads up to
 * `SCORE_LIMIT` people and reports how many are `pending`; the caller asks again.
 */

/** Most people read in one request. */
const SCORE_LIMIT = 200
/** Most rows returned. Generous: the page shows every person, and each employee's own list is cut from these. */
const MAX_RESULTS = 500

export interface FindParams {
  tenantId: string
  tenantSlug: string
  clientId: string
  /** A custom search. Empty or missing runs the default search from Settings. */
  query?: string | null
  /** Read people who have no judgement yet. Off returns what is saved, for fast page loads. */
  score: boolean
  /** Run the review agent on the top matches, if there are any it has not seen. */
  review?: boolean
}

/** Identical requests share one run, so a double click or a second tab never pays twice. */
const inflight = new Map<string, Promise<SearchResponse>>()

export function findReferrals(params: FindParams): Promise<SearchResponse> {
  const key = [
    params.tenantId,
    params.clientId,
    params.query?.trim().toLowerCase() ?? "",
    params.score,
    params.review ?? false,
  ].join("|")
  const running = inflight.get(key)
  if (running) return running
  const run = search(params).finally(() => inflight.delete(key))
  inflight.set(key, run)
  return run
}

async function search(params: FindParams): Promise<SearchResponse> {
  const { tenantId } = params
  const custom = params.query?.trim() || null
  const query = custom ?? (await getDefaultQuery(tenantId))
  const qHash = queryHash(query)
  const available = llmConfigured()

  // People in countries that are ruled out are dropped first, so none of them is ever paid for.
  const countries = await getCountrySettings(tenantId)
  const filtering = countries.blocked.length > 0 || countries.allowed.length > 0
  const first = await filterByCountry(
    tenantId,
    await loadPool(tenantId, params.clientId),
    countries,
    available
  )
  let pool = first.pool
  let hidden = first.hidden
  let hiddenUnknown = first.unknown
  const saved = available
    ? await loadJudgements(tenantId, qHash)
    : new Map<string, Judged & { factsHash: string }>()

  // A judgement counts only while the facts are what they were when it was made.
  const judged = new Map<string, Judged>()
  const readIn = () => {
    for (const p of pool) {
      const s = saved.get(p.id)
      if (s && s.factsHash === p.factsHash) judged.set(p.id, s)
    }
  }
  readIn()

  let error: string | null = null
  let agent: AgentActivity | null = null

  if (available && params.score) {
    // Closest ties first, so the people most likely to matter are read first.
    const todo = pool
      .filter((p) => judgeable(p) && !judged.has(p.id))
      .sort((a, b) => warmthOf(b) - warmthOf(a))
      .slice(0, SCORE_LIMIT)
    if (todo.length) {
      try {
        const brief = await ensureBrief(tenantId, query, qHash)
        const fresh = await scoreAndSave({
          tenantId,
          query,
          qHash,
          brief,
          people: todo,
        })
        for (const [id, s] of fresh) judged.set(id, s)
      } catch (err) {
        error = (err as Error).message
      }
    }
  }

  const unread = () =>
    pool.filter((p) => judgeable(p) && !judged.has(p.id)).length

  if (available && params.review && !error && unread() === 0) {
    try {
      const reviewed = await runReview({
        tenantId,
        tenantSlug: params.tenantSlug,
        clientId: params.clientId,
        query,
        qHash,
        pool,
        judged,
      })
      if (reviewed) {
        agent = reviewed.activity
        for (const [id, j] of reviewed.judged) judged.set(id, j)
        // People whose profiles were fetched now have more facts and no more to fetch.
        const by = new Map(reviewed.refreshed.map((p) => [p.id, p]))
        pool = pool.map((p) => by.get(p.id) ?? p)
        // A fetched profile may show they are somewhere ruled out.
        const again = await filterByCountry(tenantId, pool, countries, true)
        pool = again.pool
        hidden += again.hidden
        hiddenUnknown += again.unknown
        error = reviewed.activity.error
      }
    } catch (err) {
      error = (err as Error).message
    }
  }

  const pending = available ? unread() : 0
  const reviewPending =
    available &&
    !error &&
    pending === 0 &&
    reviewTargets(pool, judged).length > 0

  const results = pool.map((p) => view(p, judged.get(p.id), available))
  results.sort(
    (a, b) =>
      b.score - a.score ||
      b.warmth - a.warmth ||
      (a.name ?? "").localeCompare(b.name ?? "")
  )

  return {
    query,
    isDefault: custom === null,
    mode: available ? "llm" : "unavailable",
    results: results.slice(0, MAX_RESULTS),
    total: pool.length,
    pending,
    reviewPending,
    agent,
    hiddenByCountry: filtering ? { hidden, unknown: hiddenUnknown } : null,
    error,
  }
}

function view(
  p: PoolPerson,
  j: Judged | undefined,
  available: boolean
): ReferralView {
  const warmth = warmthOf(p)
  const fit = j ? j.score / 100 : 0
  const score = rankScore(fit, warmth)
  const recommendation = recommend(score, warmth)
  const limitedInfo = !hasFacts(p.facts)
  return {
    personId: p.id,
    name: p.facts.name,
    title: p.facts.title,
    company: p.facts.company,
    industry: p.facts.industry,
    about: p.facts.about,
    fit,
    fitSource: j ? "llm" : limitedInfo ? "none" : "pending",
    confidence: j?.confidence ?? null,
    reason: j
      ? j.reason
      : !available
        ? "AI search is not set up."
        : limitedInfo
          ? "Nothing is known about this person yet."
          : "Not read yet.",
    agentReviewed: j?.source === "agent",
    warmth,
    score,
    recommendation,
    recommendationLabel: RECOMMENDATION_LABEL[recommendation],
    paths: p.paths,
    profiles: p.profiles,
    limitedInfo,
    enriched: p.enriched,
    canEnrich: Boolean(p.linkedinUrl) && !p.enriched,
  }
}
