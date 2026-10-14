import assert from "node:assert/strict"
import test from "node:test"
import { chartPeriodStart, shiftCalendarDate } from "../src/lib/chartPeriod.js"

test("daily windows include exactly 30 or 90 calendar dates", () => {
  assert.equal(chartPeriodStart("2026-10-14", "30d"), "2026-09-15")
  assert.equal(chartPeriodStart("2026-10-14", "90d"), "2026-07-17")
  assert.equal(chartPeriodStart("2026-10-14", null), null)
})

test("six-month and yearly windows clamp month-end and leap-day boundaries", () => {
  assert.equal(chartPeriodStart("2026-08-31", "6m"), "2026-02-28")
  assert.equal(chartPeriodStart("2024-08-31", "6m"), "2024-02-29")
  assert.equal(chartPeriodStart("2024-02-29", "1y"), "2023-02-28")
  assert.equal(chartPeriodStart("2026-01-31", "6m"), "2025-07-31")
  assert.equal(chartPeriodStart("2026-10-14", "1y"), "2025-10-14")
  assert.equal(shiftCalendarDate("2026-01-01", -6), "2025-12-26")
})
