import assert from "node:assert/strict"
import { test } from "node:test"
import { rankScore, recommend } from "./verdict"

test("ask needs warmth, not just fit", () => {
  assert.equal(recommend(rankScore(1, 0.1), 0.1), "maybe")
  assert.equal(recommend(rankScore(1, 0.4), 0.4), "ask")
  assert.equal(recommend(rankScore(0.1, 0.9), 0.9), "skip")
})

test("fit outweighs warmth in the rank", () => {
  assert.ok(rankScore(1, 0) > rankScore(0, 1))
})

test("rank stays between 0 and 1", () => {
  assert.equal(rankScore(5, 5), 1)
  assert.equal(rankScore(-1, -1), 0)
})
