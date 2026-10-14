import { dateTimeInputValue } from "../dateTime.js"

export const activityMetrics = [
  { key: "steps", weeklyKey: "weekly_steps", label: "Pasos", unit: "pasos" },
  { key: "calories_kcal", weeklyKey: "weekly_calories_kcal", label: "Calorías", unit: "kcal" },
  { key: "distance_km", weeklyKey: "weekly_distance_km", label: "Distancia", unit: "km" },
  { key: "duration_min", weeklyKey: null, label: "Duración", unit: "min" },
]

export function isValidActivityMeasurement(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

export function shiftActivityDate(day, days) {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function activityWeekStart(day) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay()
  return shiftActivityDate(day, -(weekday === 0 ? 6 : weekday - 1))
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

export function summarizeActivity(entries, timezone, weekCount = 4, now = new Date().toISOString()) {
  const today = dateTimeInputValue(now, timezone).slice(0, 10)
  const currentWeek = activityWeekStart(today)
  const start = weekCount === null ? null : shiftActivityDate(currentWeek, -(weekCount - 1) * 7)
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
    const weekStart = activityWeekStart(activityEntryDate(entry, timezone, now))
    if (!weeks.has(weekStart)) weeks.set(weekStart, { start: weekStart, metrics: emptyMetrics() })
    const week = weeks.get(weekStart)
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
    weeks: [...weeks.values()].sort((a, b) => a.start.localeCompare(b.start)),
    singleCount: visibleEntries.filter((entry) => entry.data.entry_type !== "weekly").length,
    weeklyCount: visibleEntries.filter((entry) => entry.data.entry_type === "weekly").length,
  }
}
