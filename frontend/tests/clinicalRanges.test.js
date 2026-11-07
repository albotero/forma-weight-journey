import assert from "node:assert/strict"
import test from "node:test"
import { ageOnDate, bodyFatClinicalBands, waistHeightClinicalBands } from "../src/lib/clinicalRanges.js"

test("age uses completed years and handles future and missing birth dates", () => {
  assert.equal(ageOnDate("1986-11-08", "2026-11-07"), 39)
  assert.equal(ageOnDate("1986-11-07", "2026-11-07"), 40)
  assert.equal(ageOnDate("2027-01-01", "2026-11-07"), null)
  assert.equal(ageOnDate(null, "2026-11-07"), null)
})

test("body-fat bands require a selected reference and supported age", () => {
  assert.deepEqual(bodyFatClinicalBands(null, "1986-01-01", "2026-11-07"), [])
  assert.deepEqual(bodyFatClinicalBands("female", "2007-01-01", "2026-11-07"), [])
  assert.deepEqual(bodyFatClinicalBands("male", "1946-01-01", "2026-11-07"), [])
  assert.deepEqual(
    bodyFatClinicalBands("female", "1986-01-01", "2026-11-07").map(({ from, to }) => [from, to]),
    [[0, 23], [23, 34], [34, 100]],
  )
  assert.deepEqual(
    bodyFatClinicalBands("male", "1986-01-01", "2026-11-07").map(({ from, to }) => [from, to]),
    [[0, 11], [11, 22], [22, 100]],
  )
})

test("waist-to-height bands require an adult with BMI below 35", () => {
  assert.deepEqual(waistHeightClinicalBands(170, 17, 24), [])
  assert.deepEqual(waistHeightClinicalBands(170, 30, 35), [])
  assert.deepEqual(
    waistHeightClinicalBands(170, 30, 28).map(({ from, to }) => [from, to]),
    [[68, 85], [85, 102], [102, Infinity]],
  )
})