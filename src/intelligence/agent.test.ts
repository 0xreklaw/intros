import assert from "node:assert/strict"
import test from "node:test"
import { reviewCandidates, type AgentCandidate, type AgentHooks } from "./agent"
import type { AgentMessage, Chat, Reply, ToolCall } from "./llm"

const candidate = (
  id: string,
  score: number,
  over: Partial<AgentCandidate> = {}
): AgentCandidate => ({
  id,
  name: id.toUpperCase(),
  facts: `facts of ${id}`,
  introducers: "Dana (colleague)",
  score,
  confidence: "low",
  reason: `first pass ${id}`,
  canEnrich: true,
  ...over,
})

const call = (name: string, args: unknown, id = name): ToolCall => ({
  id,
  type: "function",
  function: {
    name,
    arguments: typeof args === "string" ? args : JSON.stringify(args),
  },
})

/** A model that plays back one reply per turn and remembers what it was shown. */
function script(...turns: Reply[]) {
  const seen: AgentMessage[][] = []
  const chat: Chat = async ({ messages }) => {
    seen.push(structuredClone(messages))
    const turn = turns[seen.length - 1]
    if (!turn) throw new Error("script ran out")
    return turn
  }
  return { chat, seen }
}

const say = (...calls: ToolCall[]): Reply => ({
  content: null,
  toolCalls: calls,
})

function hooks(over: Partial<AgentHooks> = {}) {
  const enriched: string[][] = []
  const h: AgentHooks = {
    enrich: async (ids) => {
      enriched.push(ids)
      return { fetched: ids, costMicro: ids.length * 1500, errors: [] }
    },
    rescore: async (ids) =>
      new Map(
        ids.map((id) => [
          id,
          {
            score: 90,
            confidence: "high" as const,
            reason: "profile",
            facts: `full ${id}`,
          },
        ])
      ),
    ...over,
  }
  return { h, enriched }
}

const base = (chat: Chat, h: AgentHooks, over = {}) => ({
  query: "founders",
  brief: {
    summary: "founders",
    mustHave: [],
    plus: [],
    rulesOut: [],
    whenUnknown: "Give a low score and low confidence.",
  },
  candidates: [candidate("a", 80), candidate("b", 60), candidate("c", 20)],
  hooks: h,
  chat,
  budgetMicro: 100_000,
  costPerProfileMicro: 2000,
  ...over,
})

test("submit_ranking updates scores and ends the run", async () => {
  const { chat } = script(
    say(
      call("submit_ranking", {
        entries: [{ ref: "p2", score: 95, reason: "sells it" }],
      })
    )
  )
  const { h } = hooks()
  const r = await reviewCandidates(base(chat, h))
  assert.equal(r.judgements.get("b")?.score, 95)
  assert.equal(r.judgements.get("b")?.reason, "sells it")
  assert.equal(r.judgements.get("a")?.score, 80)
  assert.equal(r.steps, 1)
  assert.equal(r.error, null)
})

test("enriching spends within budget, rescores, and reports cost", async () => {
  const { chat, seen } = script(
    say(call("enrich_profiles", { refs: ["p1", "p2"] })),
    say(call("submit_ranking", { entries: [] }))
  )
  const { h, enriched } = hooks()
  const r = await reviewCandidates(base(chat, h))
  assert.deepEqual(enriched, [["a", "b"]])
  assert.equal(r.enriched, 2)
  assert.equal(r.costMicro, 3000)
  assert.equal(r.judgements.get("a")?.score, 90)
  // The model saw the new score and what is left to spend.
  const tool = seen[1]!.at(-1)!
  assert.equal(tool.role, "tool")
  assert.match(String(tool.content), /"score":90/)
  assert.match(String(tool.content), /remaining/)
})

test("the budget is enforced by the server, not the prompt", async () => {
  const { chat } = script(
    say(call("enrich_profiles", { refs: ["p1", "p2", "p3"] })),
    say(call("submit_ranking", { entries: [] }))
  )
  const { h, enriched } = hooks()
  const r = await reviewCandidates(base(chat, h, { budgetMicro: 4000 }))
  assert.deepEqual(enriched, [["a", "b"]]) // room for two at 2000 each
  assert.equal(r.enriched, 2)
})

