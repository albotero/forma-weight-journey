import { lazy, Suspense, useState, type FormEvent } from "react"
import type { JournalEntry, WeightEntry } from "../../api"
import { dateTimeInputValue, localDateTimeToIso } from "../../dateTime.js"
import { activityTypes, type ActivityType } from "../../lib/types"
import { activityCalculations, activityEntryDate, weeklyActivityTotals } from "../../lib/activity.js"
import { formatDecimal } from "../../lib/format"
import { Modal } from "../modals/Modal"
import { ActivityRecorder, type RecordedActivity } from "./ActivityRecorder"
import { normalizeActivityRoute, type ActivityRoutePoint } from "../../lib/activityTracking.js"
import { readActivityDraft, recordedActivity } from "../../lib/activityDraft.js"

const ActivityRouteMap = lazy(() => import("./ActivityRouteMap").then((module) => ({ default: module.ActivityRouteMap })))

export function ActivityEntryEditor({
  entry,
  timezone,
  weights = [],
  draftKey,
  onClose,
  onSave,
}: {
  entry?: JournalEntry
  timezone: string
  weights?: WeightEntry[]
  draftKey?: string
  onClose: () => void
  onSave: (payload: Omit<JournalEntry, "id" | "created_at" | "updated_at">) => Promise<void>
}) {
  const [recovery, setRecovery] = useState(() => {
    try {
      return { draft: !entry && draftKey ? readActivityDraft(window.localStorage, draftKey) : null, error: "" }
    } catch (reason) {
      return { draft: null, error: reason instanceof Error ? reason.message : "No se pudo leer el borrador GPS." }
    }
  })
  const recoveredActivity = recovery.draft?.finished ? recordedActivity(recovery.draft) : null
  const isLegacyEntry = Boolean(entry && !("entry_type" in entry.data))
  const [entryType, setEntryType] = useState<"single" | "weekly">(() =>
    entry?.data.entry_type === "weekly" ? "weekly" : "single",
  )
  const [activityType, setActivityType] = useState<ActivityType>(() => {
    const savedType = recovery.draft?.activityType ?? entry?.data.activity_type
    return activityTypes.includes(savedType as ActivityType)
      ? (savedType as ActivityType)
      : isLegacyEntry
        ? "Otro"
        : "Caminata"
  })
  const [otherActivity, setOtherActivity] = useState(() =>
    String(entry?.data.other_activity ?? (isLegacyEntry ? entry?.title : "")),
  )
  const [occurredAt, setOccurredAt] = useState(() =>
    dateTimeInputValue(recoveredActivity?.startedAt ?? entry?.occurred_at ?? new Date().toISOString(), timezone),
  )
  const [weekEnd, setWeekEnd] = useState(() =>
    entry?.data.entry_type === "weekly" ? activityEntryDate(entry, timezone) : occurredAt.split("T")[0],
  )
  const [duration, setDuration] = useState(() => String(recoveredActivity?.durationMin ?? entry?.data.duration_min ?? ""))
  const [distance, setDistance] = useState(() => String(recoveredActivity?.distanceKm ?? entry?.data.distance_km ?? ""))
  const [calories, setCalories] = useState(() => String(entry?.data.calories_kcal ?? ""))
  const [steps, setSteps] = useState(() => String(entry?.data.steps ?? ""))
  const [intensity, setIntensity] = useState(() => String(recovery.draft?.intensity ?? entry?.data.intensity ?? ""))
  const [weeklyCalories, setWeeklyCalories] = useState(() => String(entry?.data.weekly_calories_kcal ?? ""))
  const [weeklySteps, setWeeklySteps] = useState(() => String(entry?.data.weekly_steps ?? ""))
  const [weeklyDistance, setWeeklyDistance] = useState(() => String(entry?.data.weekly_distance_km ?? ""))
  const [weeklyInputMode, setWeeklyInputMode] = useState<"daily_average" | "weekly_total">(() =>
    entry?.data.entry_type === "weekly" ? "weekly_total" : "daily_average",
  )
  const [notes, setNotes] = useState(entry?.notes ?? "")
  const [error, setError] = useState(recovery.error)
  const [busy, setBusy] = useState(false)
  const [tracking, setTracking] = useState(false)
  const [recorded, setRecorded] = useState<RecordedActivity | null>(recoveredActivity)
  const trackingSource = recorded ? "gps" : entry?.data.tracking_source
  function close() {
    if (tracking && !window.confirm("¿Cerrar la sesión GPS? Se pausará; si el borrador local pudo guardarse, podrás recuperarlo al abrir una actividad nueva.")) return
    onClose()
  }
  function finishRecording(activity: RecordedActivity, recoverySaved: boolean) {
    setRecorded(activity)
    setOccurredAt(dateTimeInputValue(activity.startedAt, timezone))
    setDuration(String(activity.durationMin))
    setDistance(String(activity.distanceKm))
    if (!recoverySaved) setError("No se pudo conservar el recorrido finalizado en este dispositivo. Guarda ahora y no cierres esta pantalla.")
  }
  let calculationError = ""
  let calculationTimestamp = ""
  if (entryType === "single") {
    try {
      calculationTimestamp = localDateTimeToIso(occurredAt, timezone)
    } catch (reason) {
      calculationError = reason instanceof Error ? reason.message : "Selecciona una fecha y hora válidas."
    }
  }
  const calculated = activityCalculations(
    {
      occurred_at: calculationTimestamp,
      data: {
        entry_type: entryType,
        activity_type: activityType,
        intensity,
        tracking_source: trackingSource,
        moving_duration_min: recorded?.movingDurationMin ?? entry?.data.moving_duration_min,
        elevation_gain_m: recorded ? recorded.ascentM : entry?.data.elevation_gain_m,
        duration_min: duration.trim() === "" ? null : Number(duration),
        distance_km: distance.trim() === "" ? null : Number(distance),
        calories_kcal: calories.trim() === "" ? null : Number(calories),
      },
    },
    weights,
  )
  const weeklyValues = {
    weekly_calories_kcal: weeklyCalories,
    weekly_steps: weeklySteps,
    weekly_distance_km: weeklyDistance,
  }
  let weeklyPreview: Record<string, number | null> | null = null
  let weeklyPreviewError = ""
  if (entryType === "weekly" && weeklyInputMode === "daily_average") {
    try {
      weeklyPreview = weeklyActivityTotals(weeklyValues, weeklyInputMode)
    } catch (reason) {
      weeklyPreviewError = reason instanceof Error ? reason.message : "No se pudieron calcular los totales semanales."
    }
  }

  function changeWeeklyInputMode(mode: "daily_average" | "weekly_total") {
    if (mode === weeklyInputMode) return
    const convert = (raw: string) => (raw.trim() === "" ? "" : String(Number(raw) / 7))
    if (mode === "daily_average") {
      setWeeklyCalories(convert(weeklyCalories))
      setWeeklySteps(convert(weeklySteps))
      setWeeklyDistance(convert(weeklyDistance))
    } else {
      try {
        const totals = weeklyActivityTotals(weeklyValues, weeklyInputMode)
        setWeeklyCalories(String(totals.weekly_calories_kcal ?? ""))
        setWeeklySteps(String(totals.weekly_steps ?? ""))
        setWeeklyDistance(String(totals.weekly_distance_km ?? ""))
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "No se pudieron calcular los totales semanales.")
        return
      }
    }
    setWeeklyInputMode(mode)
    setError("")
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (tracking) return
    const measurements =
      entryType === "weekly" ? [weeklyCalories, weeklySteps, weeklyDistance] : [duration, distance, calories, steps]
    if (!measurements.some((value) => value.trim() !== "")) {
      setError(
        entryType === "weekly"
          ? "Ingresa al menos una medida semanal."
          : "Ingresa al menos una medida de esta actividad.",
      )
      return
    }
    if (entryType === "single" && activityType === "Otro" && !otherActivity.trim()) {
      setError("Describe la actividad seleccionada como Otro.")
      return
    }

    const numberOrNull = (value: string) => (value.trim() === "" ? null : Number(value))
    let weeklyTotals: Record<string, number | null> = {}
    if (entryType === "weekly") {
      try {
        weeklyTotals = weeklyActivityTotals(weeklyValues, weeklyInputMode)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "No se pudieron calcular los totales semanales.")
        return
      }
    }
    const data =
      entryType === "weekly"
        ? {
            entry_type: "weekly",
            week_end: weekEnd,
            ...weeklyTotals,
          }
        : {
            entry_type: "single",
            activity_type: activityType,
            other_activity: activityType === "Otro" ? otherActivity.trim() : null,
            duration_min: numberOrNull(duration),
            distance_km: numberOrNull(distance),
            calories_kcal: numberOrNull(calories),
            steps: numberOrNull(steps),
            intensity: intensity || null,
            ...(trackingSource === "gps"
              ? {
                  tracking_source: "gps",
                  moving_duration_min: recorded
                    ? recorded.movingDurationMin
                    : entry?.data.moving_duration_min ?? null,
                  elevation_gain_m: recorded ? recorded.ascentM : entry?.data.elevation_gain_m ?? null,
                  elevation_loss_m: recorded ? recorded.descentM : entry?.data.elevation_loss_m ?? null,
                  route: recorded ? normalizeActivityRoute(recorded.route)
                    : Array.isArray(entry?.data.route) ? normalizeActivityRoute(entry.data.route as ActivityRoutePoint[]) : null,
                }
              : {}),
          }

    setBusy(true)
    setError("")
    try {
      const today = dateTimeInputValue(new Date().toISOString(), timezone)
      await onSave({
        module: "activity",
        title:
          entryType === "weekly" ? "Resumen semanal" : activityType === "Otro" ? otherActivity.trim() : activityType,
        occurred_at: localDateTimeToIso(
          entryType === "weekly" ? (weekEnd === today.split("T")[0] ? today : `${weekEnd}T23:59`) : occurredAt,
          timezone,
        ),
        notes: notes || null,
        data,
      })
      if (!entry && draftKey && recorded) {
        try {
          window.localStorage.removeItem(draftKey)
        } catch (reason) {
          window.alert(`Actividad guardada en el servidor, pero no se pudo eliminar el borrador local. No vuelvas a guardarlo. ${reason instanceof Error ? reason.message : ""}`)
        }
      }
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar la actividad.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={entry ? "Editar actividad" : "Registrar actividad"}
      subtitle="Guarda una actividad individual o los totales de una semana."
      onClose={close}
    >
      <form className="entry-form" onSubmit={(event) => void submit(event)}>
        {!entry && (recorded || recovery.error) && <div>
          <p className="module-hint">
            {recorded ? "Recorrido finalizado pendiente de guardar. El borrador GPS se conserva hasta que el servidor confirme el guardado." : recovery.error}
          </p>
          <button type="button" className="cancel-button" onClick={() => {
            if (!window.confirm("¿Eliminar el borrador GPS de este dispositivo?")) return
            try {
              if (draftKey) window.localStorage.removeItem(draftKey)
              setRecorded(null)
              setRecovery({ draft: null, error: "" })
              setError("")
            } catch (reason) {
              setError(`No se pudo eliminar el borrador GPS. ${reason instanceof Error ? reason.message : ""}`)
            }
          }}>Descartar borrador GPS</button>
        </div>}
        <div className="range-select" role="group" aria-label="Tipo de registro">
          <button
            type="button"
            disabled={tracking || Boolean(recorded)}
            className={entryType === "single" ? "selected" : ""}
            aria-pressed={entryType === "single"}
            onClick={() => setEntryType("single")}
          >
            Actividad individual
          </button>
          <button
            type="button"
            disabled={tracking || Boolean(recorded)}
            className={entryType === "weekly" ? "selected" : ""}
            aria-pressed={entryType === "weekly"}
            onClick={() => setEntryType("weekly")}
          >
            Estadísticas semanales
          </button>
        </div>

        {entryType === "single" ? (
          <>
            <label>
              Actividad
              <select
                disabled={tracking || Boolean(recorded)}
                value={activityType}
                onChange={(event) => setActivityType(event.target.value as ActivityType)}
              >
                {activityTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            {!entry && !recorded && ["Caminata", "Correr", "Bicicleta"].includes(activityType) && (
              <ActivityRecorder
                activityType={activityType}
                intensity={intensity}
                weights={weights}
                storageKey={draftKey}
                initialDraft={recovery.draft}
                onActiveChange={setTracking}
                onFinish={finishRecording}
              />
            )}
            {trackingSource === "gps" && (
              <p className="module-hint">
                Origen: GPS. {activityType === "Bicicleta"
                  ? "La estimación usa velocidad y ascenso con una eficiencia mecánica supuesta del 23%; no contempla viento, terreno ni asistencia eléctrica."
                  : "La estimación usa duración en movimiento, peso e intensidad; no es una medición directa del gasto energético."}
                {(recorded?.movingDurationMin ?? entry?.data.moving_duration_min) != null &&
                  ` Tiempo en movimiento: ${formatDecimal(Number(recorded?.movingDurationMin ?? entry?.data.moving_duration_min))} min; las pausas se estiman a 1 MET.`}
                {(recorded?.ascentM ?? entry?.data.elevation_gain_m) != null &&
                  ` Ascenso: ${formatDecimal(Number(recorded?.ascentM ?? entry?.data.elevation_gain_m))} m.`}
                {(recorded?.descentM ?? entry?.data.elevation_loss_m) != null &&
                  ` Descenso: ${formatDecimal(Number(recorded?.descentM ?? entry?.data.elevation_loss_m))} m.`}
              </p>
            )}
            {(() => {
              const route = recorded?.route ??
                (Array.isArray(entry?.data.route) ? (entry.data.route as ActivityRoutePoint[]) : [])
              return route.length > 1 ? (
                <Suspense fallback={<div className="activity-route-loading" role="status">Cargando mapa…</div>}>
                  <ActivityRouteMap points={route} />
                </Suspense>
              ) : null
            })()}
            {activityType === "Otro" && (
              <label>
                ¿Qué actividad?
                <input
                  maxLength={120}
                  required
                  value={otherActivity}
                  onChange={(event) => setOtherActivity(event.target.value)}
                />
              </label>
            )}
            <label>
              Fecha y hora
              <input
                required
                type="datetime-local"
                disabled={tracking}
                value={occurredAt}
                onChange={(event) => setOccurredAt(event.target.value)}
              />
            </label>
            <div className="form-two-columns">
              <label>
                Duración (min)
                <input
                  type="number"
                  min="0"
                  max="1440"
                  step="0.01"
                  disabled={tracking}
                  value={duration}
                  onChange={(event) => setDuration(event.target.value)}
                />
              </label>
              <label>
                Distancia (km)
                <input
                  type="number"
                  min="0"
                  max="1000"
                  step="0.01"
                  disabled={tracking}
                  value={distance}
                  onChange={(event) => setDistance(event.target.value)}
                />
              </label>
              <label>
                Calorías (kcal)
                <input
                  type="number"
                  min="0"
                  max="100000"
                  step="0.01"
                  value={calories}
                  onChange={(event) => setCalories(event.target.value)}
                />
              </label>
              <label>
                Pasos
                <input
                  type="number"
                  min="0"
                  max="2000000"
                  step="1"
                  value={steps}
                  onChange={(event) => setSteps(event.target.value)}
                />
              </label>
              {activityType !== "Bicicleta" && (
                <label>
                  Intensidad
                  <select disabled={tracking} value={intensity} onChange={(event) => setIntensity(event.target.value)}>
                    <option value="">Sin especificar</option>
                    <option>Suave</option>
                    <option>Moderada</option>
                    <option>Intensa</option>
                  </select>
                </label>
              )}
            </div>
            <p className="module-hint">
              {calculated.estimatedCalories !== null && calculated.weightKg !== null
                ? `Calorías estimadas: ${formatDecimal(calculated.estimatedCalories)} kcal (MET ${calculated.met}, peso ${formatDecimal(calculated.weightKg)} kg). `
                : "Si dejas calorías vacías, se estiman con duración, peso anterior y tipo e intensidad compatibles (o velocidad media en bicicleta GPS). "}
              Gasto total aproximado, incluido el reposo; los valores ingresados tienen prioridad.
              {calculated.speedKmh !== null && ` Velocidad media: ${formatDecimal(calculated.speedKmh)} km/h.`}
              {calculated.paceMinKm !== null &&
                ` Ritmo medio: ${formatDecimal(calculated.paceMinKm)} min/km (minutos decimales).`}
            </p>
            {calculationError && (
              <p className="error-banner" role="alert">
                {calculationError}
              </p>
            )}
          </>
        ) : (
          <>
            <label>
              Semana terminada el
              <input
                required
                type="date"
                max={dateTimeInputValue(new Date().toISOString(), timezone).split("T")[0]}
                value={weekEnd}
                onChange={(event) => setWeekEnd(event.target.value)}
              />
            </label>
            <div className="range-select" role="group" aria-label="Valores semanales">
              <button
                type="button"
                className={weeklyInputMode === "daily_average" ? "selected" : ""}
                aria-pressed={weeklyInputMode === "daily_average"}
                onClick={() => changeWeeklyInputMode("daily_average")}
              >
                Promedio diario
              </button>
              <button
                type="button"
                className={weeklyInputMode === "weekly_total" ? "selected" : ""}
                aria-pressed={weeklyInputMode === "weekly_total"}
                onClick={() => changeWeeklyInputMode("weekly_total")}
              >
                Total semanal
              </button>
            </div>
            <p className="module-hint">
              {weeklyInputMode === "daily_average"
                ? "Ingresa el promedio de cada día. Se multiplica por 7 para guardar el total semanal; los pasos se redondean al entero más cercano."
                : "Ingresa los totales de los siete días que terminan en la fecha seleccionada."}
            </p>
            <div className="form-two-columns">
              <label>
                {weeklyInputMode === "daily_average" ? "Calorías diarias (kcal)" : "Calorías semanales (kcal)"}
                <input
                  type="number"
                  min="0"
                  max={weeklyInputMode === "daily_average" ? 200000 / 7 : 200000}
                  step="any"
                  value={weeklyCalories}
                  onChange={(event) => setWeeklyCalories(event.target.value)}
                />
              </label>
              <label>
                {weeklyInputMode === "daily_average" ? "Pasos diarios" : "Pasos semanales"}
                <input
                  type="number"
                  min="0"
                  max={weeklyInputMode === "daily_average" ? 2000000 / 7 : 2000000}
                  step={weeklyInputMode === "daily_average" ? "any" : "1"}
                  value={weeklySteps}
                  onChange={(event) => setWeeklySteps(event.target.value)}
                />
              </label>
              <label>
                {weeklyInputMode === "daily_average" ? "Distancia diaria (km)" : "Distancia semanal (km)"}
                <input
                  type="number"
                  min="0"
                  max={weeklyInputMode === "daily_average" ? 10000 / 7 : 10000}
                  step="any"
                  value={weeklyDistance}
                  onChange={(event) => setWeeklyDistance(event.target.value)}
                />
              </label>
            </div>
            {weeklyPreview && (
              <p className="module-hint activity-weekly-preview">
                Totales de 7 días:{" "}
                {weeklyPreview.weekly_steps != null
                  ? `${formatDecimal(weeklyPreview.weekly_steps)} pasos`
                  : "pasos sin datos"}
                {" · "}
                {weeklyPreview.weekly_calories_kcal != null
                  ? `${formatDecimal(weeklyPreview.weekly_calories_kcal)} kcal`
                  : "calorías sin datos"}
                {" · "}
                {weeklyPreview.weekly_distance_km != null
                  ? `${formatDecimal(weeklyPreview.weekly_distance_km)} km`
                  : "distancia sin datos"}
              </p>
            )}
            {weeklyPreviewError && (
              <p className="error-banner" role="alert">
                {weeklyPreviewError}
              </p>
            )}
          </>
        )}
        <label>
          Notas <span className="optional">opcional</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <p className="module-hint">
          Completa solo las medidas disponibles; solo las calorías pueden estimarse si hay datos suficientes. Los
          resúmenes semanales se suman a los registros individuales, incluso si cubren el mismo período.
        </p>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="cancel-button" onClick={close}>
            Cancelar
          </button>
          <button className="primary-button" disabled={busy || tracking}>
            {busy ? "Guardando…" : entry ? "Guardar cambios" : "Guardar registro"}
          </button>
        </div>
      </form>
    </Modal>
  )
}
