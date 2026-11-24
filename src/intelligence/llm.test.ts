import assert from "node:assert/strict"
import { test } from "node:test"
import {
  buildMessages,
  countriesOf,
  interpretQuery,
  pickAccount,
  parseScores,
  scoreCards,
  type Complete,
} from "./llm"
import type { SearchBrief } from "./search-brief"

const brief: SearchBrief = {
  summary: "founders",
  mustHave: [],
  plus: [],
  rulesOut: [],
  whenUnknown: "Give a low score and low confidence.",
}

const reply = (ids: number[]) =>
  JSON.stringify({
    results: ids.map((id) => ({
      id,
      score: id * 10,
      confidence: "high",
      reason: `reason ${id}`,
    })),
  })

test("parseScores maps ids to zero-based cards and clamps scores and drops bad entries", () => {
  const out = parseScores(
    JSON.stringify({
      results: [
        { id: 1, score: 80.4, reason: "ok" },
        { id: 9, score: 50, reason: "out of range" },
        { id: 2, score: 140, reason: "too high" },
      ],
    }),
    3
  )
  assert.deepEqual(out.get(0), {
    score: 80,
    confidence: "low",
    reason: "ok",
  })
  assert.equal(out.get(1)?.score, 100)
  assert.equal(out.size, 2)
})

test("parseScores accepts a fenced reply and ignores garbage", () => {
  assert.equal(parseScores("```json\n" + reply([1]) + "\n```", 1).size, 1)
  assert.equal(parseScores("not json", 1).size, 0)
})

test("scoreCards splits into batches and keeps order", async () => {
  const calls: number[] = []
  const complete: Complete = async (messages) => {
    const n = (messages[1]!.content.match(/^\d+\./gm) ?? []).length
    calls.push(n)
    return reply(Array.from({ length: n }, (_, i) => i + 1))
  }
  const cards = Array.from({ length: 5 }, (_, i) => `Name: P${i}`)
  const out = await scoreCards({
    query: "q",
    brief,
    cards,
    complete,
    batchSize: 2,
  })
  assert.deepEqual(calls.sort(), [1, 2, 2])
  assert.equal(out.length, 5)
  assert.equal(out[0]?.score, 10)
  assert.equal(out[4]?.score, 10)
})

test("scoreCards retries once, then reports the error", async () => {
  let attempts = 0
  const flaky: Complete = async () => {
    attempts++
    if (attempts === 1) throw new Error("boom")
    return reply([1])
  }
  const ok = await scoreCards({
    query: "q",
    brief,
    cards: ["a"],
    complete: flaky,
  })
  assert.equal(ok[0]?.score, 10)

  const dead: Complete = async () => {
    throw new Error("down")
  }
  await assert.rejects(
    scoreCards({ query: "q", brief, cards: ["a"], complete: dead }),
    /down/
  )
})

test("a partial reply leaves nulls for the missing people", async () => {
  const complete: Complete = async () => reply([1])
  const out = await scoreCards({
    query: "q",
    brief,
    cards: ["a", "b"],
    complete,
  })
  assert.equal(out[0]?.score, 10)
  assert.equal(out[1], null)
})

test("a missing or null score is dropped, not read as zero", () => {
  const out = parseScores(
    JSON.stringify({
      results: [
        { id: 1, reason: "no score" },
        { id: 2, score: null, reason: "null score" },
        { id: 3, score: "75", reason: "string score" },
      ],
    }),
    3
  )
  assert.equal(out.size, 1)
  assert.equal(out.get(2)?.score, 75)
})

test("one failed batch keeps the batches that worked", async () => {
  const complete: Complete = async (messages) => {
    if (messages[1]!.content.includes("Name: bad")) throw new Error("boom")
    return reply([1])
  }
  const out = await scoreCards({
    query: "q",
    brief,
    cards: ["Name: good", "Name: bad"],
    complete,
    batchSize: 1,
  })
  assert.equal(out[0]?.score, 10)
  assert.equal(out[1], null)
})

