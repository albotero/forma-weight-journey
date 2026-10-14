import { dateTimeInputValue } from "../dateTime.js"
import { chartPeriodStart, shiftCalendarDate as shiftActivityDate } from "./chartPeriod.js"
export { shiftCalendarDate as shiftActivityDate } from "./chartPeriod.js"

export const activityMetrics = [
  { key: "steps", weeklyKey: "weekly_steps", label: "Pasos", unit: "pasos" },
  { key: "calories_kcal", weeklyKey: "weekly_calories_kcal", label: "Calorías", unit: "kcal" },
  { key: "distance_km", weeklyKey: "weekly_distance_km", label: "Distancia", unit: "km" },
  { key: "duration_min", weeklyKey: null, label: "Duración", unit: "min" },
]

export function isValidActivityMeasurement(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

export function activityEntryDate(entry, timezone, now = new Date().toISOString()) {
  const recordedDay = dateTimeInputValue(entry.occurred_at, timezone).slice(0, 10)
  if (entry.data.entry_type !== "weekly") return recordedDay
  if (typeof entry.data.week_end === "string") return entry.data.week_end
  // Older weekly records stored the start, rather than the end, of the period.
  const end = shiftActivityDate(recordedDay, 6)
  const today = dateTimeInputValue(now, timezone).slice(0, 10)
  return end > today ? today : end
}

function emptyMetrics() {
  return Object.fromEntries(activityMetrics.map(({ key }) => [key, { single: null, weekly: null, total: null }]))
}

function addMeasurement(metric, source, value) {
  metric[source] = Number(((metric[source] ?? 0) + value).toFixed(2))
  metric.total = Number(((metric.single ?? 0) + (metric.weekly ?? 0)).toFixed(2))
}

export function weeklyActivityTotals(values, inputMode) {
  if (inputMode !== "daily_average" && inputMode !== "weekly_total") {
    throw new Error("Selecciona promedio diario o total semanal.")
  }
  return Object.fromEntries(activityMetrics.filter(({ weeklyKey }) => weeklyKey !== null).map(({ key, weeklyKey }) => {
    const raw = values[weeklyKey]
    const value = raw == null || String(raw).trim() === "" ? null : Number(raw)
    if (value === null) return [weeklyKey, null]
    if (!isValidActivityMeasurement(value)) throw new Error("Ingresa medidas numéricas no negativas.")
    const multiplied = value * (inputMode === "daily_average" ? 7 : 1)
    const total = key === "steps" && inputMode === "daily_average"
      ? Math.round(multiplied) : key === "steps" ? multiplied : Number(multiplied.toFixed(2))
    if (key === "steps" && !Number.isInteger(total)) {
      throw new Error("Los pasos deben resultar en un total semanal entero.")
    }
    const maximum = key === "steps" ? 2000000 : key === "calories_kcal" ? 200000 : 10000
    if (total > maximum) throw new Error(`El total semanal de ${key === "steps" ? "pasos" : key === "calories_kcal" ? "calorías" : "distancia"} supera el máximo permitido.`)
    return [weeklyKey, total]
  }))
}

export function summarizeActivity(entries, timezone, period = "90d", now = new Date().toISOString()) {
  const today = dateTimeInputValue(now, timezone).slice(0, 10)
  const start = chartPeriodStart(today, period)
  const summaryEnds = [...new Set(entries.filter((entry) =>
    entry.module === "activity" && entry.data.entry_type === "weekly",
  ).map((entry) => activityEntryDate(entry, timezone, now)).filter((day) => day <= today))].sort()
  const anchorEnd = summaryEnds.at(-1) ?? today
  const visibleEntries = entries
    .filter((entry) => {
      if (entry.module !== "activity") return false
      const day = activityEntryDate(entry, timezone, now)
      return day <= today && (start === null || day >= start)
    })
    .sort((a, b) =>
      activityEntryDate(b, timezone, now).localeCompare(activityEntryDate(a, timezone, now)) ||
      b.occurred_at.localeCompare(a.occurred_at) || b.id - a.id,
    )
  const totals = emptyMetrics()
  const weeks = new Map()
  let invalidMeasurementCount = 0
  for (const entry of visibleEntries) {
    const day = activityEntryDate(entry, timezone, now)
    // Assign individuals to one containing summary only; overlapping summaries remain additive.
    const containingEnd = summaryEnds.find((end) => day <= end && day >= shiftActivityDate(end, -6))
    const deltaDays = (Date.parse(`${day}T12:00:00Z`) - Date.parse(`${anchorEnd}T12:00:00Z`)) / 86400000
    const weekEnd = entry.data.entry_type === "weekly" ? day :
      containingEnd ?? shiftActivityDate(anchorEnd, Math.ceil(deltaDays / 7) * 7)
    if (!weeks.has(weekEnd)) weeks.set(weekEnd, {
      start: shiftActivityDate(weekEnd, -6), end: weekEnd, metrics: emptyMetrics(),
    })
    const week = weeks.get(weekEnd)
    const source = entry.data.entry_type === "weekly" ? "weekly" : "single"
    for (const { key, weeklyKey } of activityMetrics) {
      const field = source === "weekly" ? weeklyKey : key
      if (field === null) continue
      const value = entry.data[field]
      if (value == null) continue
      if (!isValidActivityMeasurement(value)) {
        invalidMeasurementCount += 1
        continue
      }
      addMeasurement(totals[key], source, value)
      addMeasurement(week.metrics[key], source, value)
    }
  }
  return {
    entries: visibleEntries,
    start,
    end: today,
    totals,
    invalidMeasurementCount,
    weeks: [...weeks.values()].sort((a, b) => a.end.localeCompare(b.end)),
    singleCount: visibleEntries.filter((entry) => entry.data.entry_type !== "weekly").length,
    weeklyCount: visibleEntries.filter((entry) => entry.data.entry_type === "weekly").length,
  }
}
