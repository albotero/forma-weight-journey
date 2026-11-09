import { emptyActivityTrack, normalizeActivityRoute } from "./activityTracking.js"

export function readActivityDraft(storage, key) {
  if (!key) return null
  const raw = storage.getItem(key)
  if (!raw) return null
  const draft = JSON.parse(raw)
  const track = draft?.track
  const nonnegative = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0
  if (
    draft?.version !== 1 || !["Caminata", "Correr", "Bicicleta"].includes(draft.activityType) ||
    typeof draft.intensity !== "string" || typeof draft.finished !== "boolean" ||
    typeof draft.startedAt !== "string" || !Number.isFinite(Date.parse(draft.startedAt)) ||
    !nonnegative(draft.elapsedMs) || !track ||
    !nonnegative(track.distanceM) || !nonnegative(track.movingMs) || !nonnegative(track.samples) ||
    ![track.ascentM, track.descentM].every((value) => value === null || nonnegative(value)) ||
    !Array.isArray(track.route) || track.route.length > 5000 ||
    !track.route.every((point) =>
      point && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 &&
      Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180 &&
      (point.altitude_m === null || (Number.isFinite(point.altitude_m) && point.altitude_m >= -500 && point.altitude_m <= 10000)) &&
      Number.isInteger(point.segment) && point.segment >= 0,
    )
  ) throw new Error("No se pudo recuperar el borrador GPS: los datos guardados no son válidos.")
  return { ...draft, track: {
    ...emptyActivityTrack(), ...track, route: normalizeActivityRoute(track.route), last: null, sample: null, altitude: null,
  } }
}

export function writeActivityDraft(storage, key, draft) {
  if (!key) throw new Error("No se puede guardar la recuperación GPS sin un perfil de cuenta.")
  storage.setItem(key, JSON.stringify({
    ...draft, version: 1,
    track: { ...draft.track, last: null, sample: null, altitude: null },
  }))
}

export function recordedActivity(draft) {
  return {
    startedAt: draft.startedAt,
    durationMin: Number((draft.elapsedMs / 60000).toFixed(2)),
    distanceKm: Number((draft.track.distanceM / 1000).toFixed(2)),
    ascentM: draft.track.ascentM === null ? null : Number(draft.track.ascentM.toFixed(2)),
    descentM: draft.track.descentM === null ? null : Number(draft.track.descentM.toFixed(2)),
    movingDurationMin: Number((Math.min(draft.track.movingMs, draft.elapsedMs) / 60000).toFixed(2)),
    route: normalizeActivityRoute(draft.track.route),
  }
}
