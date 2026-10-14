import assert from "node:assert/strict"
import test from "node:test"
import { activityEntryDate, activityWeekStart, summarizeActivity } from "../src/lib/activity.js"

const now = "2026-10-14T15:00:00Z"
const timezone = "America/Bogota"
const entry = (id, data, occurred_at = "2026-10-13T15:00:00Z", module = "activity") => ({
  id, module, occurred_at, data,
})
const summary = (entries, weeks = 4) => summarizeActivity(entries, timezone, weeks, now)

test("adds individual activities and overlapping weekly summaries per metric", () => {
  const result = summary([
    entry(1, { entry_type: "single", steps: 3000, calories_kcal: 150, distance_km: 2.25, duration_min: 30 }),
    entry(2, { entry_type: "single", steps: 1000, calories_kcal: 50, distance_km: 1.1, duration_min: 10 }),
    entry(3, { entry_type: "weekly", week_end: "2026-10-13", weekly_steps: 20000,
      weekly_calories_kcal: 1000, weekly_distance_km: 15.5, duration_min: 999 }),
  ])
  assert.deepEqual(result.totals.steps, { single: 4000, weekly: 20000, total: 24000 })
  assert.deepEqual(result.totals.calories_kcal, { single: 200, weekly: 1000, total: 1200 })
  assert.deepEqual(result.totals.distance_km, { single: 3.35, weekly: 15.5, total: 18.85 })
  assert.deepEqual(result.totals.duration_min, { single: 40, weekly: null, total: 40 })
  assert.equal(result.singleCount, 2)
  assert.equal(result.weeklyCount, 1)
  assert.equal(result.weeks.length, 1)
  assert.equal(result.weeks[0].start, "2026-10-12")
  assert.deepEqual(result.weeks[0].metrics, result.totals)
})

test("supports individual-only, weekly-only and legacy individual records", () => {
  assert.equal(summary([entry(1, { steps: 500, distance_km: 1 })]).totals.steps.total, 500)
  assert.equal(summary([entry(1, { entry_type: "weekly", week_end: "2026-10-13",
    weekly_steps: 500 })]).totals.steps.total, 500)
})

test("distinguishes explicit zero from missing metrics and does not estimate", () => {
  const result = summary([
    entry(1, { entry_type: "single", steps: 0, duration_min: 30, calories_kcal: null }),
    entry(2, { entry_type: "weekly", week_end: "2026-10-13", weekly_steps: 0 }),
  ])
  assert.deepEqual(result.totals.steps, { single: 0, weekly: 0, total: 0 })
  assert.deepEqual(result.totals.calories_kcal, { single: null, weekly: null, total: null })
  assert.equal(result.totals.distance_km.total, null)
})

test("reports invalid legacy measurements rather than coercing them to zero", () => {
  const result = summary([entry(1, { steps: false, distance_km: "", calories_kcal: Infinity }),
    entry(2, { steps: -1, calories_kcal: "bad", distance_km: NaN })])
  assert.ok(Object.values(result.totals).every(({ total }) => total === null))
  assert.equal(result.invalidMeasurementCount, 6)
})

test("combines multiple weekly summaries and same-timestamp activities without losing records", () => {
  const result = summary([
    entry(1, { entry_type: "weekly", week_end: "2026-10-13", weekly_calories_kcal: 10 }),
    entry(2, { entry_type: "weekly", week_end: "2026-10-13", weekly_calories_kcal: 20 }),
    entry(3, { calories_kcal: 5 }),
  ])
  assert.equal(result.weeks[0].metrics.calories_kcal.total, 35)
  assert.deepEqual(result.entries.map(({ id }) => id), [3, 2, 1])
})

test("filters calendar weeks inclusively in the user's timezone and excludes future days", () => {
  const entries = [
    entry(1, { steps: 1 }, "2026-09-21T05:00:00Z"),
    entry(2, { steps: 2 }, "2026-09-21T04:59:00Z"),
    entry(3, { steps: 4 }, "2026-10-15T04:59:00Z"),
    entry(4, { steps: 8 }, "2026-10-15T05:00:00Z"),
    entry(5, { steps: 16 }, "2026-10-13T15:00:00Z", "goals"),
  ]
  assert.equal(summary(entries).start, "2026-09-21")
  assert.equal(summary(entries).totals.steps.total, 5)
  assert.equal(summary(entries, 1).totals.steps.total, 4)
  assert.equal(summary(entries, 12).totals.steps.total, 7)
  assert.equal(summary(entries, null).totals.steps.total, 7)
})

test("uses explicit weekly end dates and preserves legacy weekly end semantics", () => {
  assert.equal(activityEntryDate(entry(1, { entry_type: "weekly", week_end: "2026-10-11" }), timezone, now),
    "2026-10-11")
  assert.equal(activityEntryDate(entry(2, { entry_type: "weekly" }, "2026-10-05T15:00:00Z"), timezone, now),
    "2026-10-11")
  assert.equal(activityEntryDate(entry(3, { entry_type: "weekly" }), timezone, now), "2026-10-14")
  const result = summary([entry(1, { entry_type: "weekly", week_end: "2026-10-11",
    weekly_steps: 500 })], 1)
  assert.equal(result.entries.length, 0)
})

test("keeps missing weeks absent and rounds decimal sums", () => {
  const result = summary([
    entry(1, { distance_km: 0.1 }),
    entry(2, { distance_km: 0.2 }),
    entry(3, { steps: 1 }, "2026-09-21T05:00:00Z"),
  ])
  assert.equal(result.totals.distance_km.total, 0.3)
  assert.deepEqual(result.weeks.map(({ start }) => start), ["2026-09-21", "2026-10-12"])
  assert.equal(result.weeks[0].metrics.distance_km.total, null)
})

test("calendar week boundaries remain stable across DST and year changes", () => {
  assert.equal(activityWeekStart("2026-01-01"), "2025-12-29")
  assert.equal(activityWeekStart("2026-11-01"), "2026-10-26")
  const result = summarizeActivity([
    entry(1, { steps: 100 }, "2026-11-02T04:30:00Z"),
    entry(2, { steps: 200 }, "2026-11-02T05:30:00Z"),
  ], "America/New_York", 1, "2026-11-02T17:00:00Z")
  assert.equal(result.totals.steps.total, 200)
})

test("empty periods keep all metrics missing", () => {
  const result = summary([])
  assert.equal(result.entries.length, 0)
  assert.equal(result.weeks.length, 0)
  assert.ok(Object.values(result.totals).every(({ total }) => total === null))
})
