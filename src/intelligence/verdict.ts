/**
 * Turning fit and warmth into one ranking and a verdict. Pure, so browser code can use it
 * (for example to rescore a person against a single employee's tie).
 */
export type Recommendation = "ask" | "maybe" | "skip"

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  ask: "Ask for intro",
  maybe: "Maybe",
  skip: "Skip",
}

const FIT_SHARE = 0.75
/** "Ask" also needs real warmth, so a cold stranger who fits perfectly stays "maybe". */
const ASK_SCORE = 0.7
const ASK_WARMTH = 0.3
const MAYBE_SCORE = 0.4

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

export function rankScore(fit: number, warmth: number): number {
  return clamp01(FIT_SHARE * fit + (1 - FIT_SHARE) * warmth)
}

export function recommend(score: number, warmth: number): Recommendation {
  if (score >= ASK_SCORE && warmth >= ASK_WARMTH) return "ask"
  return score >= MAYBE_SCORE ? "maybe" : "skip"
}