test("the prompt numbers people from 1", () => {
  const user = buildMessages("founders", brief, ["Name: A", "Name: B"])[1]!
    .content
  assert.match(user, /Search: founders/)
  assert.match(user, /Looking for: founders/)
  assert.match(user, /1\.\nName: A/)
  assert.match(user, /2\.\nName: B/)
})

test("confidence is kept when valid and defaults to low", () => {
  const out = parseScores(
    JSON.stringify({
      results: [
        { id: 1, score: 70, confidence: "high", reason: "a" },
        { id: 2, score: 70, confidence: "certain", reason: "b" },
      ],
    }),
    2
  )
  assert.equal(out.get(0)?.confidence, "high")
  assert.equal(out.get(1)?.confidence, "low")
})

test("interpretQuery reads a brief and rejects nonsense", async () => {
  const good: Complete = async () =>
    JSON.stringify({
      summary: "Owners of small marketing agencies",
      mustHave: ["owns or founded the business"],
      plus: ["agency under 50 people"],
      rulesOut: ["employee at a large company"],
      whenUnknown: "low score, low confidence",
    })
  const b = await interpretQuery("marketing owners", good)
  assert.equal(b.summary, "Owners of small marketing agencies")
  assert.deepEqual(b.mustHave, ["owns or founded the business"])

  await assert.rejects(
    interpretQuery("x", async () => "not json"),
    /no usable brief/
  )
})

const who = { name: "Jane Smith", company: "Acme", title: null }
const accounts = [
  { key: "janesmith", name: "Jane Smith", about: "Mom, runner" },
  { key: "jane_acme", name: "Jane Smith", about: "CEO at Acme" },
]

test("pickAccount returns the chosen account's key", async () => {
  const seen: string[] = []
  const pick = await pickAccount(who, "X", accounts, async (messages) => {
    seen.push(messages[1]!.content)
    return JSON.stringify({ choice: 2 })
  })
  assert.equal(pick, "jane_acme")
  assert.match(seen[0]!, /Company: Acme/)
  assert.match(seen[0]!, /2\. jane_acme/)
})

test("pickAccount accepts only a choice that is in the list", async () => {
  for (const reply of [
    JSON.stringify({ choice: null }),
    JSON.stringify({ choice: 0 }),
    JSON.stringify({ choice: 3 }),
    JSON.stringify({ choice: "jane_acme" }),
    JSON.stringify({ choice: 1.5 }),
    "not json",
  ])
    assert.equal(
      await pickAccount(who, "X", accounts, async () => reply),
      null,
      reply
    )
})

test("pickAccount makes no call when there is nothing to choose from", async () => {
  let called = false
  const pick = await pickAccount(who, "X", [], async () => {
    called = true
    return "{}"
  })
  assert.equal(pick, null)
  assert.equal(called, false)
})

test("countriesOf maps each place to a code and keeps unknowns as null", async () => {
  const seen: string[] = []
  const complete = async (messages: { content: string }[]) => {
    seen.push(messages[1]!.content)
    return '```json\n{"countries":{"1":"pk","2":null,"3":"IN"}}\n```'
  }
  const out = await countriesOf(
    ["Lahore", "Remote", "Greater Delhi Area"],
    complete
  )
  assert.equal(out.get("Lahore"), "PK")
  assert.equal(out.get("Remote"), null)
  assert.equal(out.get("Greater Delhi Area"), "IN")
  assert.match(seen[0]!, /1\. Lahore\n2\. Remote\n3\. Greater Delhi Area/)
})

test("countriesOf leaves a failed batch unread, and throws only when all fail", async () => {
  const places = Array.from({ length: 150 }, (_, i) => `Place ${i}`)
  let call = 0
  const half = async () => {
    if (call++ === 0) throw new Error("boom")
    return JSON.stringify({
      countries: Object.fromEntries(
        Array.from({ length: 50 }, (_, i) => [String(i + 1), "US"])
      ),
    })
  }
  const out = await countriesOf(places, half)
  assert.ok(!out.has("Place 0"))
  assert.equal(out.get("Place 100"), "US")
  await assert.rejects(
    countriesOf(["x"], async () => {
      throw new Error("down")
    }),
    /down/
  )
})
