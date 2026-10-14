export type MeasurementPoint = { id?: number; occurredAt: string; date: string; value: number }
export function measurementPointsInPeriod(
  points: MeasurementPoint[], timezone: string, period?: ChartPeriod, now?: string,
): MeasurementPoint[]
export function measurementStats(points: MeasurementPoint[]): {
  latest: number | null; change: number | null; average: number | null; count: number
}
import type { ChartPeriod } from "./chartPeriod.js"
