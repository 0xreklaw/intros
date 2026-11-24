import {
  PLATFORM_LABEL,
  type Recommendation,
  type ReferralPath,
  type Relationship,
} from "@/src/clients/types"

export const RELATIONSHIP_LABEL: Record<Relationship, string> = {
  mutual: "Follow each other",
  follower: "Follower",
  following: "Following",
}

/** Badge colour per recommendation. Uses the shared Badge; only the tint changes. */
export const RECOMMENDATION_CLASS: Record<Recommendation, string> = {
  ask: "bg-emerald-500/12 text-emerald-700",
  maybe: "bg-amber-500/15 text-amber-700",
  skip: "bg-secondary text-muted-foreground",
}

/** "Priya Patel (X, follow each other)" */
export function pathLabel(path: ReferralPath): string {
  return `${path.employeeName ?? "Someone"} (${tieLabel(path)})`
}

/** "X, follow each other": how an employee knows someone, without the employee's name. */
export function tieLabel(path: ReferralPath): string {
  return `${PLATFORM_LABEL[path.platform]}, ${RELATIONSHIP_LABEL[path.relationshipType].toLowerCase()}`
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

export function usd(costMicro: number): string {
  return `$${(costMicro / 1_000_000).toFixed(4)}`
}
