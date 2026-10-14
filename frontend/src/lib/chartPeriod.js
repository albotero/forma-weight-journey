export function shiftCalendarDate(day, days) {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export const chartPeriods = [
  { value: "30d", label: "30 días" },
  { value: "90d", label: "90 días" },
  { value: "6m", label: "6 meses" },
  { value: "1y", label: "1 año" },
  { value: null, label: "Todo" },
]

export function chartPeriodStart(today, period) {
  if (period === null) return null
  if (period === "30d" || period === "90d") return shiftCalendarDate(today, period === "30d" ? -29 : -89)
  const date = new Date(`${today}T12:00:00Z`)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() - (period === "6m" ? 6 : 12))
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, lastDay))
  return date.toISOString().slice(0, 10)
}
