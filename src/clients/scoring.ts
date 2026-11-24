import { and, eq, sql } from "drizzle-orm"
import { withTenant } from "../db/client"
import { fitScores, searchBriefs } from "../db/schema/index"
import { factsText, hasFacts } from "../intelligence/brief"
import {
  interpretQuery,
  llmModel,
  scoreCards,
  type CardScore,
} from "../intelligence/llm"
import type { SearchBrief } from "../intelligence/search-brief"
import type { PoolPerson } from "./pool"

/**
 * Judgements of people against a search, and the brief that makes them consistent.
 * Everything is kept per search, so asking again costs nothing.
 */

export interface Judged extends CardScore {
  /** `agent` when the review agent has looked at this person. */
  source: "llm" | "agent"
}

/** The brief for a search: kept from the first time, else written now. */
export async function ensureBrief(
  tenantId: string,
  query: string,
  qHash: string
): Promise<SearchBrief> {
  const saved = await withTenant(tenantId, async (db) => {
    const [row] = await db
      .select({ brief: searchBriefs.brief })
      .from(searchBriefs)
      .where(
        and(
          eq(searchBriefs.tenantId, tenantId),
          eq(searchBriefs.queryHash, qHash)
        )
      )
      .limit(1)
    return row?.brief ?? null
  })
  if (saved) return saved

  const brief = await interpretQuery(query)
  await withTenant(tenantId, async (db) => {
    await db
      .insert(searchBriefs)
      .values({ tenantId, queryHash: qHash, query, brief, model: llmModel() })
      // A concurrent request may have written one first; either is fine.
      .onConflictDoNothing()
  })
  return brief
}

/** Saved judgements for a search, keyed by person, with the facts they were made from. */
export async function loadJudgements(
  tenantId: string,
  qHash: string
): Promise<Map<string, Judged & { factsHash: string }>> {
  const rows = await withTenant(tenantId, async (db) =>
    db
      .select()
      .from(fitScores)
      .where(
        and(eq(fitScores.tenantId, tenantId), eq(fitScores.queryHash, qHash))
      )
  )
  return new Map(
    rows.map((r) => [
      r.personId,
      {
        score: r.score,
        confidence: r.confidence,
        reason: r.reason,
        source: r.source,
        factsHash: r.contextHash,
      },
    ])
  )
}

/** Keep judgements. A newer one for the same person and search replaces the old. */
export async function saveJudgements(
  tenantId: string,
  qHash: string,
  rows: { person: PoolPerson; judged: Judged }[]
): Promise<void> {
  if (!rows.length) return
  await withTenant(tenantId, async (db) => {
    await db
      .insert(fitScores)
      .values(
        rows.map(({ person, judged }) => ({
          tenantId,
          personId: person.id,
          queryHash: qHash,
          contextHash: person.factsHash,
          score: judged.score,
          confidence: judged.confidence,
          reason: judged.reason,
          source: judged.source,
          model: llmModel(),
        }))
      )
      .onConflictDoUpdate({
        target: [fitScores.tenantId, fitScores.personId, fitScores.queryHash],
        set: {
          contextHash: sql`excluded.context_hash`,
          score: sql`excluded.score`,
          confidence: sql`excluded.confidence`,
          reason: sql`excluded.reason`,
          source: sql`excluded.source`,
          model: sql`excluded.model`,
          createdAt: sql`now()`,
        },
      })
  })
}

/** People with something to judge: a bare name cannot be matched to anything. */
export const judgeable = (p: PoolPerson) => hasFacts(p.facts)

/**
 * Judge these people against the search and keep the result. Returns the judgements that
 * came back; people the model skipped are simply absent, and are tried again next time.
 */
export async function scoreAndSave(params: {
  tenantId: string
  query: string
  qHash: string
  brief: SearchBrief
  people: PoolPerson[]
}): Promise<Map<string, Judged>> {
  const out = new Map<string, Judged>()
  if (!params.people.length) return out

  const scores = await scoreCards({
    query: params.query,
    brief: params.brief,
    cards: params.people.map((p) => factsText(p.facts)),
  })
  const rows = params.people.flatMap((person, i) => {
    const s = scores[i]
    if (!s) return []
    const judged: Judged = { ...s, source: "llm" }
    out.set(person.id, judged)
    return [{ person, judged }]
  })
  await saveJudgements(params.tenantId, params.qHash, rows)
  return out
}
