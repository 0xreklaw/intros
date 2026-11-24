import { z } from "zod"

/**
 * What a search means, written once by the model and then given to every judgement of that
 * search. Without it each batch of people is scored against its own reading of the words, and
 * scores drift between batches.
 */
export interface SearchBrief {
  /** One sentence: who the search is for. */
  summary: string
  /** Things that must be true of a match. */
  mustHave: string[]
  /** Things that make a match stronger. */
  plus: string[]
  /** Things that rule someone out. */
  rulesOut: string[]
  /** How to treat people whose facts do not say. */
  whenUnknown: string
}

const lines = z.array(z.string().trim().min(1).max(200)).max(8).catch([])

const briefSchema = z.object({
  summary: z.string().trim().min(1).max(300),
  mustHave: lines,
  plus: lines,
  rulesOut: lines,
  whenUnknown: z.string().trim().max(300).catch(""),
})

/** Read the model's reply. Returns null when it is not a usable brief. */
export function parseBrief(content: string): SearchBrief | null {
  let json: unknown
  try {
    json = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""))
  } catch {
    return null
  }
  const parsed = briefSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

const section = (label: string, items: string[]) =>
  items.length ? [`${label}:`, ...items.map((i) => `- ${i}`)] : []

/** The brief as text for a prompt. */
export function briefText(brief: SearchBrief): string {
  return [
    `Looking for: ${brief.summary}`,
    ...section("Must be true", brief.mustHave),
    ...section("Makes a match stronger", brief.plus),
    ...section("Rules someone out", brief.rulesOut),
    brief.whenUnknown ? `When the facts do not say: ${brief.whenUnknown}` : "",
  ]
    .filter(Boolean)
    .join("\n")
}
