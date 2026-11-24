import assert from "node:assert/strict"
import { test } from "node:test"
import {
  COUNTRIES,
  countryAllowed,
  countryName,
  isCountryCode,
} from "./countries"

const none = { blocked: [], allowed: [] }

test("country names come from the codes", () => {
  assert.equal(countryName("IN"), "India")
  assert.equal(countryName("PK"), "Pakistan")
  assert.ok(isCountryCode("US"))
  assert.ok(!isCountryCode("XX"))
  assert.ok(COUNTRIES.length > 240)
})

test("with no lists everyone stays, whatever we know", () => {
  assert.ok(countryAllowed("IN", none))
  assert.ok(countryAllowed(null, none))
})

test("a block list removes those countries and keeps unknowns", () => {
  const s = { blocked: ["IN", "PK"], allowed: [] }
  assert.ok(!countryAllowed("IN", s))
  assert.ok(!countryAllowed("PK", s))
  assert.ok(countryAllowed("US", s))
  assert.ok(countryAllowed(null, s))
})

test("an allow list keeps only those countries, and drops unknowns", () => {
  const s = { blocked: [], allowed: ["US", "CA"] }
  assert.ok(countryAllowed("US", s))
  assert.ok(!countryAllowed("IN", s))
  assert.ok(!countryAllowed(null, s))
})

test("a block wins over an allow", () => {
  const s = { blocked: ["US"], allowed: ["US", "CA"] }
  assert.ok(!countryAllowed("US", s))
  assert.ok(countryAllowed("CA", s))
})
