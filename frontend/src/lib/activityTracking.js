import { getDistance } from "geolib"

export function normalizeActivityRoute(route) {
  const segments = new Map()
  return route.map((point) => {
    if (!segments.has(point.segment)) segments.set(point.segment, segments.size)
    return {
      latitude: Number(point.latitude.toFixed(8)),
      longitude: Number(point.longitude.toFixed(8)),
      altitude_m: Number.isFinite(point.altitude_m) && point.altitude_m >= -500 && point.altitude_m <= 10000
        ? Number(point.altitude_m.toFixed(2)) : null,
      segment: segments.get(point.segment),
      ...(point.estimated === true ? { estimated: true } : {}),
    }
  })
}

export function emptyActivityTrack() {
  return {
    distanceM: 0,
    estimatedDistanceM: 0,
    ascentM: null,
    descentM: null,
    movingMs: 0,
    samples: 0,
    last: null,
    gap: null,
    sample: null,
    altitude: null,
    route: [],
  }
}

export function addActivityPosition(track, point, activityType) {
  const valid =
    Number.isFinite(point.latitude) &&
    Math.abs(point.latitude) <= 90 &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.longitude) <= 180 &&
    Number.isFinite(point.accuracy) &&
    point.accuracy >= 0 &&
    point.accuracy <= 35 &&
    Number.isFinite(point.timestamp)
  if (!valid) return { ...track, gap: track.gap ?? track.last, last: null, sample: null, altitude: null }
  if (track.sample && point.timestamp <= track.sample.timestamp) return track
  const next = { ...track, samples: track.samples + 1, sample: point }
  const sampleSeconds = track.sample ? (point.timestamp - track.sample.timestamp) / 1000 : 0
  const sampleDistance = track.sample ? getDistance(track.sample, point, 0.1) : 0
  const reportedSpeedKmh = Number.isFinite(point.speed) && point.speed >= 0 ? point.speed * 3.6 : null
  const sampledSpeedKmh =
    reportedSpeedKmh ?? (sampleSeconds > 0 ? (sampleDistance / sampleSeconds) * 3.6 : 0)
  const movementThresholdKmh = activityType === "Caminata" ? 1.5 : 3
  const reliableDisplacement =
    track.sample !== null && sampleDistance >= Math.max(3, (point.accuracy + track.sample.accuracy) * 0.25)
  if (
    sampleSeconds > 0 &&
    sampleSeconds <= 30 &&
    sampledSpeedKmh >= movementThresholdKmh &&
    (reportedSpeedKmh !== null || reliableDisplacement)
  ) {
    next.movingMs += sampleSeconds * 1000
  }
  const seconds = track.last ? (point.timestamp - track.last.timestamp) / 1000 : 0
  const maxKmh = activityType === "Bicicleta" ? 100 : activityType === "Correr" ? 35 : 15
  const appendRoutePoint = (estimated = false) => {
    const previousSegment = track.route.at(-1)?.segment ?? -1
    const segment = !track.last || seconds > 30 ? previousSegment + 1 : previousSegment
    next.route = [
      ...track.route,
      {
        latitude: Number(point.latitude.toFixed(8)),
        longitude: Number(point.longitude.toFixed(8)),
        altitude_m:
          Number.isFinite(point.altitude) && point.altitude >= -500 && point.altitude <= 10000 &&
          Number.isFinite(point.altitudeAccuracy) && point.altitudeAccuracy >= 0 && point.altitudeAccuracy <= 10
            ? Number(point.altitude.toFixed(2))
            : null,
        segment,
        ...(estimated ? { estimated: true } : {}),
      },
    ]
    // Retain the whole ride at reduced resolution instead of dropping its beginning.
    if (next.route.length > 5000) {
      next.route = reduceActivityRoute(next.route)
    }
  }
  if (!track.last || seconds > 30) {
    const previous = track.gap ?? track.last
    let estimated = false
    if (previous) {
      const gapSeconds = (point.timestamp - previous.timestamp) / 1000
      const gapDistance = getDistance(previous, point, 0.1)
      if (gapSeconds <= 0 || (gapDistance / gapSeconds) * 3.6 > maxKmh) {
        return { ...track, gap: previous, last: null, sample: null, altitude: null }
      }
      estimated = gapDistance >= Math.max(5, (point.accuracy + previous.accuracy) / 2)
      if (estimated) next.estimatedDistanceM = (track.estimatedDistanceM ?? 0) + gapDistance
    }
    next.last = point
    next.gap = null
    appendRoutePoint(estimated)
    return updateActivityAltitude({ ...next, altitude: null }, point)
  }
  const distance = getDistance(track.last, point, 0.1)
  if ((distance / seconds) * 3.6 > maxKmh) return { ...track, gap: track.last, last: null, sample: null, altitude: null }
  if (distance < Math.max(5, (point.accuracy + track.last.accuracy) / 2)) return next
  next.distanceM += distance
  next.last = point
  appendRoutePoint()
  return updateActivityAltitude(next, point)
}

function updateActivityAltitude(track, point) {
  const hasAltitude =
    Number.isFinite(point.altitude) &&
    point.altitude >= -500 && point.altitude <= 10000 &&
    Number.isFinite(point.altitudeAccuracy) &&
    point.altitudeAccuracy >= 0 &&
    point.altitudeAccuracy <= 10
  // Keep a reliable reference through intermittent missing altitude, not GPS gaps.
  const anchor = track.altitude && point.timestamp - track.altitude.timestamp <= 120000 &&
    getDistance(track.altitude, point, 0.1) <= 500 ? track.altitude : null
  if (!hasAltitude) return { ...track, altitude: anchor }
  if (!anchor) return { ...track, altitude: point }
  const change = point.altitude - anchor.altitude
  if (Math.abs(change) >= Math.max(5, point.altitudeAccuracy + anchor.altitudeAccuracy)) {
    return {
      ...track,
      ascentM: (track.ascentM ?? 0) + Math.max(0, change),
      descentM: (track.descentM ?? 0) + Math.max(0, -change),
      altitude: point,
    }
  }
  return { ...track, altitude: anchor, ascentM: track.ascentM ?? 0, descentM: track.descentM ?? 0 }
}

export function reduceActivityRoute(route) {
  let estimated = false
  const reduced = []
  for (const [index, point] of route.entries()) {
    if (index > 0 && point.segment !== route[index - 1].segment && !point.estimated) estimated = false
    estimated ||= point.estimated === true
    if (index % 2 !== 0 && index !== route.length - 1) continue
    reduced.push(estimated ? { ...point, estimated: true } : point)
    estimated = false
  }
  return normalizeActivityRoute(reduced)
}

export function routeElevation(route) {
  let anchor = null
  let ascentM = null
  let descentM = null
  for (const point of route) {
    if (point.estimated || (anchor && point.segment !== anchor.segment)) anchor = null
    if (!Number.isFinite(point.altitude_m) || point.altitude_m < -500 || point.altitude_m > 10000) continue
    if (anchor && getDistance(anchor, point, 0.1) <= 500) {
      ascentM ??= 0
      descentM ??= 0
      const change = point.altitude_m - anchor.altitude_m
      // Stored routes omit vertical accuracy; use the maximum accepted 10 m per reading.
      if (Math.abs(change) < 20) continue
      ascentM = (ascentM ?? 0) + Math.max(0, change)
      descentM = (descentM ?? 0) + Math.max(0, -change)
    }
    anchor = point
  }
  return { ascentM, descentM }
}
