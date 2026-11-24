/**
 * The facts we hold about a prospect, and two ways to turn them into a short written profile:
 * the LLM (see `writeBrief` in llm.ts), or `factsBrief` below when no key is set or the call
 * fails. Pure, so it is tested without a database or network.
 */

export interface ProspectFacts {
  name: string | null
  title: string | null
  company: string | null
  industry: string | null
  location: string | null
  headline: string | null
  /** Full bio or about text. */
  about: string | null
  experience: {
    title: string | null
    company: string
    period?: string | null
  }[]
  skills: string[]
}

const clean = (v: string | null | undefined) => v?.trim() || null

const jobLine = (e: ProspectFacts["experience"][number]) => {
  const role = e.title ? `${e.title} at ${e.company}` : e.company
  return e.period ? `${role} (${e.period})` : role
}

/** Every fact as labelled lines. This is what the LLM reads, and what the cache keys on. */
export function factsText(f: ProspectFacts): string {
  const lines = [
    ["Name", f.name],
    ["Title", f.title],
    ["Company", f.company],
    ["Industry", f.industry],
    ["Location", f.location],
    ["Headline", f.headline],
    ["About", f.about],
  ].flatMap(([label, value]) => {
    const v = clean(value)
    return v ? [`${label}: ${v}`] : []
  })
  if (f.experience.length)
    lines.push(`Experience: ${f.experience.map(jobLine).join("; ")}`)
  if (f.skills.length) lines.push(`Skills: ${f.skills.join(", ")}`)
  return lines.join("\n")
}

/** True when there is more than a name to write about. */
export function hasFacts(f: ProspectFacts): boolean {
  return Boolean(
    clean(f.title) ||
    clean(f.company) ||
    clean(f.about) ||
    clean(f.headline) ||
    f.experience.length ||
    f.skills.length
  )
}

/** A plain paragraph built straight from the facts, with no model involved. */
export function factsBrief(f: ProspectFacts): string {
  const name = clean(f.name) ?? "This person"
  if (!hasFacts(f))
    return `We only know ${name === "This person" ? "a name" : name} so far. Fetch their profile to build this out.`

  const role = [clean(f.title), clean(f.company)].filter(Boolean).join(" at ")
  const sentences: string[] = []

  let intro = role ? `${name} is ${role}` : name
  if (clean(f.industry)) intro += ` in ${f.industry}`
  if (clean(f.location)) intro += `, based in ${f.location}`
  sentences.push(`${intro}.`)

  const headline = clean(f.headline)
  if (headline && headline !== role)
    sentences.push(`${headline.replace(/\.$/, "")}.`)

  const about = clean(f.about)
  if (about) {
    const first = about
      .split(/(?<=[.!?])\s+/)
      .slice(0, 2)
      .join(" ")
    sentences.push(first.length > 300 ? `${first.slice(0, 297)}…` : first)
  }

  const earlier = f.experience.filter(
    (e) => !(e.company === f.company && e.title === f.title)
  )
  if (earlier.length)
    sentences.push(
      `Before that: ${earlier.slice(0, 3).map(jobLine).join("; ")}.`
    )
  if (f.skills.length)
    sentences.push(`Known for ${f.skills.slice(0, 5).join(", ")}.`)

  return sentences.join(" ")
}
