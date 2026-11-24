import assert from "node:assert/strict"
import { test } from "node:test"
import { factsBrief, factsText, hasFacts, type ProspectFacts } from "./brief"
import { writeBrief } from "./llm"

const none: ProspectFacts = {
  name: "Avery Kim",
  title: null,
  company: null,
  industry: null,
  location: null,
  headline: null,
  about: null,
  experience: [],
  skills: [],
}

const full: ProspectFacts = {
  name: "Taylor Reed",
  title: "Owner",
  company: "Reed Plumbing",
  industry: "Construction",
  location: "Austin, Texas",
  headline: "Owner at Reed Plumbing",
  about: "Third-generation plumber. Grew the business from 3 trucks to 12.",
  experience: [
    { title: "Owner", company: "Reed Plumbing", period: "2014 - Present" },
    { title: "Service Manager", company: "Reed Plumbing", period: null },
  ],
  skills: ["Hiring", "Local marketing"],
}

test("a name alone is not enough to write about", () => {
  assert.equal(hasFacts(none), false)
  assert.match(factsBrief(none), /only know Avery Kim/)
})

test("the facts brief names the role, place and background", () => {
  const brief = factsBrief(full)
  assert.match(
    brief,
    /Taylor Reed is Owner at Reed Plumbing in Construction, based in Austin/
  )
  assert.match(brief, /Third-generation plumber/)
  // The current job is not repeated as "before that".
  assert.match(brief, /Before that: Service Manager at Reed Plumbing/)
  assert.doesNotMatch(brief, /Before that: Owner at Reed Plumbing/)
  assert.match(brief, /Known for Hiring, Local marketing/)
})

test("facts text labels every fact and skips empty ones", () => {
  const text = factsText(full)
  assert.match(text, /^Name: Taylor Reed$/m)
  assert.match(
    text,
    /Experience: Owner at Reed Plumbing \(2014 - Present\); Service Manager at Reed Plumbing/
  )
  assert.equal(factsText(none), "Name: Avery Kim")
})

test("writeBrief reads the brief from JSON, or accepts plain text", async () => {
  assert.equal(
    await writeBrief("facts", async () => '{"brief":" A short profile. "}'),
    "A short profile."
  )
  assert.equal(
    await writeBrief("facts", async () => "Just text."),
    "Just text."
  )
  await assert.rejects(writeBrief("facts", async () => '{"brief":""}'))
})
