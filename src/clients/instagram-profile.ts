import { recordCall, tregCall } from "../enrichment/index"
import { rec, text } from "./parse"

/**
 * An Instagram profile through treg (`treg.instagram.user.profile`, about a tenth of a cent).
 * A follower list gives only a handle and a name, so this is where a bio, a website and the
 * size of the account come from: what tells one Eddie from another, and what the search needs
 * to judge a contact at all.
 */

export interface InstagramProfile {
  handle: string
  name: string | null
  bio: string | null
  website: string | null
  followers: number | null
  verified: boolean
}

const TOOL = "treg.instagram.user.profile"

export function readInstagramProfile(body: unknown): InstagramProfile | null {
  const output = rec(rec(body)?.output)
  const handle = text(output?.username)
  if (!output || !handle) return null
  // The provider's own answer is nested under `raw`; its shape differs by provider, so the
  // website is read from wherever it is given.
  const user = rec(rec(rec(rec(rec(body)?.raw)?.data)?.data)?.user)
  const followers = Number(output.followers)
  return {
    handle: handle.toLowerCase(),
    name: text(output.full_name),
    bio: text(output.biography),
    website:
      text(output.external_url) ??
      text(output.website) ??
      text(user?.external_url),
    followers: Number.isFinite(followers) ? followers : null,
    verified: output.is_verified === true,
  }
}

/** One line for the model or the person's page: bio, then website, then size. */
export function profileSummary(p: InstagramProfile): string {
  const size =
    p.followers === null
      ? null
      : `${p.followers.toLocaleString("en-US")} followers${p.verified ? ", verified" : ""}`
  return [p.bio?.replace(/\s*\n\s*/g, " | "), p.website, size]
    .filter(Boolean)
    .join(" · ")
}

/** Fetch one profile and record the call. Cost is returned whether or not a profile came back. */
export async function fetchInstagramProfile(params: {
  tenantId: string
  tenantSlug: string
  handle: string
  personId?: string
  feature: string
}): Promise<{ profile: InstagramProfile | null; costMicro: number }> {
  const result = await tregCall({
    toolId: TOOL,
    body: { username: params.handle },
    tenantSlug: params.tenantSlug,
    feature: params.feature,
    maxCostUsd: 0.02,
  })
  const profile = result.ok ? readInstagramProfile(result.body) : null
  await recordCall({
    tenantId: params.tenantId,
    toolId: TOOL,
    personId: params.personId,
    result,
    outcome: !result.ok ? "error" : profile ? "hit" : "miss",
  })
  return { profile, costMicro: result.costMicro }
}
