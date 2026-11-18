import type { JournalEntry, WeightEntry } from "../../api"
import { activityCalculations, isValidActivityMeasurement } from "../../lib/activity.js"
import { routeElevation, type ActivityRoutePoint } from "../../lib/activityTracking.js"
import { formatDecimal } from "../../lib/format"

export function StravaActivityMetrics({ entry, weights }: { entry: JournalEntry; weights: WeightEntry[] }) {
  const { data } = entry
  const number = (key: string) => {
    const value = data[key]
    return isValidActivityMeasurement(value) ? Number(value) : null
  }
  const elevation = Array.isArray(data.route) ? routeElevation(data.route as ActivityRoutePoint[]) : null
  const ascent = number("elevation_gain_m")
  const descent = number("elevation_loss_m")
  const distance = number("distance_km")
  const duration = number("duration_min")
  const moving = number("moving_duration_min")
  const speed = number("average_speed_kmh") ?? (distance !== null && moving ? distance / moving * 60 : null)
  const calories = number("calories_kcal")
  const estimated = activityCalculations({ ...entry, data: { ...data, calories_kcal: null } }, weights)
  const metric = (label: string, value: number | null, unit: string) => value === null ? null : (
    <div key={label}>
      <span>{label}</span>
      <strong>{formatDecimal(value)}{unit ? ` ${unit}` : ""}</strong>
    </div>
  )

  return (
    <>
      <div className="composition-results">
        {metric("Distancia", distance, "km")}
        {metric("En movimiento", moving ?? duration, "min")}
        {metric(calories === null ? "Calorías est." : "Calorías", calories ?? estimated.estimatedCalories, "kcal")}
        {metric(ascent === null ? "Ascenso est." : "Ascenso total", ascent ?? elevation?.ascentM ?? null, "m")}
        {metric(descent === null ? "Descenso est." : "Descenso total", descent ?? elevation?.descentM ?? null, "m")}
        {metric("FC máxima", number("max_heart_rate_bpm"), "lpm")}
        {metric("MET medios est.", estimated.met, "")}
      </div>
      <details className="activity-route-details">
        <summary>Más detalles</summary>
        <div className="composition-results">
          {metric("Tiempo total", duration, "min")}
          {metric("Tiempo detenido", duration !== null && moving !== null ? Math.max(0, duration - moving) : null, "min")}
          {metric("Velocidad media en movimiento", speed, "km/h")}
          {metric("Velocidad máxima", number("max_speed_kmh"), "km/h")}
          {data.activity_type !== "Bicicleta" && metric("Ritmo en movimiento", speed ? 60 / speed : null, "min/km")}
          {metric("FC media", number("average_heart_rate_bpm"), "lpm")}
          {metric("Potencia media", number("average_power_w"), "W")}
          {metric("Potencia ponderada", number("weighted_power_w"), "W")}
          {metric("Potencia máxima", number("max_power_w"), "W")}
          {metric("Cadencia media", number("average_cadence"), data.activity_type === "Bicicleta" ? "rpm" : "")}
        </div>
        {typeof data.strava_activity_id === "number" && (
          <a className="small-action" href={`https://www.strava.com/activities/${data.strava_activity_id}`} target="_blank" rel="noreferrer">
            Ver en Strava
          </a>
        )}
      </details>
    </>
  )
}