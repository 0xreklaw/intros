import assert from "node:assert/strict"
import { test } from "node:test"
import { profileSummary, readInstagramProfile } from "./instagram-profile"

const body = {
  output: {
    username: "Eddie",
    full_name: "Eddie (Adib) Maalouf",
    followers: 125053,
    is_verified: true,
    biography: "CEO @badmarketing\nBuilding @scovillehotchicken",
  },
  raw: {
    data: { data: { user: { external_url: "http://badmarketing.com" } } },
  },
}

test("an Instagram profile is read from treg's output and the provider's own answer", () => {
  const p = readInstagramProfile(body)!
  assert.equal(p.handle, "eddie")
  assert.equal(p.website, "http://badmarketing.com")
  assert.equal(p.followers, 125053)
  assert.ok(p.verified)
  assert.equal(
    profileSummary(p),
    "CEO @badmarketing | Building @scovillehotchicken · http://badmarketing.com · 125,053 followers, verified"
  )
})

test("an answer with no username is not a profile", () => {
  assert.equal(readInstagramProfile({ output: {} }), null)
  assert.equal(readInstagramProfile(null), null)
})
