import { getDistance } from "geolib"

export function emptyActivityTrack() {
  return { distanceM: 0, ascentM: null, descentM: null, samples: 0, last: null, altitude: null }
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
  if (!valid) return { ...track, last: null, altitude: null }
  if (track.last && point.timestamp <= track.last.timestamp) return track
  const next = { ...track, samples: track.samples + 1, last: point }
  const seconds = track.last ? (point.timestamp - track.last.timestamp) / 1000 : 0
  if (!track.last || seconds > 30) return { ...next, altitude: null }
  const distance = getDistance(track.last, point, 0.1)
  const maxKmh = activityType === "Bicicleta" ? 100 : activityType === "Correr" ? 35 : 15
  if ((distance / seconds) * 3.6 > maxKmh) return { ...track, last: null, altitude: null }
  if (distance < Math.max(5, (point.accuracy + track.last.accuracy) / 2)) return track
  next.distanceM += distance
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
