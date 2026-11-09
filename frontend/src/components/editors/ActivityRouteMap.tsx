import { useEffect, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import type { ActivityRoutePoint } from "../../lib/activityTracking.js"

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
    for (const group of groups.values()) {
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
        const elevationChange =
          previous.altitude_m === null || current.altitude_m === null
            ? null
            : current.altitude_m - previous.altitude_m
        const color =
          elevationChange === null
            ? "#798993"
            : elevationChange > 1
              ? "#d36f38"
              : elevationChange < -1
                ? "#377baa"
                : "#238274"
        if (!lines.has(color)) lines.set(color, [])
        lines.get(color)!.push([
          [previous.latitude, previous.longitude], [current.latitude, current.longitude],
        ])
      }
    }
    for (const [color, segments] of lines) {
      L.polyline(segments, { color, weight: 5, opacity: 0.9, lineCap: "round" }).addTo(layer)
    }
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
        <span><i className="ascent" /> Ascenso</span>
        <span><i className="level" /> Sin cambio relevante</span>
        <span><i className="descent" /> Descenso</span>
        <span><i className="unknown" /> Altitud sin datos fiables</span>
      </div>
      <small>El gris indica altitud desconocida, no una pausa. Los huecos separan pausas o pérdida de señal GPS.</small>
      {showBaseMap && <small>OpenStreetMap recibe solicitudes de teselas para mostrar esta zona aproximada.</small>}
    </section>
  )
}