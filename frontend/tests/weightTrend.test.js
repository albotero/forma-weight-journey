import assert from "node:assert/strict"
import test from "node:test"

import { weightMovingAverageSeries } from "../src/lib/weightTrend.js"

test("excludes the seven-day-old boundary, handles gaps and duplicate timestamps", () => {
  const weights = [
    { measured_at: "2026-09-09T00:00:00Z", weight_kg: 76 },
    { measured_at: "2026-09-01T00:00:00Z", weight_kg: 100 },
    { measured_at: "2026-09-08T00:00:00Z", weight_kg: 80 },
    { measured_at: "2026-09-08T00:00:00Z", weight_kg: 84 },
    { measured_at: "2026-09-21T00:00:00Z", weight_kg: 70 },
  ]
  const original = weights.map((item) => ({ ...item }))
  assert.deepEqual(
    weightMovingAverageSeries(weights).map((point) => point.moving_average_7d_kg),
    [100, 82, 82, 80, 70],
  )
  assert.deepEqual(weights, original)
  assert.deepEqual(weightMovingAverageSeries([]), [])
  assert.equal(
    weightMovingAverageSeries([
      { measured_at: "2026-09-01T00:00:00Z", weight_kg: 80.12 },
      { measured_at: "2026-09-01T00:00:00Z", weight_kg: 80.13 },
    ])[0].moving_average_7d_kg,
    80.13,
  )
})

test("uses history before the visible range and normalizes timezone offsets", () => {
  const weights = [
    { measured_at: "2026-09-01T19:00:00-05:00", weight_kg: 82.5 },
    { measured_at: "2026-09-03T00:00:00Z", weight_kg: 81 },
    { measured_at: "2026-09-04T00:00:00Z", weight_kg: 80 },
  ]
  const visible = weightMovingAverageSeries(weights).filter((point) => point.measured_at >= "2026-09-04")
  assert.equal(visible[0].moving_average_7d_kg, 81.17)
})
