import type { ProspectFacts } from "../intelligence/brief"
import { list, rec, text } from "./parse"
import { profileUrl, type ProfileLink, type SocialPlatform } from "./types"

/** The parsed LinkedIn profile kept in `people.metadata.profile`, tolerant of missing parts. */
function storedProfile(metadata: Record<string, unknown> | null) {
  const p = rec(metadata?.profile)
  const experience = list(p?.experience).flatMap((e) => {
    const company = text(e.company)
    return company
      ? [{ title: text(e.title), company, period: text(e.period) }]
      : []
  })
  return {
    headline: text(p?.headline),
    about: text(p?.about),
    location: text(p?.location),
    experience,
    skills: Array.isArray(p?.skills)
      ? p.skills.flatMap((s) => text(s) ?? [])
      : [],
  }
}

/** Every fact we hold about a person, from their row, their company and any fetched profile. */
export function prospectFacts(row: {
  name: string | null
  title: string | null
  summary: string | null
  metadata: Record<string, unknown> | null
  company: string | null
  industry: string | null
}): ProspectFacts {
  const stored = storedProfile(row.metadata)
  return {
    name: row.name,
    title: row.title,
    company: row.company,
    industry: row.industry,
    location: stored.location ?? text(row.metadata?.location),
    headline: stored.headline,
    // The full about when we have a fetched profile; otherwise the short bio we saved.
    about: stored.about ?? row.summary,
    experience: stored.experience,
    skills: stored.skills,
  }
}

/** Where to find someone on each network: the stored URL, or one built from their handle. */
export function profileLinks(
  identities: {
    provider: SocialPlatform
    handle: string | null
    url: string | null
  }[]
): ProfileLink[] {
  return identities.flatMap((i) => {
    const url = i.url ?? (i.handle ? profileUrl(i.provider, i.handle) : null)
    return url ? [{ platform: i.provider, url }] : []
  })
}
