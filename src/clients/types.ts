/**
 * Shapes shared by the service, the JSON API and the browser. This file has no server imports,
 * so client components can import it without pulling Postgres into the bundle.
 */
import type { Recommendation } from "../intelligence/verdict"

export type { Recommendation }

/** Networks we can read follower lists from. */
export const SOCIAL_PLATFORMS = ["x", "instagram", "linkedin"] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]

export const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  x: "X",
  instagram: "Instagram",
  linkedin: "LinkedIn",
}

/** How one person is tied to another. */
export type Relationship = "mutual" | "follower" | "following"

/** Where to find a person on a network. */
export interface ProfileLink {
  platform: SocialPlatform
  url: string
}

export interface SocialSettings {
  /** Which networks to import for each employee. */
  platforms: SocialPlatform[]
  /** Most accounts to read from any one followers or following list. */
  maxPerList: number
  /** Keep only accounts that follow each other (X and Instagram). */
  mutualOnly: boolean
}

/** An employee's accounts, each as the handle on its network ("jane", "jane-doe"). */
export interface EmployeeSocials {
  x: string | null
  instagram: string | null
  linkedin: string | null
}

/** The profile page for a handle on a network. */
export function profileUrl(platform: SocialPlatform, handle: string): string {
  return platform === "linkedin"
    ? `https://www.linkedin.com/in/${handle}`
    : platform === "x"
      ? `https://x.com/${handle}`
      : `https://instagram.com/${handle}`
}

/** How searching behaves for the whole workspace. */
export interface SearchSettings {
  /** The search that runs when none is typed. */
  query: string
  /** Most the review agent may spend fetching profiles during one search, in micro-USD. */
  budgetMicro: number
}

/** The most a search may be allowed to spend on profiles: one dollar. */
export const MAX_SEARCH_BUDGET_MICRO = 1_000_000

export interface ClientSummary {
  id: string
  name: string
  domain: string | null
  industry: string | null
  location: string | null
  employeeCount: number
  /** Distinct people across the employees' networks. */
  connectionCount: number
  /** People who strongly match the default search. Null until it has been scored. */
  topCount: number | null
}

export interface EmployeeView {
  id: string
  clientId: string
  name: string | null
  title: string | null
  socials: EmployeeSocials
  connectionCount: number
}

export interface ClientDetail {
  client: ClientSummary
  employees: EmployeeView[]
}

/** One way an employee knows a person. */
export interface ReferralPath {
  employeeId: string
  employeeName: string | null
  platform: SocialPlatform
  relationshipType: Relationship
  strength: number
}

/** A person in the employees' networks, scored against a search. One row per person. */
export interface ReferralView {
  personId: string
  name: string | null
  title: string | null
  company: string | null
  industry: string | null
  /** Bio, headline or profile summary. */
  about: string | null
  /** 0 to 1: how well they match the search. */
  fit: number
  /** Where fit came from: judged by the LLM, not judged yet, or nothing to judge. */
  fitSource: "llm" | "pending" | "none"
  /** How sure the judge was, given the facts it had. Null when not judged. */
  confidence: "high" | "low" | null
  /** One sentence on why they match, or why not. */
  reason: string
  /** The review agent looked at this person in depth. */
  agentReviewed: boolean
  /** 0 to 1: how close the closest tie is. */
  warmth: number
  /** 0 to 1: fit and warmth combined. Results are sorted by this. */
  score: number
  recommendation: Recommendation
  recommendationLabel: string
  /** Strongest tie first. */
  paths: ReferralPath[]
  profiles: ProfileLink[]
  /** Nothing known beyond a name. */
  limitedInfo: boolean
  /** A fuller profile has been fetched. */
  enriched: boolean
  /** Has a LinkedIn profile we could fetch more from. */
  canEnrich: boolean
}

/** What the review agent did during a search. */
export interface AgentActivity {
  /** People it looked at, fetched or re-scored. */
  reviewed: number
  /** Full profiles it fetched. */
  enriched: number
  /** What those profiles cost, in micro-USD. */
  costMicro: number
  /** Its closing remark, if any. */
  notes: string | null
  /** Set when it stopped on an error. What it had done by then still stands. */
  error: string | null
}

export interface SearchResponse {
  /** The search text that was used. */
  query: string
  /** True when it is the default search from Settings. */
  isDefault: boolean
  /** `unavailable` when no LLM is set up: people are listed by closeness only. */
  mode: "llm" | "unavailable"
  results: ReferralView[]
  /** People across all networks, before the result limit. */
  total: number
  /** People still waiting to be read. */
  pending: number
  /** Everyone is read and the top matches have not had the agent's review yet. */
  reviewPending: boolean
  /** What the agent did on this request. Null when it did not run. */
  agent: AgentActivity | null
  /** People left out by the country lists in Settings. Null when no list is set. */
  hiddenByCountry: { hidden: number; unknown: number } | null
  /** Set when reading or review failed. Whatever was done before still shows. */
  error: string | null
}

/** Everything we hold about one prospect, plus a written profile of them. */
export interface ProspectProfile {
  personId: string
  name: string | null
  title: string | null
  company: string | null
  industry: string | null
  location: string | null
  headline: string | null
  /** Full bio or about text. */
  about: string | null
  experience: { title: string | null; company: string; period: string | null }[]
  skills: string[]
  /** When a full LinkedIn profile was last fetched. */
  enrichedAt: string | null
  profiles: ProfileLink[]
  /** Written from the facts above. `ai` when a model wrote it, `facts` when assembled without one. */
  brief: { text: string; source: "ai" | "facts" }
}

export interface EnrichSummary {
  /** People we will fetch, or did fetch. */
  people: number
  /** People skipped for lack of a LinkedIn profile or because they were done already. */
  skipped: number
  costMicro: number
  /** Failures, one message each. */
  errors: string[]
}

export interface ImportResult {
  ok: boolean
  message: string
  found: number
  added: number
  updated: number
  costMicro: number
  callId: string | null
  hasMore: boolean
}

export interface SocialImportResult {
  ok: boolean
  message: string
  /** One entry per network that was tried or skipped. */
  platforms: {
    platform: SocialPlatform
    status: "imported" | "skipped" | "error"
    /** Accounts saved as connections. */
    saved: number
    message: string
  }[]
  saved: number
  costMicro: number
}