test("a budget below one profile never offers the enrich tool", async () => {
  const offered: string[][] = []
  const chat: Chat = async ({ tools }) => {
    offered.push((tools ?? []).map((t) => t.function.name))
    return say(call("enrich_profiles", { refs: ["p1"] }))
  }
  const { h, enriched } = hooks()
  const r = await reviewCandidates(
    base(chat, h, { budgetMicro: 1000, maxSteps: 2 })
  )
  assert.ok(!offered[0]!.includes("enrich_profiles"))
  assert.equal(enriched.length, 0)
  assert.equal(r.costMicro, 0)
})

test("refs outside the list, repeats and people without a profile are refused", async () => {
  const { chat, seen } = script(
    say(call("enrich_profiles", { refs: ["p9", "p3", "p1", "p1"] })),
    say(call("enrich_profiles", { refs: ["p1"] })),
    say(
      call("submit_ranking", {
        entries: [{ ref: "zzz", score: 50, reason: "x" }],
      })
    )
  )
  const { h, enriched } = hooks()
  const r = await reviewCandidates(
    base(chat, h, {
      candidates: [
        candidate("a", 80),
        candidate("b", 60),
        candidate("c", 20, { canEnrich: false }),
      ],
    })
  )
  assert.deepEqual(enriched, [["a"]]) // p9 unknown, p3 cannot, p1 only once, second call refused
  assert.match(String(seen[1]!.at(-1)!.content), /unknown ref/)
  assert.match(String(seen[1]!.at(-1)!.content), /no LinkedIn profile/)
  assert.match(String(seen[2]!.at(-1)!.content), /already fetched/)
  assert.equal(r.judgements.size, 3)
  assert.equal(r.judgements.get("a")?.score, 90)
})

test("the loop stops at the step cap", async () => {
  const chat: Chat = async () => say(call("get_person", { ref: "p1" }))
  const { h } = hooks()
  const r = await reviewCandidates(base(chat, h, { maxSteps: 3 }))
  assert.equal(r.steps, 3)
  assert.equal(r.reviewed, 1)
  assert.equal(r.error, null)
})

test("malformed tool calls come back as errors, not crashes", async () => {
  const { chat, seen } = script(
    say(
      call("get_person", "{not json", "1"),
      call("nope", {}, "2"),
      call("get_person", { ref: 7 }, "3")
    ),
    say(call("submit_ranking", { entries: "all of them" }))
  )
  const { h } = hooks()
  const r = await reviewCandidates(base(chat, h, { maxSteps: 2 }))
  const tools = seen[1]!
    .filter((m) => m.role === "tool")
    .map((m) => String(m.content))
  assert.equal(tools.length, 3)
  for (const t of tools) assert.match(t, /error/)
  assert.equal(r.error, null)
})

test("a model failure keeps what was already done", async () => {
  const { chat } = script(say(call("enrich_profiles", { refs: ["p1"] })))
  const { h } = hooks()
  const r = await reviewCandidates(base(chat, h))
  assert.match(r.error ?? "", /script ran out/)
  assert.equal(r.enriched, 1)
  assert.equal(r.costMicro, 1500)
  assert.equal(r.judgements.get("a")?.score, 90)
})

test("a plain reply ends the run with notes", async () => {
  const { chat } = script({ content: "Looks right to me.", toolCalls: [] })
  const { h } = hooks()
  const r = await reviewCandidates(base(chat, h))
  assert.equal(r.notes, "Looks right to me.")
  assert.equal(r.steps, 1)
})

test("a failing enrich hook does not end the run", async () => {
  const { chat } = script(
    say(call("enrich_profiles", { refs: ["p1"] })),
    say(call("submit_ranking", { entries: [] }))
  )
  const { h } = hooks({
    enrich: async () => {
      throw new Error("treg down")
    },
  })
  const r = await reviewCandidates(base(chat, h))
  assert.equal(r.steps, 2)
  assert.equal(r.enriched, 0)
})
