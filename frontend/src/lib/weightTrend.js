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
