import { useEffect, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { formatDecimal } from "../../lib/format"
import type { ActivityRoutePoint } from "../../lib/activityTracking.js"
import { routeAltitudeColor, routeAltitudeRange } from "../../lib/routeAltitude.js"

export function ActivityRouteMap({
  points,
  gpxImported = false,
  showTechnicalDetails = true,
}: {
  points: ActivityRoutePoint[]
  gpxImported?: boolean
  showTechnicalDetails?: boolean
}) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const routeLayer = useRef<L.LayerGroup | null>(null)
  const [showBaseMap, setShowBaseMap] = useState(true)
  const hasPoints = points.length > 0
  const altitudeRange = routeAltitudeRange(points)
  const hasUnknownAltitude = points.some((point) => point.estimated !== true && point.altitude_m === null)
  const hasEstimatedSegments = points.some((point) => point.estimated === true)

  useEffect(() => {
    if (!container.current || !hasPoints) return
    const map = L.map(container.current, { scrollWheelZoom: false, zoomControl: true, preferCanvas: true })
    mapRef.current = map
    routeLayer.current = L.layerGroup().addTo(map)
    const frame = requestAnimationFrame(() => map.invalidateSize())
    return () => {
      cancelAnimationFrame(frame)
      map.remove()
      mapRef.current = null
      routeLayer.current = null
    }
  }, [hasPoints])

  useEffect(() => {
    if (!showBaseMap || !mapRef.current) return
    const tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(mapRef.current)
    return () => { tiles.remove() }
  }, [showBaseMap, hasPoints])

  useEffect(() => {
    const map = mapRef.current
    const layer = routeLayer.current
    if (!map || !layer || !points.length) return
    layer.clearLayers()
    const groups = new Map<number, ActivityRoutePoint[]>()
    for (const point of points) {
      if (!groups.has(point.segment)) groups.set(point.segment, [])
      groups.get(point.segment)!.push(point)
    }
    const lines = new Map<string, L.LatLngTuple[][]>()
    const estimatedLines: L.LatLngTuple[][] = []
    for (const group of groups.values()) {
      let previousColor: string | null = null
      let continuousLine: L.LatLngTuple[] | null = null
      if (group.length === 1) {
        const point = group[0]
        L.circleMarker([point.latitude, point.longitude], {
          radius: 3,
          color: "#176f65",
          fillColor: "#fff",
          fillOpacity: 1,
          weight: 1.5,
        }).addTo(layer)
      }
      for (let index = 1; index < group.length; index += 1) {
        const previous = group[index - 1]
        const current = group[index]
        const segmentCoordinates: L.LatLngTuple[] = [
          [previous.latitude, previous.longitude],
          [current.latitude, current.longitude],
        ]
        if (previous.estimated || current.estimated) {
          estimatedLines.push(segmentCoordinates)
          continuousLine = null
          previousColor = null
          continue
        }
        const altitude =
          Number.isFinite(previous.altitude_m) && Number.isFinite(current.altitude_m)
            ? ((previous.altitude_m ?? 0) + (current.altitude_m ?? 0)) / 2
            : null
        const color = routeAltitudeColor(altitude, altitudeRange)
        if (!lines.has(color)) lines.set(color, [])
        if (continuousLine && previousColor === color) {
          continuousLine.push([current.latitude, current.longitude])
        } else {
          continuousLine = [
            [previous.latitude, previous.longitude], [current.latitude, current.longitude],
          ]
          lines.get(color)!.push(continuousLine)
        }
        previousColor = color
      }
    }
    for (const [color, segments] of lines) {
      L.polyline(segments, {
        color, weight: 3, opacity: 0.9, lineCap: "round", lineJoin: "round", smoothFactor: 1.5,
      }).addTo(layer)
    }
    if (estimatedLines.length) L.polyline(estimatedLines, {
      color: "#798993", weight: 2.5, opacity: 0.9, dashArray: "8 8", lineCap: "round", lineJoin: "round",
    }).addTo(layer)
    const start = points[0]
    const end = points[points.length - 1]
    L.circleMarker([start.latitude, start.longitude], {
      radius: 4.25, color: "#fff", weight: 1.5, fillColor: "#176f65", fillOpacity: 1,
    }).bindTooltip("Inicio del recorrido").addTo(layer)
    L.circleMarker([end.latitude, end.longitude], {
      radius: 4.25, color: "#fff", weight: 1.5, fillColor: "#b94747", fillOpacity: 1,
    }).bindTooltip(start.latitude === end.latitude && start.longitude === end.longitude
      ? "Inicio y fin del recorrido" : "Fin del recorrido").addTo(layer)
    const bounds = L.latLngBounds(points.map((point) => [point.latitude, point.longitude]))
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 })
  }, [points, hasPoints, altitudeRange])

  if (!points.length) return null
  return (
    <section className="activity-route" aria-label="Recorrido GPS">
      <div className="activity-route-heading">
        <strong>Recorrido GPS</strong>
        <label>
          <input type="checkbox" checked={showBaseMap} onChange={(event) => setShowBaseMap(event.target.checked)} />
          Calles
        </label>
      </div>
      <div className="activity-route-map" ref={container} />
      <div className="activity-route-legend" aria-label="Cambios de altitud">
        <span><i className="route-start" /> Inicio</span>
        <span><i className="route-end" /> Fin</span>
        {altitudeRange && (
          <span className="activity-route-altitude-scale">
            <small>{formatDecimal(altitudeRange.min)} m</small>
            <i aria-hidden="true" />
            <small>{formatDecimal(altitudeRange.max)} m</small>
          </span>
        )}
        {hasUnknownAltitude && <span><i className="unknown" /> Sin altitud</span>}
        {hasEstimatedSegments && <span><i className="estimated" /> Tramo estimado</span>}
      </div>
      {showTechnicalDetails ? <details className="activity-route-details">
        <summary>Detalles del recorrido</summary>
        <p>
          El degradado muestra la altitud absoluta de cada tramo entre el mínimo y el máximo fiables del recorrido. La
          línea discontinua une puntos sin señal GPS; no es una ruta medida y no aporta ascenso. Las pausas manuales
          quedan separadas.
        </p>
        <p>
          Altitud disponible en {points.filter((point) => point.altitude_m !== null).length} de {points.length} puntos.
          El ascenso es parcial si faltan lecturas. La distancia de las uniones estimadas se incluye en el total.
        </p>
        {gpxImported && <p>El GPX no declara la precisión de sus altitudes.</p>}
        {showBaseMap && <p>El mapa de calles usa OpenStreetMap y carga teselas de la zona.</p>}
      </details> : showBaseMap && <small>Mapa de calles: OpenStreetMap.</small>}
    </section>
  )
}