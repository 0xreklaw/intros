import { factsText, type ProspectFacts } from "../intelligence/brief"
import {
  interpretQuery,
  llmConfigured,
  llmModel,
  scoreCards,
} from "../intelligence/llm"

/**
 * Checks search quality against the real model. Not part of `npm test`: it needs
 * OPENROUTER_API_KEY and costs a few cents. Run it after changing a prompt or the model:
 *
 *   npm run eval
 *
 * A small fixed pool of people and a few searches, each with the people who should come out
 * on top. For every search it reads the whole pool, as the app does, and reports precision at
 * 3 (how many of the three best-scored people are right) and whether the right people outrank
 * the rest. Several people are chosen to trip a keyword search: "owner" with no title word in
 * common, a "founder" of something that is not a business, a famous name with an empty bio.
 */

const person = (
  id: string,
  facts: Partial<ProspectFacts>
): { id: string; facts: ProspectFacts } => ({
  id,
  facts: {
    name: id,
    title: null,
    company: null,
    industry: null,
    location: null,
    headline: null,
    about: null,
    experience: [],
    skills: [],
    ...facts,
  },
})

const POOL = [
  person("Dana Ruiz", {
    title: "Principal",
    company: "Ruiz & Co",
    industry: "Marketing and Advertising",
    about:
      "I started Ruiz & Co in 2014 and run it with a team of nine. We do brand and performance marketing for local businesses.",
  }),
  person("Marcus Bell", {
    title: "Founder & CEO",
    company: "Bell Creative",
    industry: "Marketing and Advertising",
    headline: "Building a boutique content marketing agency",
  }),
  person("Priya Shah", {
    title: "Marketing Manager",
    company: "First National Bank",
    industry: "Banking",
    about: "Run campaigns for retail banking products.",
  }),
  person("Tom Okafor", {
    title: "Founder",
    company: "Okafor Plumbing",
    industry: "Construction",
    about: "Family plumbing business, 20 years.",
  }),
  person("Lena Fischer", {
    title: "Chief Marketing Officer",
    company: "Northwind Software",
    industry: "Software",
    about: "Lead a marketing team of 40 at a 500-person SaaS company.",
  }),
  person("Sam Wu", {
    title: "Co-founder",
    company: "Tidepool Books",
    industry: "Publishing",
    about:
      "Co-founder of a community book club. Volunteer role, not a business.",
  }),
  person("Aisha Khan", {
    title: "Owner",
    company: "Khan Digital",
    industry: "Marketing and Advertising",
    about: "SEO and paid search for dentists and law firms. Team of four.",
  }),
  person("Ben Carter", {
    title: "Software Engineer",
    company: "Northwind Software",
    industry: "Software",
  }),
  person("Rosa Delgado", {
    about: "Dog lover. Coffee. Views are my own.",
  }),
  person("Chris Lee", {
    title: "Managing Partner",
    company: "Lee Wealth Advisors",
    industry: "Financial Services",
    about:
      "I founded Lee Wealth in 2009 and still own it. Fee-only advisory firm.",
  }),
  person("Nina Petrov", {
    title: "Freelance Brand Designer",
    industry: "Design",
    about: "Independent designer. I run my own one-person studio for startups.",
  }),
  person("Omar Haddad", {
    title: "Head of Growth",
    company: "Brightly",
    industry: "Marketing and Advertising",
    about: "Employee at a 30-person agency, reports to the founders.",
  }),
]

const SEARCHES: { query: string; expected: string[] }[] = [
  {
    query: "business owners in marketing",
    expected: ["Dana Ruiz", "Marcus Bell", "Aisha Khan"],
  },
  {
    query: "founders and owners of small companies",
    expected: ["Tom Okafor", "Chris Lee", "Dana Ruiz"],
  },
  {
    query: "marketing leaders at large software companies",
    expected: ["Lena Fischer"],
  },
]

async function main() {
  if (!llmConfigured()) {
    console.error("Set OPENROUTER_API_KEY in .env to run the evaluation.")
    process.exit(1)
  }
  console.log(`Model: ${llmModel()}\n`)

  const cards = POOL.map((p) => factsText(p.facts))
  let hits = 0
  let possible = 0

  for (const { query, expected } of SEARCHES) {
    const brief = await interpretQuery(query)
    const scores = await scoreCards({ query, brief, cards })
    const ranked = POOL.map((p, i) => ({ id: p.id, s: scores[i] }))
      .filter((r) => r.s)
      .sort((a, b) => b.s!.score - a.s!.score)

    const k = Math.min(3, expected.length)
    const top = ranked.slice(0, k).map((r) => r.id)
    const right = top.filter((id) => expected.includes(id)).length
    hits += right
    possible += k

    console.log(`"${query}"`)
    console.log(`  brief: ${brief.summary}`)
    for (const r of ranked.slice(0, 5))
      console.log(
        `  ${String(r.s!.score).padStart(3)} ${r.s!.confidence.padEnd(4)} ${r.id}: ${r.s!.reason}`
      )
    console.log(
      `  precision@${k}: ${right}/${k}${scores.some((s) => !s) ? " (some people were not scored)" : ""}\n`
    )
  }

  console.log(
    `Overall: ${hits}/${possible} (${Math.round((hits / possible) * 100)}%)`
  )
  process.exit(hits === possible ? 0 : 2)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
