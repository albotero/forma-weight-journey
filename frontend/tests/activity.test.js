import assert from "node:assert/strict"
import test from "node:test"
import { activityCalculations, activityEntryDate, summarizeActivity, weeklyActivityTotals } from "../src/lib/activity.js"

const now = "2026-10-14T15:00:00Z"
const timezone = "America/Bogota"
const entry = (id, data, occurred_at = "2026-10-13T15:00:00Z", module = "activity") => ({
  id, module, occurred_at, data,
})
const summary = (entries, period = "90d") => summarizeActivity(entries, timezone, period, now)

const walking = entry(10, { activity_type: "Caminata", intensity: "Moderada", duration_min: 30, distance_km: 2 })
const weights = [
  { id: 1, measured_at: "2026-10-01T15:00:00Z", weight_kg: 85 },
  { id: 2, measured_at: "2026-10-12T15:00:00Z", weight_kg: 80 },
  { id: 3, measured_at: "2026-10-14T15:00:00Z", weight_kg: 70 },
]

test("derives gross kcal and speed/pace from historical activity without modifying it", () => {
  const original = { ...walking, data: { ...walking.data } }
  assert.deepEqual(activityCalculations(walking, weights), {
    estimatedCalories: 159.6, speedKmh: 4, paceMinKm: 15, weightKg: 80, met: 3.8,
  })
  assert.deepEqual(walking, original)
  assert.equal(activityCalculations(walking, [...weights, {
    id: 4, measured_at: "2026-10-12T15:00:00Z", weight_kg: 100,
  }]).estimatedCalories, 199.5)
})

test("never replaces entered calories, including zero and invalid values", () => {
  for (const calories_kcal of [0, 100, -1, "bad", Infinity]) {
    assert.equal(activityCalculations({ ...walking, data: { ...walking.data, calories_kcal } }, weights).estimatedCalories, null)
  }
  assert.equal(activityCalculations({ ...walking, data: { ...walking.data, calories_kcal: null } }, weights).estimatedCalories, 159.6)
})

test("requires a prior valid weight, duration and supported type/intensity for kcal", () => {
  assert.equal(activityCalculations(walking).estimatedCalories, null)
  assert.equal(activityCalculations(walking, weights.slice(2)).estimatedCalories, null)
  for (const patch of [
    { duration_min: 0 }, { duration_min: -1 }, { duration_min: NaN }, { duration_min: "30" },
    { activity_type: "Otro" }, { activity_type: "Yoga/Pilates" }, { activity_type: "__proto__" },
    { intensity: "" }, { intensity: "constructor" }, { entry_type: "weekly" },
  ]) {
    assert.equal(activityCalculations({ ...walking, data: { ...walking.data, ...patch } }, weights).estimatedCalories, null)
  }
  assert.equal(activityCalculations({ ...walking, occurred_at: "invalid" }, weights).estimatedCalories, null)
})

test("calculates speed without weight and pace only for walking/running, without estimating steps/distance", () => {
  assert.equal(activityCalculations(walking).speedKmh, 4)
  assert.equal(activityCalculations({ ...walking, data: { ...walking.data, activity_type: "Bicicleta" } }).paceMinKm, null)
  for (const distance_km of [null, 0, -1, Infinity, "2"]) {
    assert.equal(activityCalculations({ ...walking, data: { ...walking.data, distance_km } }).speedKmh, null)
  }
})

