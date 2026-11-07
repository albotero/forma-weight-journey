export function weightMovingAverageSeries(weights) {
  const ordered = weights
    .map((item) => ({ item, timestamp: new Date(item.measured_at).getTime() }))
    .sort((first, second) => first.timestamp - second.timestamp)
  const points = []
  let windowStart = 0
  let total = 0
  let index = 0
  while (index < ordered.length) {
    const timestamp = ordered[index].timestamp
    const cutoff = timestamp - 7 * 86400000
    while (windowStart < index && ordered[windowStart].timestamp <= cutoff) {
      total -= ordered[windowStart].item.weight_kg
      windowStart += 1
    }
    let groupEnd = index
    while (groupEnd < ordered.length && ordered[groupEnd].timestamp === timestamp) {
      total += ordered[groupEnd].item.weight_kg
      groupEnd += 1
    }
    const average = Math.round((total / (groupEnd - windowStart)) * 100) / 100
    for (let groupIndex = index; groupIndex < groupEnd; groupIndex += 1) {
      points.push({ ...ordered[groupIndex].item, moving_average_7d_kg: average })
    }
    index = groupEnd
  }
  return points
}

export function weightAverageChangeBetweenWeeks(weights, now = Date.now()) {
  const timestamp = typeof now === "number" ? now : new Date(now).getTime()
  const week = 7 * 86400000
  const current = []
  const previous = []
  for (const item of weights) {
    const measuredAt = new Date(item.measured_at).getTime()
    const age = timestamp - measuredAt
    if (!Number.isFinite(measuredAt) || age < 0 || age > week * 2) continue
    if (age <= week) current.push(item.weight_kg)
    else previous.push(item.weight_kg)
  }
  if (!current.length || !previous.length) return null
  const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length
  return Number((average(current) - average(previous)).toFixed(2))
}
