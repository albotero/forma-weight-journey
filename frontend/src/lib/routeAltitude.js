const altitudeStops = [
  { at: 0, rgb: [45, 108, 207] },
  { at: 0.25, rgb: [28, 158, 163] },
  { at: 0.5, rgb: [226, 198, 71] },
  { at: 0.75, rgb: [231, 130, 59] },
  { at: 1, rgb: [174, 59, 62] },
]

export function routeAltitudeRange(points) {
  const altitudes = points
    .filter(
      (point) =>
        point.estimated !== true &&
        typeof point.altitude_m === "number" &&
        Number.isFinite(point.altitude_m) &&
        point.altitude_m >= -500 &&
        point.altitude_m <= 10000,
    )
    .map(({ altitude_m }) => altitude_m)
  if (!altitudes.length) return null
  return { min: Math.min(...altitudes), max: Math.max(...altitudes) }
}

export function routeAltitudeColor(altitude, range) {
  if (!range || !Number.isFinite(altitude)) return "#798993"
  const rawPosition = range.max > range.min ? Math.max(0, Math.min(1, (altitude - range.min) / (range.max - range.min))) : 0.5
  const position = range.max > range.min ? Math.round(rawPosition * 31) / 31 : 0.5
  const rightIndex = Math.min(altitudeStops.findIndex(({ at }) => at >= position), altitudeStops.length - 1)
  const left = altitudeStops[Math.max(0, rightIndex - 1)]
  const right = altitudeStops[rightIndex]
  const fraction = right.at === left.at ? 0 : (position - left.at) / (right.at - left.at)
  const channels = left.rgb.map((value, index) => Math.round(value + (right.rgb[index] - value) * fraction))
  return `rgb(${channels.join(", ")})`
}