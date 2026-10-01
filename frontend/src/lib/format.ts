export const formatDate = (date: string, timeZone = "America/Bogota") =>
  new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone }).format(new Date(date))
export const formatDecimal = (value: number) =>
  new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(value)
export const niceAxis = (values: number[], paddingFloor = 1): { domain: [number, number]; ticks: number[] } => {
  if (!values.length) return { domain: [0, 1], ticks: [0, 1] }
  const minimum = Math.max(Math.min(...values), 0)
  const maximum = Math.max(...values)
  const padding = Math.max((maximum - minimum) * 0.1, paddingFloor)
  const paddedMin = Math.max(minimum - padding, 0)
  const paddedMax = maximum + padding
  const rawStep = (paddedMax - paddedMin) / 4
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const fraction = rawStep / magnitude
  const step = (fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10) * magnitude
  const lower = Math.max(Math.floor(paddedMin / step) * step, 0)
  const upper = Math.ceil(paddedMax / step) * step
  const ticks = Array.from({ length: Math.round((upper - lower) / step) + 1 }, (_, index) =>
    Number((lower + index * step).toPrecision(12)),
  )
  return { domain: [lower, upper], ticks }
}
export const formatAxisTick = (value: number, step = 0.01) => {
  const absoluteValue = Math.abs(value)
  const units = [
    { threshold: 1e12, divisor: 1e12, suffix: "T" },
    { threshold: 1e9, divisor: 1e9, suffix: "B" },
    { threshold: 1e6, divisor: 1e6, suffix: "M" },
    { threshold: 1e3, divisor: 1e3, suffix: "k" },
  ]
  const unit = units.find(({ threshold }) => absoluteValue >= threshold)
  return unit
    ? `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: Math.min(8, Math.max(1, -Math.floor(Math.log10(step / unit.divisor)))) }).format(value / unit.divisor)}${unit.suffix}`
    : new Intl.NumberFormat("es-CO", {
        maximumFractionDigits: Math.min(8, Math.max(2, -Math.floor(Math.log10(step)))),
      }).format(value)
}
export const isNumericString = (raw: string) => /^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(raw.trim())
export const formatDateTime = (value: string, timeZone = "America/Bogota") =>
  new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(value))
