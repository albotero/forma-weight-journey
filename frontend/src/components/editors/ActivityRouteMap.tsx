import { useEffect, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import type { ActivityRoutePoint } from "../../lib/activityTracking.js"
import { routeElevationTrends } from "../../lib/activityTracking.js"

export function ActivityRouteMap({ points }: { points: ActivityRoutePoint[] }) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const routeLayer = useRef<L.LayerGroup | null>(null)
  const [showBaseMap, setShowBaseMap] = useState(true)
  const hasPoints = points.length > 0

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
    for (let index = 1; index < points.length; index++) {
      if (points[index].estimated) estimatedLines.push([
        [points[index - 1].latitude, points[index - 1].longitude],
        [points[index].latitude, points[index].longitude],
      ])
    }
    for (const group of groups.values()) {
      const trends = routeElevationTrends(group)
      let previousColor: string | null = null
      let continuousLine: L.LatLngTuple[] | null = null
      if (group.length === 1) {
        const point = group[0]
        L.circleMarker([point.latitude, point.longitude], {
          radius: 5,
          color: "#176f65",
          fillColor: "#fff",
          fillOpacity: 1,
          weight: 3,
        }).addTo(layer)
      }
      for (let index = 1; index < group.length; index += 1) {
        const previous = group[index - 1]
        const current = group[index]
        if (current.estimated) {
          continuousLine = null
          previousColor = null
          continue
        }
        const color =
          trends[index] === null
            ? "#798993"
            : trends[index] === "ascent"
              ? "#d36f38"
              : trends[index] === "descent"
                ? "#377baa"
                : "#238274"
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
      radius: 9, color: "#176f65", weight: 3, fillColor: "#fff", fillOpacity: 1,
    }).bindTooltip("Inicio del recorrido").addTo(layer)
    L.circleMarker([end.latitude, end.longitude], {
      radius: 5, color: "#fff", weight: 2, fillColor: "#b94747", fillOpacity: 1,
    }).bindTooltip(points.length === 1 ? "Inicio y fin del recorrido" : "Fin del recorrido").addTo(layer)
    const bounds = L.latLngBounds(points.map((point) => [point.latitude, point.longitude]))
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 })
  }, [points, hasPoints])

  if (!points.length) return null
  return (
    <section className="activity-route" aria-label="Recorrido GPS">
      <div className="activity-route-heading">
        <strong>Recorrido GPS</strong>
        <label>
          <input type="checkbox" checked={showBaseMap} onChange={(event) => setShowBaseMap(event.target.checked)} />
          Mapa de calles
        </label>
      </div>
      <div className="activity-route-map" ref={container} />
      <div className="activity-route-legend" aria-label="Cambios de altitud">
        <span><i className="route-start" /> Inicio</span>
        <span><i className="route-end" /> Fin</span>
        <span><i className="ascent" /> Ascenso</span>
        <span><i className="level" /> Sin cambio relevante</span>
        <span><i className="descent" /> Descenso</span>
        <span><i className="unknown" /> Altitud sin datos fiables</span>
        <span><i className="estimated" /> Unión estimada sin señal GPS</span>
      </div>
      <small>Gris continuo: posición GPS con altitud desconocida. Gris punteado: unión recta estimada, no recorrido medido; puede infravalorar curvas y no aporta ascenso. Las pausas manuales quedan separadas.</small>
      <small>Los colores comparan la tendencia de altitud con puntos vecinos hasta 25 m a cada lado: pendiente de al menos 1 % y cambio suavizado de 0,5 m. No modifican el ascenso ni las calorías.</small>
      <small>Altitud disponible en {points.filter((point) => point.altitude_m !== null).length} de {points.length} puntos. Los totales de ascenso son parciales si faltan lecturas; el fondo de calles no proporciona elevación.</small>
      {showBaseMap && <small>OpenStreetMap recibe solicitudes de teselas para mostrar esta zona aproximada.</small>}
    </section>
  )
}