import { z } from "zod"
import type { AgentMessage, Chat, ToolCall, ToolSpec } from "./llm"
import { briefText, type SearchBrief } from "./search-brief"

/**
 * The review agent. After everyone has been read once, the people at the top of a search are
 * looked at again by a model that can call tools: read everything we hold about someone, fetch
 * their full LinkedIn profile when a promising match rests on thin facts, and submit the
 * final scores.
 *
 * The model proposes; this code decides. Every reference is checked against the candidate
 * list, the spending limit is enforced here and not by the prompt, and the loop stops after a
 * fixed number of turns. It has no database or network access of its own: those arrive as
 * `hooks`, which keeps it testable with a scripted model.
 */

export interface AgentCandidate {
  id: string
  name: string | null
  /** Every fact we hold, as text. */
  facts: string
  /** Who can make the intro, as text. */
  introducers: string
  score: number
  confidence: "high" | "low"
  reason: string
  /** A full profile could be fetched. */
  canEnrich: boolean
}

interface Judgement {
  score: number
  confidence: "high" | "low"
  reason: string
}

export interface AgentHooks {
  /** Fetch and save full profiles. Reports who was fetched and what it really cost. */
  enrich(ids: string[]): Promise<{
    fetched: string[]
    costMicro: number
    errors: string[]
  }>
  /** Judge these people again from the facts now held. Missing ids could not be judged. */
  rescore(ids: string[]): Promise<Map<string, Judgement & { facts: string }>>
}

export interface ReviewParams {
  query: string
  brief: SearchBrief
  candidates: AgentCandidate[]
  hooks: AgentHooks
  chat: Chat
  /** Most the agent may spend fetching profiles, in micro-USD. Zero turns fetching off. */
  budgetMicro: number
  /** Planned cost of one profile, in micro-USD. */
  costPerProfileMicro: number
  maxSteps?: number
}

export interface ReviewResult {
  /** The final judgement of every candidate: unchanged where the agent left them alone. */
  judgements: Map<string, Judgement>
  /** People the agent looked at, fetched or re-scored. */
  reviewed: number
  enriched: number
  costMicro: number
  steps: number
  /** The agent's closing remark, if it gave one. */
  notes: string | null
  /** Set when the model failed part-way. Whatever was done up to then still stands. */
  error: string | null
}

const MAX_STEPS = 6
const SHOWN_UP_FRONT = 15
const PAGE = 20

const refList = z.array(z.string()).min(1).max(30)
const listArgs = z.object({
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(PAGE).default(PAGE),
})
const personArgs = z.object({ ref: z.string() })
const enrichArgs = z.object({ refs: refList })
const submitArgs = z.object({
  entries: z
    .array(
      z.object({
        ref: z.string(),
        score: z.number().min(0).max(100),
        reason: z.string().trim().min(1).max(300),
      })
    )
    .max(60),
  notes: z.string().trim().max(300).optional(),
})

function tools(canEnrich: boolean): ToolSpec[] {
  const fn = (
    name: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[] = []
  ): ToolSpec => ({
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties, required },
    },
  })
  const refs = { type: "array", items: { type: "string" } }
  return [
    fn("list_candidates", "Page through the candidates, best score first.", {
      offset: { type: "integer" },
      limit: { type: "integer" },
    }),
    fn(
      "get_person",
      "Everything we hold about one candidate, and who can make the intro.",
      { ref: { type: "string" } },
      ["ref"]
    ),
    ...(canEnrich
      ? [
          fn(
            "enrich_profiles",
            "Fetch the full LinkedIn profile for candidates. Costs money. Each person is re-scored from the new facts and the result is returned.",
            { refs },
            ["refs"]
          ),
        ]
      : []),
    fn(
      "submit_ranking",
      "Finish. Give the final score and reason for every candidate whose score should change or that you re-judged.",
      {
        entries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ref: { type: "string" },
              score: { type: "number" },
              reason: { type: "string" },
            },
            required: ["ref", "score", "reason"],
          },
        },
        notes: { type: "string" },
      },
      ["entries"]
    ),
  ]
}

