import type { JournalEntry } from "../api"

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
export function activityWeekStart(day: string): string
export function activityEntryDate(entry: JournalEntry, timezone: string, now?: string): string
export function summarizeActivity(
  entries: JournalEntry[],
  timezone: string,
  weekCount?: number | null,
  now?: string,
): {
  entries: JournalEntry[]
  start: string | null
  end: string
  totals: Record<ActivityMetricKey, ActivityMetricTotal>
  invalidMeasurementCount: number
  weeks: { start: string; metrics: Record<ActivityMetricKey, ActivityMetricTotal> }[]
  singleCount: number
  weeklyCount: number
}
