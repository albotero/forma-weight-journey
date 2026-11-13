import { addActivityPosition, emptyActivityTrack, routeElevation } from "./activityTracking.js"
import { recordedActivity } from "./activityDraft.js"

export const maxGpxBytes = 5 * 1024 * 1024

export function parseActivityGpx(xml, activityType) {
  if (new globalThis.TextEncoder().encode(xml).length > maxGpxBytes) throw new Error("El GPX supera el límite de 5 MB.")
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("El GPX no debe contener declaraciones externas.")
  const document = new globalThis.DOMParser().parseFromString(xml, "application/xml")
  if (document.getElementsByTagName("parsererror").length || document.documentElement.localName !== "gpx") {
    throw new Error("El archivo no es un GPX válido.")
  }
  const segments = Array.from(document.getElementsByTagNameNS("*", "trkseg"))
  const routes = segments.length ? segments : Array.from(document.getElementsByTagNameNS("*", "rte"))
  if (!routes.length) throw new Error("El GPX no contiene un recorrido. Exporta la actividad, no solo sus waypoints.")
  let count = 0
  const number = (raw, label) => {
    if (raw === null || raw.trim() === "" || !Number.isFinite(Number(raw))) throw new Error(`GPX: ${label} no válido.`)
    return Number(raw)
  }
  return importActivityGpxSegments(routes.map((segment) => {
    const nodes = Array.from(segment.children).filter((node) => ["trkpt", "rtept"].includes(node.localName))
    count += nodes.length
    if (count > 20000) throw new Error("El GPX supera los 20000 puntos. Exporta una versión simplificada.")
    return nodes.map((node) => {
      const child = (name) => Array.from(node.children).find((item) => item.localName === name)?.textContent?.trim() ?? null
      const time = child("time")
      if (!time || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(time)) {
        throw new Error("El GPX necesita fecha, hora y zona horaria en cada punto para calcular duración y calorías.")
      }
      return {
        latitude: number(node.getAttribute("lat"), "latitud"),
        longitude: number(node.getAttribute("lon"), "longitud"),
        timestamp: Date.parse(time),
        altitude: child("ele") === null ? null : number(child("ele"), "altitud"),
      }
    })
  }), activityType)
}

export function importActivityGpxSegments(segments, activityType) {
  if (!["Caminata", "Correr", "Bicicleta"].includes(activityType)) throw new Error("Selecciona Caminata, Correr o Bicicleta para importar GPX.")
  if (segments.reduce((sum, segment) => sum + segment.length, 0) > 20000) throw new Error("El GPX supera los 20000 puntos.")
  let track = emptyActivityTrack()
  let first = null
  let previous = null
  let elapsedMs = 0
  let count = 0
  let filteredPoints = 0
  for (const segment of segments) {
    track = { ...track, last: null, gap: null, sample: null, altitude: null }
    let segmentStart = null
    let segmentEnd = null
    for (const point of segment) {
      count++
      if (count > 20000) throw new Error("El GPX supera los 20000 puntos.")
      if (!Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 ||
        !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180 ||
        !Number.isFinite(point.timestamp) || (previous !== null && point.timestamp <= previous) ||
        (point.altitude !== null && (!Number.isFinite(point.altitude) || point.altitude < -500 || point.altitude > 10000))) {
        throw new Error("El GPX contiene coordenadas, altitudes o tiempos inválidos; los tiempos deben avanzar.")
      }
      first ??= point.timestamp
      segmentStart ??= point.timestamp
      segmentEnd = previous = point.timestamp
      if (point.timestamp - first > 86400000) throw new Error("Importa una sola actividad de hasta 24 horas.")
      const next = addActivityPosition(track, {
        ...point, accuracy: 0, altitude: null, altitudeAccuracy: null,
      }, activityType)
      if (next.last?.timestamp === point.timestamp) {
        // GPX has no guaranteed vertical accuracy; retain its elevation as supplied,
        // then calculate conservative changes separately, never label it a precise fix.
        const last = next.route.at(-1)
        next.route = [...next.route.slice(0, -1), { ...last, altitude_m: point.altitude === null ? null : Number(point.altitude.toFixed(2)) }]
      } else {
        filteredPoints++
      }
      track = next
    }
    if (segmentStart !== null) elapsedMs += segmentEnd - segmentStart
  }
  if (count < 2 || elapsedMs <= 0 || track.route.length < 2) throw new Error("El GPX necesita al menos dos puntos utilizables con tiempos diferentes.")
  const elevation = routeElevation(track.route)
  track = { ...track, ...elevation }
  return {
    activity: recordedActivity({
      version: 1, activityType, intensity: "", startedAt: new Date(first).toISOString(),
      elapsedMs, track, finished: true,
    }),
    filteredPoints,
  }
}
