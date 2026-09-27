import assert from "node:assert/strict"
import test from "node:test"

import { dateTimeInputValue, localDateTimeToIso } from "../src/dateTime.js"

test("converts profile-local datetime-local values to UTC", () => {
  assert.equal(localDateTimeToIso("2026-09-27T18:20", "America/Bogota"), "2026-09-27T23:20:00.000Z")
})

test("accepts datetime-local values that include seconds or fractional seconds", () => {
  assert.equal(localDateTimeToIso("2026-09-27T18:20:30", "America/Bogota"), "2026-09-27T23:20:30.000Z")
  assert.equal(localDateTimeToIso("2026-09-27T18:20:30.125", "America/Bogota"), "2026-09-27T23:20:30.125Z")
})

test("round-trips a local time through an IANA timezone", () => {
  const iso = localDateTimeToIso("2026-03-08T03:30", "America/New_York")
  assert.equal(iso, "2026-03-08T07:30:00.000Z")
  assert.equal(dateTimeInputValue(iso, "America/New_York"), "2026-03-08T03:30")
})

test("rejects invalid dates, malformed inputs, and nonexistent daylight-saving times", () => {
  assert.throws(() => localDateTimeToIso("", "America/Bogota"), /fecha y hora válidas/)
  assert.throws(() => localDateTimeToIso("2026-02-30T10:00", "America/Bogota"), /hora local no existe/)
  assert.throws(() => localDateTimeToIso("2026-03-08T02:30", "America/New_York"), /hora local no existe/)
})
