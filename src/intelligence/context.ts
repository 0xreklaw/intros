import { createHash } from "node:crypto"
import { factsText, type ProspectFacts } from "./brief"

/**
 * Cache keys. A score is kept per search and per version of the facts it was made from, so a
 * new search never reuses an old score, and a person whose facts change is judged again.
 * Facts leave out how we reach someone: new paths should not make a score stale.
 */

export const sha1 = (text: string) =>
  createHash("sha1").update(text).digest("hex")

const normalizeQuery = (query: string) =>
  query.trim().replace(/\s+/g, " ").toLowerCase()

/** Identifies a search. Case and spacing do not matter. */
export const queryHash = (query: string) => sha1(normalizeQuery(query))

/** Identifies what we knew about a person when a score was made. */
export const factsHash = (facts: ProspectFacts) => sha1(factsText(facts))
