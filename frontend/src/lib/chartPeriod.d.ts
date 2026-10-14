export type ChartPeriod = "30d" | "90d" | "6m" | "1y" | null
export const chartPeriods: readonly { value: ChartPeriod; label: string }[]
export function chartPeriodStart(today: string, period: ChartPeriod): string | null
export function shiftCalendarDate(day: string, days: number): string
