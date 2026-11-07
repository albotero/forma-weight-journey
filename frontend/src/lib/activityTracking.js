import { getDistance } from "geolib"

export function emptyActivityTrack() {
  return {
    distanceM: 0,
    ascentM: null,
    descentM: null,
    movingMs: 0,
    samples: 0,
    last: null,
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
  if (!valid) return { ...track, last: null, sample: null, altitude: null }
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
  const appendRoutePoint = () => {
    const previousSegment = track.route.at(-1)?.segment ?? -1
    const segment = !track.last || seconds > 30 ? previousSegment + 1 : previousSegment
    next.route = [
      ...track.route,
      {
        latitude: point.latitude,
        longitude: point.longitude,
        altitude_m:
          Number.isFinite(point.altitude) && Number.isFinite(point.altitudeAccuracy) && point.altitudeAccuracy <= 10
            ? Number(point.altitude.toFixed(2))
            : null,
        segment,
      },
    ].slice(-5000)
  }
  if (!track.last || seconds > 30) {
    next.last = point
    appendRoutePoint()
    return { ...next, altitude: null }
  }
  const distance = getDistance(track.last, point, 0.1)
  const maxKmh = activityType === "Bicicleta" ? 100 : activityType === "Correr" ? 35 : 15
  if ((distance / seconds) * 3.6 > maxKmh) return { ...track, last: null, sample: null, altitude: null }
  if (distance < Math.max(5, (point.accuracy + track.last.accuracy) / 2)) return next
  next.distanceM += distance
  next.last = point
  appendRoutePoint()
  const hasAltitude =
    Number.isFinite(point.altitude) &&
    Number.isFinite(point.altitudeAccuracy) &&
    point.altitudeAccuracy >= 0 &&
    point.altitudeAccuracy <= 10
  if (!hasAltitude) return { ...next, altitude: null }
  next.altitude = track.altitude ?? point
  if (track.altitude) {
    const change = point.altitude - track.altitude.altitude
    if (Math.abs(change) >= Math.max(5, point.altitudeAccuracy + track.altitude.altitudeAccuracy)) {
      next.ascentM = (track.ascentM ?? 0) + Math.max(0, change)
      next.descentM = (track.descentM ?? 0) + Math.max(0, -change)
      next.altitude = point
    }
  }
  return next
}
