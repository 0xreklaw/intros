import type { Recommendation } from "@/src/intelligence/verdict"
import type { ReferralView } from "@/src/clients/types"

/** What the filter bar above a list can narrow it by. Empty or "all" means no narrowing. */
export interface ReferralFilters {
  /** Part of a name, title, company or the reason. */
  text: string
  platform: "all" | "linkedin" | "x" | "instagram"
  /** How the employee knows them. */
  relationship: "all" | "mutual" | "follower" | "following"
  /** `top` is every verdict but Skip: the people worth asking about. */
  verdict: "all" | "top" | Recommendation
  /** Lowest fit, 0 to 100. Zero keeps everyone, including people not rated yet. */
  minFit: number
}

export const NO_FILTERS: ReferralFilters = {
  text: "",
  platform: "all",
  relationship: "all",
  verdict: "all",
  minFit: 0,
}

/** Whether `f` narrows the list beyond `base`, the filters a list starts with. */
export const isFiltering = (
  f: ReferralFilters,
  base: ReferralFilters = NO_FILTERS
) =>
  f.text.trim() !== base.text.trim() ||
  f.platform !== base.platform ||
  f.relationship !== base.relationship ||
  f.verdict !== base.verdict ||
  f.minFit !== base.minFit

/**
 * The rows that pass every filter. A network and a kind of tie must hold on the same path:
 * someone followed on X and merely a follower on LinkedIn is not a "LinkedIn mutual".
 */
export function applyFilters(
  rows: ReferralView[],
  f: ReferralFilters
): ReferralView[] {
  const text = f.text.trim().toLowerCase()
  return rows.filter((r) => {
    if (f.verdict === "top" && r.recommendation === "skip") return false
    if (
      f.verdict !== "all" &&
      f.verdict !== "top" &&
      r.recommendation !== f.verdict
    )
      return false
    if (f.minFit > 0 && Math.round(r.fit * 100) < f.minFit) return false
    if (
      (f.platform !== "all" || f.relationship !== "all") &&
      !r.paths.some(
        (p) =>
          (f.platform === "all" || p.platform === f.platform) &&
          (f.relationship === "all" || p.relationshipType === f.relationship)
      )
    )
      return false
    if (text) {
      const haystack = [r.name, r.title, r.company, r.about, r.reason]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      if (!haystack.includes(text)) return false
    }
    return true
  })
}
