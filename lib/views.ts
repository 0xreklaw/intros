import {
  RECOMMENDATION_LABEL,
  rankScore,
  recommend,
} from "@/src/intelligence/verdict"
import type { ReferralView } from "@/src/clients/types"

/** Most people shown as top picks. */
const TOP_PICKS = 25
/** Most "closest" matches shown when nobody is a strong match. */
const CLOSEST = 10

/**
 * The best people for the current search, best first: everyone with an "ask for intro" or
 * "maybe" verdict. When nobody gets there, the closest few that match at all are returned
 * instead, marked `closest`, so the table is never empty just because a search is narrow.
 */
export function topPicks(results: ReferralView[]): {
  picks: ReferralView[]
  closest: boolean
} {
  const strong = results.filter((r) => r.recommendation !== "skip")
  if (strong.length)
    return { picks: strong.slice(0, TOP_PICKS), closest: false }
  const near = results.filter((r) => r.fit > 0).slice(0, CLOSEST)
  return { picks: near, closest: true }
}

/**
 * One employee's network, rescored through their own ties. A person several employees know
 * is judged here by how well this employee knows them, not by the closest of the team.
 */
export function forEmployee(
  results: ReferralView[],
  employeeId: string
): ReferralView[] {
  const mine: ReferralView[] = []
  for (const r of results) {
    const paths = r.paths.filter((p) => p.employeeId === employeeId)
    if (!paths.length) continue
    const warmth = paths[0]!.strength
    const score = rankScore(r.fit, warmth)
    const recommendation = recommend(score, warmth)
    mine.push({
      ...r,
      paths,
      warmth,
      score,
      recommendation,
      recommendationLabel: RECOMMENDATION_LABEL[recommendation],
    })
  }
  return mine.sort(
    (a, b) =>
      b.score - a.score ||
      b.warmth - a.warmth ||
      (a.name ?? "").localeCompare(b.name ?? "")
  )
}