test("adds existing estimated kcal once to totals and weeks and separates sources, preserving weekly addition", () => {
  const result = summarizeActivity([
    walking,
    entry(11, { ...walking.data, calories_kcal: 0 }),
    entry(12, { entry_type: "weekly", week_end: "2026-10-13", weekly_calories_kcal: 200 }),
  ], timezone, "90d", now, weights)
  assert.deepEqual(result.totals.calories_kcal, { single: 159.6, weekly: 200, total: 359.6 })
  assert.deepEqual(result.calories, { recorded: 200, estimated: 159.6, estimatedCount: 1 })
  assert.equal(result.weeks[0].estimatedCalories, 159.6)
  assert.equal(result.weeks[0].metrics.calories_kcal.total, 359.6)
  assert.equal(result.totals.steps.total, null)
  assert.equal(result.totals.distance_km.total, 4)
  const invalid = summarizeActivity([entry(13, { ...walking.data, calories_kcal: -1 })], timezone, "90d", now, weights)
  assert.equal(invalid.invalidMeasurementCount, 1)
  assert.equal(invalid.totals.calories_kcal.total, null)
  assert.equal(summarizeActivity([walking], timezone, "30d", "2026-12-01T15:00:00Z", weights).calories.estimatedCount, 0)
})

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
  assert.equal(result.weeks[0].start, "2026-10-07")
  assert.equal(result.weeks[0].end, "2026-10-13")
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

test("filters rolling periods inclusively in the user's timezone and excludes future days", () => {
  const entries = [
    entry(1, { steps: 1 }, "2026-07-17T05:00:00Z"),
    entry(2, { steps: 2 }, "2026-07-17T04:59:00Z"),
    entry(3, { steps: 4 }, "2026-10-15T04:59:00Z"),
    entry(4, { steps: 8 }, "2026-10-15T05:00:00Z"),
    entry(5, { steps: 16 }, "2026-10-13T15:00:00Z", "goals"),
  ]
  assert.equal(summary(entries).start, "2026-07-17")
  assert.equal(summary(entries).totals.steps.total, 5)
  assert.equal(summary(entries, "30d").totals.steps.total, 4)
  assert.equal(summary(entries, "6m").totals.steps.total, 7)
  assert.equal(summary(entries, null).totals.steps.total, 7)
})

test("uses explicit weekly end dates and preserves legacy weekly end semantics", () => {
  assert.equal(activityEntryDate(entry(1, { entry_type: "weekly", week_end: "2026-10-11" }), timezone, now),
    "2026-10-11")
  assert.equal(activityEntryDate(entry(2, { entry_type: "weekly" }, "2026-10-05T15:00:00Z"), timezone, now),
    "2026-10-11")
  assert.equal(activityEntryDate(entry(3, { entry_type: "weekly" }), timezone, now), "2026-10-14")
  const result = summary([entry(1, { entry_type: "weekly", week_end: "2026-10-11",
    weekly_steps: 500 })], "30d")
  assert.equal(result.entries.length, 1)
})

test("keeps missing weeks absent and rounds decimal sums", () => {
  const result = summary([
    entry(1, { distance_km: 0.1 }),
    entry(2, { distance_km: 0.2 }),
    entry(3, { steps: 1 }, "2026-09-21T05:00:00Z"),
  ])
  assert.equal(result.totals.distance_km.total, 0.3)
  assert.deepEqual(result.weeks.map(({ start }) => start), ["2026-09-17", "2026-10-08"])
  assert.equal(result.weeks[0].metrics.distance_km.total, null)
})

test("summary dates remain stable across DST and year changes without Monday assumptions", () => {
  const year = summarizeActivity([entry(1, { entry_type: "weekly", week_end: "2026-01-01", weekly_steps: 7 })],
    timezone, "90d", "2026-01-02T15:00:00Z")
  assert.equal(year.weeks[0].start, "2025-12-26")
  assert.equal(year.weeks[0].end, "2026-01-01")
  const result = summarizeActivity([
    entry(1, { steps: 100 }, "2026-11-02T04:30:00Z"),
    entry(2, { steps: 200 }, "2026-11-02T05:30:00Z"),
  ], "America/New_York", "30d", "2026-11-02T17:00:00Z")
  assert.equal(result.totals.steps.total, 300)
  assert.equal(result.weeks[0].start, "2026-10-27")
  assert.equal(result.weeks[0].end, "2026-11-02")
})

