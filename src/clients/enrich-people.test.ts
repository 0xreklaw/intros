import assert from "node:assert/strict"
import { test } from "node:test"
import { parseLinkedinProfile, profileDigest } from "./enrich-people"

const body = {
  output: {
    headline: "Founder at BAD Marketing",
    about: "I run a growth agency for DTC brands.",
    location: "Austin, Texas",
  },
  raw: {
    jobTitle: "Founder & CEO",
    companyName: "BAD Marketing",
    industry: "Marketing Services",
    experiences: [
      { name: "BAD Marketing", jobTitle: "Founder & CEO" },
      { name: "Acme", jobTitle: "Head of Growth" },
    ],
    skills: [{ name: "SEO" }, { name: "Paid social" }],
  },
}

test("reads title, company, industry and context from a treg profile", () => {
  const p = parseLinkedinProfile(body)!
  assert.equal(p.title, "Founder & CEO")
  assert.equal(p.company, "BAD Marketing")
  assert.equal(p.industry, "Marketing Services")
  assert.equal(p.experience.length, 2)
  assert.deepEqual(p.skills, ["SEO", "Paid social"])
})

test("the digest leads with the headline and stays short", () => {
  const digest = profileDigest(parseLinkedinProfile(body)!)
  assert.match(digest, /^Founder at BAD Marketing\nAbout:/)
  assert.match(
    digest,
    /Experience: Founder & CEO at BAD Marketing; Head of Growth at Acme/
  )
  assert.ok(digest.length <= 1200)
})

test("an empty response is not a profile", () => {
  assert.equal(parseLinkedinProfile({}), null)
  assert.equal(parseLinkedinProfile(null), null)
})
