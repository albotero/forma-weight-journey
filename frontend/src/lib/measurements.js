import { dateTimeInputValue } from "../dateTime.js"
import { chartPeriodStart } from "./chartPeriod.js"

export function measurementPointsInPeriod(points, timezone, period = "90d", now = new Date().toISOString()) {
  const today = dateTimeInputValue(now, timezone).slice(0, 10)
  const start = chartPeriodStart(today, period)
  return points
    .filter(({ occurredAt, value }) => {
      if (typeof value !== "number" || !Number.isFinite(value)) return false
      const day = dateTimeInputValue(occurredAt, timezone).slice(0, 10)
      return day <= today && (start === null || day >= start)
    })
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || (a.id ?? 0) - (b.id ?? 0))
}

export function measurementStats(points) {
  if (!points.length) return { latest: null, change: null, average: null, count: 0 }
  const latest = points.at(-1).value
  return {
    latest,
    change: points.length < 2 ? null : Number((latest - points.at(-2).value).toFixed(2)),
    average: Number((points.reduce((sum, { value }) => sum + value, 0) / points.length).toFixed(2)),
    count: points.length,
  }
}