test("overlapping summaries retain their dates and each individual contributes only once", () => {
  const result = summary([
    entry(1, { entry_type: "weekly", week_end: "2026-10-13", weekly_steps: 700 }),
    entry(2, { entry_type: "weekly", week_end: "2026-10-14", weekly_steps: 1400 }),
    entry(3, { steps: 100 }),
    entry(4, { steps: 200 }, "2026-10-14T15:00:00Z"),
  ])
  assert.deepEqual(result.weeks.map(({ end, metrics }) => [end, metrics.steps.total]),
    [["2026-10-13", 800], ["2026-10-14", 1600]])
  assert.equal(result.totals.steps.total, 2400)
})

test("individuals outside summary intervals use the latest summary's weekday as anchor", () => {
  const result = summary([
    entry(1, { entry_type: "weekly", week_end: "2026-10-06", weekly_steps: 700 }),
    entry(2, { steps: 100 }, "2026-09-29T15:00:00Z"),
    entry(3, { steps: 200 }, "2026-10-14T15:00:00Z"),
  ])
  assert.deepEqual(result.weeks.map(({ start, end }) => [start, end]),
    [["2026-09-23", "2026-09-29"], ["2026-09-30", "2026-10-06"], ["2026-10-14", "2026-10-20"]])
  assert.equal(result.totals.steps.total, 1000)
})

test("daily averages multiply all three measurements by seven, rounding only final totals", () => {
  assert.deepEqual(weeklyActivityTotals({
    weekly_steps: "1000.5", weekly_calories_kcal: "200.25", weekly_distance_km: "1.234",
  }, "daily_average"), { weekly_steps: 7004, weekly_calories_kcal: 1401.75, weekly_distance_km: 8.64 })
  assert.deepEqual(weeklyActivityTotals({
    weekly_steps: "7000", weekly_calories_kcal: "1400.25", weekly_distance_km: "8.64",
  }, "weekly_total"), { weekly_steps: 7000, weekly_calories_kcal: 1400.25, weekly_distance_km: 8.64 })
})

test("conversion preserves blank and zero values and total-average-total round trips", () => {
  assert.deepEqual(weeklyActivityTotals({ weekly_steps: "", weekly_distance_km: 0 }, "daily_average"),
    { weekly_steps: null, weekly_calories_kcal: null, weekly_distance_km: 0 })
  for (const steps of [1, 500, 1999999, 2000000]) {
    assert.equal(weeklyActivityTotals({ weekly_steps: String(steps / 7) }, "daily_average").weekly_steps, steps)
  }
  assert.equal(weeklyActivityTotals({ weekly_distance_km: String(8.64 / 7) }, "daily_average").weekly_distance_km, 8.64)
})

test("weekly conversions reject invalid inputs, fractional weekly steps and excessive totals", () => {
  for (const value of [-1, "bad", Infinity]) {
    assert.throws(() => weeklyActivityTotals({ weekly_steps: value }, "daily_average"), /numéricas/)
  }
  assert.throws(() => weeklyActivityTotals({ weekly_steps: 1.001 }, "weekly_total"), /entero/)
  for (const [key, value] of [["weekly_steps", 2000001], ["weekly_calories_kcal", 200001], ["weekly_distance_km", 10001]]) {
    assert.throws(() => weeklyActivityTotals({ [key]: value }, "weekly_total"), /máximo/)
    assert.throws(() => weeklyActivityTotals({ [key]: value }, "daily_average"), /máximo/)
  }
  assert.throws(() => weeklyActivityTotals({}, "invalid"), /Selecciona/)
})

test("empty periods keep all metrics missing", () => {
  const result = summary([])
  assert.equal(result.entries.length, 0)
  assert.equal(result.weeks.length, 0)
  assert.ok(Object.values(result.totals).every(({ total }) => total === null))
})
