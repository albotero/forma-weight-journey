import type { JournalEntry } from "../api"
import type { ChartPeriod } from "./chartPeriod.js"

export type ActivityMetricKey = "steps" | "calories_kcal" | "distance_km" | "duration_min"
export type ActivityMetricTotal = { single: number | null; weekly: number | null; total: number | null }
export const activityMetrics: readonly {
  key: ActivityMetricKey
  weeklyKey: string | null
  label: string
  unit: string
}[]
export function isValidActivityMeasurement(value: unknown): value is number
export function shiftActivityDate(day: string, days: number): string
export function activityEntryDate(entry: JournalEntry, timezone: string, now?: string): string
export function summarizeActivity(
  entries: JournalEntry[],
  timezone: string,
  period?: ChartPeriod,
  now?: string,
): {
  entries: JournalEntry[]
  start: string | null
  end: string
  totals: Record<ActivityMetricKey, ActivityMetricTotal>
  invalidMeasurementCount: number
  weeks: { start: string; end: string; metrics: Record<ActivityMetricKey, ActivityMetricTotal> }[]
  singleCount: number
  weeklyCount: number
}
export function weeklyActivityTotals(
  values: Record<string, string | number | null>,
  inputMode: "daily_average" | "weekly_total",
): Record<string, number | null>
