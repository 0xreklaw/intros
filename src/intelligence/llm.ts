import { z } from "zod"
import { env } from "../config"
import { briefText, parseBrief, type SearchBrief } from "./search-brief"

/**
 * Client for OpenRouter's chat completions API and the three jobs the app gives it:
 *
 *   - `interpretQuery`  turn a search into a brief every judgement shares
 *   - `scoreCards`      rate how well each person matches, with a confidence and a reason
 *   - `writeBrief`      write a short profile of one person
 *
 * The review agent in agent.ts uses `openRouterChat` directly, for tool calling. Replies are
 * validated; anything the model skips or garbles comes back as null so callers can say so.
 */

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  role: "system" | "user"
  content: string
}

/** Sends messages, returns the model's reply text. Injectable so tests need no network. */
export type Complete = (messages: ChatMessage[]) => Promise<string>

export interface ToolCall {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

export interface ToolSpec {
  type: "function"
  function: { name: string; description: string; parameters: object }
}

/** A message in a tool-calling conversation. */
export type AgentMessage =
  | ChatMessage
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string }

export interface Reply {
  content: string | null
  toolCalls: ToolCall[]
}

/** One model turn, with optional tools. Injectable so tests need no network. */
export type Chat = (request: {
  messages: AgentMessage[]
  tools?: ToolSpec[]
}) => Promise<Reply>

export function llmConfigured(): boolean {
  return Boolean(env.OPENROUTER_API_KEY)
}

export const llmModel = () => env.OPENROUTER_MODEL
/** The review agent can use a stronger model; it defaults to the scoring model. */
const agentModel = () => env.OPENROUTER_AGENT_MODEL || env.OPENROUTER_MODEL

const TIMEOUT_MS = 60_000

async function post(body: Record<string, unknown>): Promise<Reply> {
  const url = `${env.OPENROUTER_BASE_URL.replace(/\/$/, "")}/chat/completions`
  const send = () =>
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "x-title": "intros",
      },
      body: JSON.stringify({ temperature: 0, ...body }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

  // One retry for a dropped connection, a rate limit or a server hiccup.
  let res: Response
  try {
    res = await send()
    if (res.status === 429 || res.status >= 500)
      throw new Error(`${res.status}`)
  } catch {
    await new Promise((r) => setTimeout(r, 1000))
    res = await send()
  }

  if (!res.ok)
    throw new Error(
      `LLM request failed (${res.status}): ${(await res.text()).slice(0, 200)}`
    )
  const data = (await res.json()) as {
    choices?: {
      message?: { content?: string | null; tool_calls?: ToolCall[] }
    }[]
  }
  const message = data.choices?.[0]?.message
  return {
    content: message?.content ?? null,
    toolCalls: message?.tool_calls ?? [],
  }
}

/** One turn of a tool-calling conversation, on the agent model. */
export const openRouterChat: Chat = ({ messages, tools }) =>
  post({
    model: agentModel(),
    messages,
    ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
  })

/** A JSON-mode completion on the scoring model. */
const openRouterComplete: Complete = async (messages) => {
  const reply = await post({
    model: env.OPENROUTER_MODEL,
    response_format: { type: "json_object" },
    messages,
  })
  if (!reply.content) throw new Error("LLM returned no content")
  return reply.content
}

const unfence = (content: string) =>
  content.replace(/^```(?:json)?\s*|\s*```$/g, "")

/* ------------------------------------------------------------------ */
/* Interpret: a search becomes a brief                                 */
/* ------------------------------------------------------------------ */

const INTERPRET_PROMPT = `You help a company decide who is worth asking for an introduction.
You get a search written in plain words. Turn it into a short brief that a judge will use to rate many people against it, consistently.
Read the search for what it means, not just the words: "business owners in marketing" includes a founder of a small agency, and excludes an employee at a large bank.
Do not invent requirements the search does not imply. Keep every list short.
Reply with JSON only: {"summary":"one sentence on who this is for","mustHave":["..."],"plus":["..."],"rulesOut":["..."],"whenUnknown":"how to treat people whose facts do not say"}`

/** Write the brief for a search. Throws if the model returns nothing usable. */
export async function interpretQuery(
  query: string,
  complete: Complete = openRouterComplete
): Promise<SearchBrief> {
  const content = await complete([
    { role: "system", content: INTERPRET_PROMPT },
    { role: "user", content: `Search: ${query}` },
  ])
  const brief = parseBrief(content)
  if (!brief) throw new Error("LLM returned no usable brief")
  return brief
}

/* ------------------------------------------------------------------ */
/* Read: score people against the brief                                */
/* ------------------------------------------------------------------ */

export interface CardScore {
  /** 0 to 100. */
  score: number
  /** How sure the judge is, given the facts it had. */
  confidence: "high" | "low"
  reason: string
}

const BATCH_SIZE = 25
const CONCURRENCY = 4
const ATTEMPTS = 2

