import assert from "node:assert/strict"
import test from "node:test"
import { measurementPointsInPeriod, measurementStats } from "../src/lib/measurements.js"
import {
  catalogWithHistoricalItems, isBloodPressureResult, labRecordLabel, mergeScopedCatalogEntry, scopedCatalogResults,
} from "../src/lib/catalogRecords.js"

const point = (occurredAt, value) => ({ occurredAt, value, date: occurredAt.slice(0, 10) })
const now = "2026-10-14T15:00:00Z"

test("measurement cards show latest, previous change, average and count, not sums", () => {
  const points = measurementPointsInPeriod([
    point("2026-10-13T15:00:00Z", 80),
    point("2026-10-12T15:00:00Z", 82),
    point("2026-10-14T15:00:00Z", 79),
  ], "America/Bogota", 4, now)
  assert.deepEqual(measurementStats(points), { latest: 79, change: -1, average: 80.33, count: 3 })
})

test("periods use local calendar weeks and exclude invalid and future readings", () => {
  const points = [
    point("2026-09-21T05:00:00Z", 1),
    point("2026-09-21T04:59:00Z", 2),
    point("2026-10-12T05:00:00Z", 0),
    point("2026-10-15T05:00:00Z", 3),
    point("2026-10-13T15:00:00Z", NaN),
    point("2026-10-13T15:00:00Z", null),
  ]
  assert.equal(measurementPointsInPeriod(points, "America/Bogota", 4, now).length, 2)
  assert.equal(measurementPointsInPeriod(points, "America/Bogota", 1, now).length, 1)
  assert.equal(measurementPointsInPeriod(points, "America/Bogota", 12, now).length, 3)
  assert.equal(measurementPointsInPeriod(points, "America/Bogota", null, now).length, 3)
})

test("zero, negative changes, duplicate timestamps and empty measurements remain distinct", () => {
  const points = [point(now, 1), point(now, 0)]
  assert.deepEqual(measurementStats(points), { latest: 0, change: -1, average: 0.5, count: 2 })
  assert.deepEqual(measurementStats([]), { latest: null, change: null, average: null, count: 0 })
  assert.deepEqual(measurementStats([point(now, 0)]), { latest: 0, change: null, average: 0, count: 1 })
})

const lab = { catalog_item_id: 1, name: "Glucosa", value: 90, unit: "mg/dL", systolic: null, diastolic: null }
const bp = { catalog_item_id: 2, name: "Presión arterial", unit: "mmHg", value: null, systolic: 120, diastolic: 80, mean: 100 }
const mixed = { id: 9, module: "labs", title: "Resultados", occurred_at: now, notes: "Nota",
  data: { phase: "Basal", laboratory: "Centro", results: [lab, bp] } }
const payload = (results) => ({ module: "labs", title: "Editado", occurred_at: now, notes: "Nota", data: { results } })

test("lab and blood pressure histories partition mixed legacy records without losing either side", () => {
  assert.deepEqual(scopedCatalogResults(mixed, true), [bp])
  assert.deepEqual(scopedCatalogResults(mixed, false), [lab])
  assert.equal(isBloodPressureResult(lab), false)
  assert.equal(isBloodPressureResult(bp), true)
  assert.equal(isBloodPressureResult({ catalog_item_id: 2 }, [{ id: 2, is_blood_pressure: true }]), true)
  assert.deepEqual(scopedCatalogResults({ data: {} }, true), [])
})

test("home activity and history labels distinguish labs, pressure and mixed records", () => {
  assert.equal(labRecordLabel(mixed), "Laboratorios y presión arterial")
  assert.equal(labRecordLabel({ data: { results: [bp] } }), "Presión arterial")
  assert.equal(labRecordLabel({ data: { results: [lab] } }), "Laboratorios")
})

test("editing blood pressure preserves all lab results and metadata", () => {
  const updated = { ...bp, systolic: 125 }
  const merged = mergeScopedCatalogEntry(mixed, payload([updated]), true)
  assert.deepEqual(merged.data.results, [lab, updated])
  assert.equal(merged.data.phase, "Basal")
  assert.equal(merged.data.laboratory, "Centro")
  assert.equal(merged.title, mixed.title)
  assert.deepEqual(mixed.data.results, [lab, bp])
})

test("measurement chronology uses actual timestamps and ID tie breaks", () => {
  const points = measurementPointsInPeriod([
    { ...point("2026-10-13T15:00:00Z", 10), id: 2 },
    { ...point("2026-10-13T15:00:00Z", 12), id: 1 },
    point("2026-10-13T09:00:00-05:00", 14),
  ], "America/Bogota", 4, now)
  assert.deepEqual(points.map(({ value }) => value), [14, 12, 10])
  assert.equal(measurementStats(points).latest, 10)
})

test("clearing lab-only metadata does not restore old values through the mixed-record merge", () => {
  const update = payload([lab])
  update.data.phase = null
  update.data.laboratory = null
  const merged = mergeScopedCatalogEntry(mixed, update, false)
  assert.equal(merged.data.phase, null)
  assert.equal(merged.data.laboratory, null)
  assert.deepEqual(merged.data.results, [bp, lab])
})

test("editing labs preserves blood pressure and allows removal of a scoped result", () => {
  const updated = { ...lab, value: 95 }
  const merged = mergeScopedCatalogEntry(mixed, payload([updated]), false)
  assert.deepEqual(merged.data.results, [bp, updated])
  assert.deepEqual(mergeScopedCatalogEntry(mixed, payload([]), false).data.results, [bp])
  assert.deepEqual(mergeScopedCatalogEntry(mixed, payload([]), true).data.results, [lab])
})

test("new independent entries remain independent", () => {
  const bpPayload = payload([bp])
  assert.equal(mergeScopedCatalogEntry(null, bpPayload, true), bpPayload)
  assert.deepEqual(scopedCatalogResults({ data: { results: [lab] } }, true), [])
  assert.deepEqual(scopedCatalogResults({ data: { results: [bp] } }, false), [])
})

test("deleted catalog items still appear in charts and editors with historical names and units", () => {
  const catalog = [{ id: 1, category: "lab", name: "Glucosa actual", normal_min: 70, normal_max: 100 }]
  const historical = catalogWithHistoricalItems(catalog, [mixed], "lab")
  assert.equal(historical.length, 2)
  assert.equal(historical[0], catalog[0])
  assert.equal(historical[1].name, bp.name)
  assert.equal(historical[1].unit, "mmHg")
  assert.equal(historical[1].is_blood_pressure, true)
  assert.equal(historical[1].normal_min, null)
})