const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(4)}`

function systemPrompt(p: ReviewParams, canEnrich: boolean): string {
  return [
    "You review the best matches for a search before they are shown to a user who wants to ask for introductions.",
    "A first pass has scored each candidate from 0 to 100 and said how confident it was. Your job is to find where it is likely wrong or unsure, and fix that.",
    "Use get_person to read the facts behind a score. Trust only facts you are shown; never guess.",
    canEnrich
      ? `When a promising candidate (score about 40 or more) has low confidence and can_enrich is true, fetching their full LinkedIn profile is worth it. Do not fetch people who are clearly wrong or already confident. You may spend up to ${usd(p.budgetMicro)}; a profile costs about ${usd(p.costPerProfileMicro)}. Ask for the people in one or two calls.`
      : "You cannot fetch more information, so judge from what we hold.",
    "Finish by calling submit_ranking with a score (0 to 100) and a one-sentence reason (at most 20 words, naming the fact it rests on) for every candidate whose score should change or that you re-judged.",
    `You have ${p.maxSteps ?? MAX_STEPS} turns. Be economical.`,
  ].join("\n")
}

const row = (ref: string, c: AgentCandidate, j: Judgement) => ({
  ref,
  name: c.name,
  score: j.score,
  confidence: j.confidence,
  reason: j.reason,
  can_enrich: c.canEnrich,
})

export async function reviewCandidates(p: ReviewParams): Promise<ReviewResult> {
  const maxSteps = p.maxSteps ?? MAX_STEPS
  const canEnrich = p.budgetMicro >= p.costPerProfileMicro

  // The model refers to people by short handles, never by id.
  const order = [...p.candidates].sort((a, b) => b.score - a.score)
  const byRef = new Map(order.map((c, i) => [`p${i + 1}`, c]))
  const refOf = new Map(order.map((c, i) => [c.id, `p${i + 1}`]))
  const current = new Map<string, Judgement>(
    order.map((c) => [
      c.id,
      { score: c.score, confidence: c.confidence, reason: c.reason },
    ])
  )
  const facts = new Map(order.map((c) => [c.id, c.facts]))
  const fetched = new Set<string>()
  const touched = new Set<string>()

  let spent = 0
  let steps = 0
  let notes: string | null = null
  let error: string | null = null
  let done = false

  const candidateFor = (ref: unknown) =>
    typeof ref === "string" ? byRef.get(ref.trim().toLowerCase()) : undefined

  async function run(call: ToolCall): Promise<unknown> {
    let args: unknown
    try {
      args = JSON.parse(call.function.arguments || "{}")
    } catch {
      return { error: "Arguments were not valid JSON." }
    }
    const name = call.function.name

    if (name === "list_candidates") {
      const a = listArgs.safeParse(args)
      if (!a.success) return { error: "Bad arguments for list_candidates." }
      const ranked = [...order].sort(
        (x, y) => current.get(y.id)!.score - current.get(x.id)!.score
      )
      return {
        total: ranked.length,
        candidates: ranked
          .slice(a.data.offset, a.data.offset + a.data.limit)
          .map((c) => row(refOf.get(c.id)!, c, current.get(c.id)!)),
      }
    }

    if (name === "get_person") {
      const a = personArgs.safeParse(args)
      const c = a.success ? candidateFor(a.data.ref) : undefined
      if (!c) return { error: "Unknown ref. Use one from the candidate list." }
      touched.add(c.id)
      return {
        ...row(refOf.get(c.id)!, c, current.get(c.id)!),
        facts: facts.get(c.id),
        introducers: c.introducers,
        profile_fetched: fetched.has(c.id),
      }
    }

    if (name === "enrich_profiles" && canEnrich) {
      const a = enrichArgs.safeParse(args)
      if (!a.success) return { error: "Bad arguments for enrich_profiles." }

      const skipped: { ref: string; why: string }[] = []
      const wanted: AgentCandidate[] = []
      for (const ref of new Set(a.data.refs)) {
        const c = candidateFor(ref)
        if (!c) skipped.push({ ref, why: "unknown ref" })
        else if (fetched.has(c.id))
          skipped.push({ ref, why: "already fetched" })
        else if (!c.canEnrich)
          skipped.push({ ref, why: "no LinkedIn profile to fetch" })
        else wanted.push(c)
      }
      // The limit is enforced here, on what has really been spent.
      const room = Math.max(
        0,
        Math.floor((p.budgetMicro - spent) / p.costPerProfileMicro)
      )
      for (const c of wanted.slice(room))
        skipped.push({ ref: refOf.get(c.id)!, why: "over budget" })
      const chosen = wanted.slice(0, room)
      if (!chosen.length)
        return { fetched: [], skipped, remaining: usd(p.budgetMicro - spent) }

      const result = await p.hooks.enrich(chosen.map((c) => c.id))
      spent += result.costMicro
      for (const id of result.fetched) {
        fetched.add(id)
        touched.add(id)
      }
      const rescored = result.fetched.length
        ? await p.hooks.rescore(result.fetched)
        : new Map()
      const out = result.fetched.map((id) => {
        const next = rescored.get(id)
        const c = order.find((x) => x.id === id)!
        if (next) {
          current.set(id, {
            score: next.score,
            confidence: next.confidence,
            reason: next.reason,
          })
          facts.set(id, next.facts)
        }
        return row(refOf.get(id)!, c, current.get(id)!)
      })
      return {
        fetched: out,
        skipped,
        errors: result.errors.slice(0, 3),
        remaining: usd(Math.max(0, p.budgetMicro - spent)),
      }
    }

    if (name === "submit_ranking") {
      const a = submitArgs.safeParse(args)
      if (!a.success)
        return {
          error:
            "Bad arguments for submit_ranking. Send entries with ref, score, reason.",
        }
      const rejected: string[] = []
      for (const e of a.data.entries) {
        const c = candidateFor(e.ref)
        if (!c) {
          rejected.push(e.ref)
          continue
        }
        current.set(c.id, {
          score: Math.round(e.score),
          // The agent looked at this person on purpose: it is as sure as it gets.
          confidence: "high",
          reason: e.reason,
        })
        touched.add(c.id)
      }
      notes = a.data.notes ?? null
      done = true
      return { ok: true, rejected }
    }

    return { error: `Unknown tool ${name}.` }
  }

  const shown = order
    .slice(0, SHOWN_UP_FRONT)
    .map((c) => row(refOf.get(c.id)!, c, current.get(c.id)!))
  const messages: AgentMessage[] = [
    { role: "system", content: systemPrompt(p, canEnrich) },
    {
      role: "user",
      content: [
        `Search: ${p.query}`,
        `Brief:\n${briefText(p.brief)}`,
        `${order.length} candidates. The best ${shown.length}:`,
        JSON.stringify(shown),
        order.length > shown.length
          ? "Use list_candidates to see the rest."
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ]

  try {
    while (steps < maxSteps && !done) {
      steps++
      const reply = await p.chat({ messages, tools: tools(canEnrich) })
      messages.push({
        role: "assistant",
        content: reply.content,
        ...(reply.toolCalls.length ? { tool_calls: reply.toolCalls } : {}),
      })
      if (!reply.toolCalls.length) {
        notes = reply.content?.trim() || null
        break
      }
      for (const call of reply.toolCalls) {
        let result: unknown
        try {
          result = await run(call)
        } catch (err) {
          result = { error: (err as Error).message }
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        })
      }
    }
  } catch (err) {
    error = (err as Error).message
  }

  return {
    judgements: current,
    reviewed: touched.size,
    enriched: fetched.size,
    costMicro: spent,
    steps,
    notes,
    error,
  }
}