const SCORE_PROMPT = `You help a company find people worth asking for an introduction.
You get a search, a brief that says what the search means, and a numbered list of people. Rate how well each person matches from 0 to 100, using only the facts given. 100 is a clear, strong match, 50 is plausible, 0 is clearly not a match. Follow the brief.
Also say how sure you are: "high" when the facts settle it either way, "low" when a missing fact could change the score (a thin bio, no company, an unclear role).
Write each reason as one plain sentence of at most 20 words that names the fact it rests on.
Reply with JSON only, one entry per person: {"results":[{"id":1,"score":80,"confidence":"high","reason":"..."}]}`

export function buildMessages(
  query: string,
  brief: SearchBrief,
  cards: string[]
): ChatMessage[] {
  const people = cards.map((card, i) => `${i + 1}.\n${card}`).join("\n\n")
  return [
    { role: "system", content: SCORE_PROMPT },
    {
      role: "user",
      content: `Search: ${query}\n\nBrief:\n${briefText(brief)}\n\nPeople:\n\n${people}`,
    },
  ]
}

const entrySchema = z.object({
  id: z.coerce.number().int(),
  // A missing or null score must be rejected, not read as 0.
  score: z
    .union([z.number(), z.string().trim().min(1).pipe(z.coerce.number())])
    .transform((n) => Math.min(100, Math.max(0, n))),
  confidence: z.enum(["high", "low"]).catch("low"),
  reason: z.string().trim().min(1).max(300),
})

/** Map card index (0-based) to its score. Entries that are out of range or malformed are dropped. */
export function parseScores(
  content: string,
  count: number
): Map<number, CardScore> {
  const out = new Map<number, CardScore>()
  let json: unknown
  try {
    json = JSON.parse(unfence(content))
  } catch {
    return out
  }
  const results = (json as { results?: unknown } | null)?.results
  if (!Array.isArray(results)) return out
  for (const raw of results) {
    const r = entrySchema.safeParse(raw)
    if (!r.success) continue
    const index = r.data.id - 1
    if (index >= 0 && index < count && !out.has(index))
      out.set(index, {
        score: Math.round(r.data.score),
        confidence: r.data.confidence,
        reason: r.data.reason,
      })
  }
  return out
}

async function scoreBatch(
  query: string,
  brief: SearchBrief,
  cards: string[],
  complete: Complete
): Promise<(CardScore | null)[]> {
  let scores = new Map<number, CardScore>()
  let lastError: unknown = null
  for (let attempt = 0; attempt < ATTEMPTS && scores.size === 0; attempt++) {
    try {
      scores = parseScores(
        await complete(buildMessages(query, brief, cards)),
        cards.length
      )
    } catch (err) {
      lastError = err
    }
  }
  // A batch that failed outright is an error worth showing; a partial reply just leaves nulls.
  if (scores.size === 0 && lastError) throw lastError
  return cards.map((_, i) => scores.get(i) ?? null)
}

/**
 * Score every card against the search, in batches run a few at a time. The result lines up
 * with `cards`; people in a batch that failed after retrying come back as null. Throws only
 * when every batch failed.
 */
export async function scoreCards(params: {
  query: string
  brief: SearchBrief
  cards: string[]
  complete?: Complete
  batchSize?: number
  concurrency?: number
}): Promise<(CardScore | null)[]> {
  const complete = params.complete ?? openRouterComplete
  const size = params.batchSize ?? BATCH_SIZE
  const batches: string[][] = []
  for (let i = 0; i < params.cards.length; i += size)
    batches.push(params.cards.slice(i, i + size))

  // One failed batch must not throw away the batches that worked (they were paid for).
  // Failed batches come back as nulls; only a total failure is an error.
  const results: (CardScore | null)[][] = new Array(batches.length)
  const errors: unknown[] = []
  let next = 0
  const worker = async () => {
    while (next < batches.length) {
      const i = next++
      const batch = batches[i]!
      try {
        results[i] = await scoreBatch(
          params.query,
          params.brief,
          batch,
          complete
        )
      } catch (err) {
        errors.push(err)
        results[i] = batch.map(() => null)
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(params.concurrency ?? CONCURRENCY, batches.length) },
      worker
    )
  )
  if (errors.length === batches.length && errors[0]) throw errors[0]
  return results.flat()
}

/* ------------------------------------------------------------------ */
/* Identify: which account, if any, belongs to a person                */
/* ------------------------------------------------------------------ */

export interface AccountCandidate {
  /** The handle or profile URL. What `pickAccount` returns. */
  key: string
  name: string | null
  /** Bio, headline or role, whichever the network shows. */
  about: string | null
}

const PICK_PROMPT = `You match a person to their account on a social network.
You get who the person is (name, company, and sometimes role) and a numbered list of accounts a search returned. Choose the account only if it is clearly the same person: the name matches and nothing contradicts the company or role, or the bio mentions them or their company. A similar name alone is not enough. Common names, fan accounts, parody accounts, company accounts and accounts of other people with the same name are not matches.
Evidence that an account is the person: the bio or role names their company, a link goes to their company's website, the account is verified or has a large following that fits their role, or another account's bio points to it. A backup, secondary or fan account that says it belongs to someone else is not the person; the account it points to is. An account that only shares a name, or is their company's own account, is weaker.
When unsure, choose none. A wrong match is worse than no match.
Reply with JSON only: {"reason":"one short sentence","choice":2} for the account you choose, or {"reason":"...","choice":null}.`

