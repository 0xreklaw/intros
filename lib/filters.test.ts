import assert from "node:assert/strict"
import { test } from "node:test"
import type { ReferralView } from "../src/clients/types"
import { NO_FILTERS, applyFilters, isFiltering } from "./filters"

const row = (
  name: string,
  fit: number,
  recommendation: ReferralView["recommendation"],
  paths: [string, string][]
) =>
  ({
    personId: name,
    name,
    title: "Founder",
    company: null,
    about: null,
    reason: "Runs an agency",
    fit,
    recommendation,
    paths: paths.map(([platform, relationshipType]) => ({
      employeeId: "e",
      employeeName: "E",
      platform,
      relationshipType,
      strength: 0.5,
    })),
  }) as unknown as ReferralView

const rows = [
  row("Ann", 0.95, "ask", [["linkedin", "follower"]]),
  row("Bo", 0.6, "maybe", [["x", "mutual"]]),
  row("Cy", 0.2, "skip", [
    ["linkedin", "follower"],
    ["instagram", "mutual"],
  ]),
]
const names = (f: Partial<typeof NO_FILTERS>) =>
  applyFilters(rows, { ...NO_FILTERS, ...f }).map((r) => r.name)

test("no filters keeps everyone", () => {
  assert.ok(!isFiltering(NO_FILTERS))
  assert.deepEqual(names({}), ["Ann", "Bo", "Cy"])
})

test("filters by network, verdict and lowest fit", () => {
  assert.deepEqual(names({ platform: "linkedin" }), ["Ann", "Cy"])
  assert.deepEqual(names({ verdict: "maybe" }), ["Bo"])
  assert.deepEqual(names({ minFit: 50 }), ["Ann", "Bo"])
  assert.deepEqual(names({ minFit: 90 }), ["Ann"])
})

test("a network and a kind of tie must hold on the same path", () => {
  assert.deepEqual(names({ platform: "linkedin", relationship: "mutual" }), [])
  assert.deepEqual(names({ platform: "instagram", relationship: "mutual" }), [
    "Cy",
  ])
})

test("text matches name, title or reason, ignoring case", () => {
  assert.deepEqual(names({ text: "bo" }), ["Bo"])
  assert.deepEqual(names({ text: "AGENCY" }), ["Ann", "Bo", "Cy"])
  assert.deepEqual(names({ text: "zzz" }), [])
})

test("top means every verdict but Skip, and Clear goes back to the starting filters", () => {
  assert.deepEqual(names({ verdict: "top" }), ["Ann", "Bo"])
  const start = { ...NO_FILTERS, verdict: "top" as const }
  assert.ok(!isFiltering(start, start))
  assert.ok(isFiltering({ ...start, platform: "x" }, start))
})
