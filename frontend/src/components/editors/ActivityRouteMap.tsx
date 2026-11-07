import { useEffect, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import type { ActivityRoutePoint } from "../../lib/activityTracking.js"

export function ActivityRouteMap({ points }: { points: ActivityRoutePoint[] }) {
  const container = useRef<HTMLDivElement>(null)
  const [showBaseMap, setShowBaseMap] = useState(false)

  useEffect(() => {
    if (!container.current || !points.length) return
    const map = L.map(container.current, { scrollWheelZoom: false, zoomControl: true })
    if (showBaseMap) {
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map)
    }
    const groups = new Map<number, ActivityRoutePoint[]>()
    for (const point of points) groups.set(point.segment, [...(groups.get(point.segment) ?? []), point])
    for (const group of groups.values()) {
      if (group.length === 1) {
        const point = group[0]
        L.circleMarker([point.latitude, point.longitude], {
          radius: 5,
          color: "#176f65",
          fillColor: "#fff",
          fillOpacity: 1,
          weight: 3,
        }).addTo(map)
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
        L.polyline(
          [
            [previous.latitude, previous.longitude],
            [current.latitude, current.longitude],
          ],
          { color, weight: 5, opacity: 0.9, lineCap: "round" },
        ).addTo(map)
      }
    }
    const bounds = L.latLngBounds(points.map((point) => [point.latitude, point.longitude]))
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 })
    const frame = requestAnimationFrame(() => map.invalidateSize())
    return () => {
      cancelAnimationFrame(frame)
      map.remove()
    }
  }, [points, showBaseMap])

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
      </div>
      {showBaseMap && <small>OpenStreetMap recibe solicitudes de teselas para mostrar esta zona aproximada.</small>}
    </section>
  )
}