/**
 * Pick the account that belongs to this person from a search's results, or null. A wrong
 * match would read a stranger's network, so the model is told to prefer none, and only a
 * choice that is really in the list is accepted.
 */
export async function pickAccount(
  person: { name: string; company: string | null; title: string | null },
  platform: string,
  candidates: AccountCandidate[],
  complete: Complete = openRouterComplete
): Promise<string | null> {
  if (!candidates.length) return null
  const who = [
    `Name: ${person.name}`,
    person.company ? `Company: ${person.company}` : null,
    person.title ? `Role: ${person.title}` : null,
  ]
    .filter(Boolean)
    .join("\n")
  const accounts = candidates
    .map(
      (c, i) =>
        `${i + 1}. ${c.key}${c.name ? ` | ${c.name}` : ""}${c.about ? ` | ${c.about.slice(0, 200)}` : ""}`
    )
    .join("\n")
  const content = await complete([
    { role: "system", content: PICK_PROMPT },
    {
      role: "user",
      content: `Network: ${platform}\n\nPerson:\n${who}\n\nAccounts:\n${accounts}`,
    },
  ])
  let choice: unknown
  try {
    choice = (JSON.parse(unfence(content)) as { choice?: unknown } | null)
      ?.choice
  } catch {
    return null
  }
  const n = typeof choice === "string" ? Number(choice) : choice
  return typeof n === "number" && Number.isInteger(n) && n >= 1
    ? (candidates[n - 1]?.key ?? null)
    : null
}

/* ------------------------------------------------------------------ */
/* Countries: which country a free-text location is in                 */
/* ------------------------------------------------------------------ */

const COUNTRY_PROMPT = `You tell which country each place is in.
You get a numbered list of locations written by people on LinkedIn or X, such as "Lahore, Punjab, Pakistan", "Greater Delhi Area", "Lae", "Austin, Texas" or "Remote". Give the ISO 3166-1 alpha-2 code of the country each is in. Use what you know about places: a city or region alone is enough when it is clearly in one country. If a place could be in several countries, is not a place ("Remote", "Earth", "Worldwide") or you are not sure, give null.
Reply with JSON only: {"countries":{"1":"PK","2":"IN","3":null}} with one entry for every number.`

const COUNTRY_BATCH = 100

/**
 * The country code of each location, or null where it cannot be told. Locations are sent in
 * batches; a batch that fails leaves its locations as null for the caller to retry later, and
 * only a total failure throws.
 */
export async function countriesOf(
  locations: string[],
  complete: Complete = openRouterComplete
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  const batches: string[][] = []
  for (let i = 0; i < locations.length; i += COUNTRY_BATCH)
    batches.push(locations.slice(i, i + COUNTRY_BATCH))
  let failed = 0
  let firstError: unknown = null
  for (const batch of batches) {
    try {
      const content = await complete([
        { role: "system", content: COUNTRY_PROMPT },
        {
          role: "user",
          content: batch.map((l, i) => `${i + 1}. ${l}`).join("\n"),
        },
      ])
      const parsed = (
        JSON.parse(unfence(content)) as {
          countries?: Record<string, unknown>
        } | null
      )?.countries
      if (!parsed || typeof parsed !== "object")
        throw new Error("Country reply was not usable")
      batch.forEach((location, i) => {
        const code = parsed[String(i + 1)]
        out.set(
          location,
          typeof code === "string" && /^[A-Za-z]{2}$/.test(code)
            ? code.toUpperCase()
            : null
        )
      })
    } catch (err) {
      failed++
      firstError ??= err
    }
  }
  if (failed === batches.length && firstError) throw firstError
  return out
}

/* ------------------------------------------------------------------ */
/* Profile: a short written briefing on one person                     */
/* ------------------------------------------------------------------ */

const PROFILE_PROMPT = `You write a short briefing about one person for someone deciding whether to ask for an introduction to them.
Use only the facts given. Write 3 to 5 plain sentences of prose: who they are, what they do and have done, and anything that stands out. Do not praise, do not guess, and do not repeat the facts as a list. If the facts are thin, say what is missing.
Reply with JSON only: {"brief":"..."}`

/** A written profile of one person from their facts. Throws if the model returns nothing usable. */
export async function writeBrief(
  facts: string,
  complete: Complete = openRouterComplete
): Promise<string> {
  const content = await complete([
    { role: "system", content: PROFILE_PROMPT },
    { role: "user", content: facts },
  ])
  const stripped = unfence(content)
  let text: unknown = null
  try {
    text = (JSON.parse(stripped) as { brief?: unknown } | null)?.brief
  } catch {
    // Not JSON: a plain reply is still a usable brief.
    text = stripped
  }
  const brief = typeof text === "string" ? text.trim() : ""
  if (!brief) throw new Error("LLM returned no brief")
  return brief.slice(0, 1500)
}
