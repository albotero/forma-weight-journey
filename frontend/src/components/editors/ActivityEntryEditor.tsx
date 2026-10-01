import { useState, type FormEvent } from "react"
import type { JournalEntry } from "../../api"
import { dateTimeInputValue, localDateTimeToIso } from "../../dateTime.js"
import { activityTypes, type ActivityType } from "../../lib/types"
import { Modal } from "../modals/Modal"

export function ActivityEntryEditor({
  entry,
  timezone,
  onClose,
  onSave,
}: {
  entry?: JournalEntry
  timezone: string
  onClose: () => void
  onSave: (payload: Omit<JournalEntry, "id" | "created_at" | "updated_at">) => Promise<void>
}) {
  const isLegacyEntry = Boolean(entry && !("entry_type" in entry.data))
  const [entryType, setEntryType] = useState<"single" | "weekly">(() =>
    entry?.data.entry_type === "weekly" ? "weekly" : "single",
  )
  const [activityType, setActivityType] = useState<ActivityType>(() => {
    const savedType = entry?.data.activity_type
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
    dateTimeInputValue(entry?.occurred_at ?? new Date().toISOString(), timezone),
  )
  const [weekEnd, setWeekEnd] = useState(() => {
    if (entry?.data.entry_type !== "weekly" || entry.data.week_end != null) return occurredAt.split("T")[0]
    const legacyEnd = new Date(`${occurredAt.split("T")[0]}T12:00:00Z`)
    legacyEnd.setUTCDate(legacyEnd.getUTCDate() + 6)
    const today = dateTimeInputValue(new Date().toISOString(), timezone).split("T")[0]
    return legacyEnd.toISOString().split("T")[0] > today ? today : legacyEnd.toISOString().split("T")[0]
  })
  const [duration, setDuration] = useState(() => String(entry?.data.duration_min ?? ""))
  const [distance, setDistance] = useState(() => String(entry?.data.distance_km ?? ""))
  const [calories, setCalories] = useState(() => String(entry?.data.calories_kcal ?? ""))
  const [intensity, setIntensity] = useState(() => String(entry?.data.intensity ?? ""))
  const [weeklyCalories, setWeeklyCalories] = useState(() => String(entry?.data.weekly_calories_kcal ?? ""))
  const [weeklySteps, setWeeklySteps] = useState(() => String(entry?.data.weekly_steps ?? ""))
  const [weeklyDistance, setWeeklyDistance] = useState(() => String(entry?.data.weekly_distance_km ?? ""))
  const [notes, setNotes] = useState(entry?.notes ?? "")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const measurements =
      entryType === "weekly" ? [weeklyCalories, weeklySteps, weeklyDistance] : [duration, distance, calories]
    if (!measurements.some((value) => value.trim() !== "")) {
      setError(
        entryType === "weekly"
          ? "Ingresa al menos un total semanal."
          : "Ingresa al menos una medida de esta actividad.",
      )
      return
    }
    if (entryType === "single" && activityType === "Otro" && !otherActivity.trim()) {
      setError("Describe la actividad seleccionada como Otro.")
      return
    }

    const numberOrNull = (value: string) => (value.trim() === "" ? null : Number(value))
    const data =
      entryType === "weekly"
        ? {
            entry_type: "weekly",
            week_end: weekEnd,
            weekly_calories_kcal: numberOrNull(weeklyCalories),
            weekly_steps: numberOrNull(weeklySteps),
            weekly_distance_km: numberOrNull(weeklyDistance),
          }
        : {
            entry_type: "single",
            activity_type: activityType,
            other_activity: activityType === "Otro" ? otherActivity.trim() : null,
            duration_min: numberOrNull(duration),
            distance_km: numberOrNull(distance),
            calories_kcal: numberOrNull(calories),
            intensity: intensity || null,
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
      onClose={onClose}
    >
      <form className="entry-form" onSubmit={(event) => void submit(event)}>
        <div className="range-select" role="group" aria-label="Tipo de registro">
          <button
            type="button"
            className={entryType === "single" ? "selected" : ""}
            onClick={() => setEntryType("single")}
          >
            Actividad individual
          </button>
          <button
            type="button"
            className={entryType === "weekly" ? "selected" : ""}
            onClick={() => setEntryType("weekly")}
          >
            Estadísticas semanales
          </button>
        </div>

        {entryType === "single" ? (
          <>
            <label>
              Actividad
              <select value={activityType} onChange={(event) => setActivityType(event.target.value as ActivityType)}>
                {activityTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
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
                  step="1"
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
                Intensidad
                <select value={intensity} onChange={(event) => setIntensity(event.target.value)}>
                  <option value="">Sin especificar</option>
                  <option>Suave</option>
                  <option>Moderada</option>
                  <option>Intensa</option>
                </select>
              </label>
            </div>
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
            <div className="form-two-columns">
              <label>
                Calorías (kcal)
                <input
                  type="number"
                  min="0"
                  max="200000"
                  step="0.01"
                  value={weeklyCalories}
                  onChange={(event) => setWeeklyCalories(event.target.value)}
                />
              </label>
              <label>
                Pasos
                <input
                  type="number"
                  min="0"
                  max="2000000"
                  step="1"
                  value={weeklySteps}
                  onChange={(event) => setWeeklySteps(event.target.value)}
                />
              </label>
              <label>
                Distancia (km)
                <input
                  type="number"
                  min="0"
                  max="10000"
                  step="0.01"
                  value={weeklyDistance}
                  onChange={(event) => setWeeklyDistance(event.target.value)}
                />
              </label>
            </div>
          </>
        )}
        <label>
          Notas <span className="optional">opcional</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="cancel-button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Guardando…" : entry ? "Guardar cambios" : "Guardar registro"}
          </button>
        </div>
      </form>
    </Modal>
  )
}
