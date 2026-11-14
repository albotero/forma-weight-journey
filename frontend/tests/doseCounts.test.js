import assert from "node:assert/strict"
import test from "node:test"

import { doseCountsByMedication } from "../src/lib/doseCounts.js"

const dose = (id, medicationId, amount, unit = "mg", administeredAt = `2026-01-0${id}T12:00:00Z`) => ({
  id,
  medication_id: medicationId,
  dose_amount: amount,
  dose_unit: unit,
  administered_at: administeredAt,
})

test("counts all administered doses and the consecutive doses at the latest amount", () => {
  const counts = doseCountsByMedication(
    [dose(3, 1, 5), dose(2, 1, 2.5), dose(1, 1, 2.5), dose(4, 2, 1, "tableta")],
    Date.parse("2026-01-10T00:00:00Z"),
  )

  assert.deepEqual(counts.get(1), {
    totalCount: 3,
    latestDose: dose(3, 1, 5),
    latestDoseCount: 1,
    hasDoseChanges: true,
  })
  assert.deepEqual(counts.get(2), {
    totalCount: 1,
    latestDose: dose(4, 2, 1, "tableta"),
    latestDoseCount: 1,
    hasDoseChanges: false,
  })
})

test("counts matching latest doses only since the most recent amount change", () => {
  const counts = doseCountsByMedication(
    [dose(1, 1, 2), dose(2, 1, 4), dose(3, 1, 2), dose(4, 1, 2)],
    Date.parse("2026-01-10T00:00:00Z"),
  )

  assert.equal(counts.get(1).totalCount, 4)
  assert.equal(counts.get(1).latestDoseCount, 2)
  assert.equal(counts.get(1).hasDoseChanges, true)
})

test("does not count doses dated in the future", () => {
  const counts = doseCountsByMedication(
    [dose(1, 1, 2, "mg", "2026-01-01T00:00:00Z"), dose(2, 1, 5, "mg", "2026-01-02T00:00:00Z")],
    Date.parse("2026-01-01T00:00:00Z"),
  )

  assert.equal(counts.get(1).totalCount, 1)
  assert.equal(counts.get(1).latestDose.dose_amount, 2)
})
