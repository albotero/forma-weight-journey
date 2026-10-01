import { useState, type FormEvent } from "react"
import type { WeightEntry } from "../../api"
import { dateTimeInputValue } from "../../dateTime.js"
import type { CompositionValues } from "../../lib/types"
import { compositionFields } from "../../lib/records"
import { Modal } from "./Modal"

export function WeightModal({
  onClose,
  onSubmit,
  entry,
  timezone,
}: {
  onClose: () => void
  onSubmit: (
    weight: number,
    notes: string,
    dateTime: string,
    composition: CompositionValues,
    id?: number,
  ) => Promise<void>
  entry?: WeightEntry
  timezone: string
}) {
  const [weight, setWeight] = useState(entry ? String(entry.weight_kg) : "")
  const [notes, setNotes] = useState(entry?.notes ?? "")
  const [dateTime, setDateTime] = useState(() =>
    dateTimeInputValue(entry?.measured_at ?? new Date().toISOString(), timezone),
  )
  const [composition, setComposition] = useState<Record<string, string>>(() =>
    Object.fromEntries(compositionFields.map(([key]) => [key, entry?.[key] == null ? "" : String(entry[key])])),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      const metrics = Object.fromEntries(
        compositionFields.map(([key]) => [key, composition[key] === "" ? null : Number(composition[key])]),
      ) as CompositionValues
      await onSubmit(Number(weight), notes, dateTime, metrics, entry?.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar el registro")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={entry ? "Editar registro de peso" : "Registrar peso"}
      subtitle="La fecha y hora se completan automáticamente; puedes cambiar todos los valores."
      onClose={onClose}
    >
      <form className="entry-form" onSubmit={submit}>
        <label>
          Peso actual{" "}
          <div className="input-with-unit">
            <input
              autoFocus
              required
              type="number"
              min="1"
              max="500"
              step="0.01"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="0.0"
            />
            <span>kg</span>
          </div>
        </label>
        <label>
          Fecha y hora
          <input
            required
            type="datetime-local"
            value={dateTime}
            onChange={(event) => setDateTime(event.target.value)}
          />
        </label>
        <details className="composition-fields">
          <summary>
            Composición corporal <span className="optional">opcional · datos de la báscula</span>
          </summary>
          <div className="composition-input-grid">
            {compositionFields.map(([key, label, unit, max, step]) => (
              <label key={key}>
                {label} <span className="optional">{unit}</span>
                <input
                  type="number"
                  min="0"
                  max={max}
                  step={step}
                  value={composition[key]}
                  onChange={(event) => setComposition((current) => ({ ...current, [key]: event.target.value }))}
                />
              </label>
            ))}
          </div>
        </details>
        <label>
          Nota <span className="optional">opcional</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Por ejemplo, por la mañana" />
        </label>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-actions">
          <button type="button" className="cancel-button" onClick={onClose}>
            Cancelar
          </button>
          <button disabled={busy} className="primary-button">
            {busy ? "Guardando…" : entry ? "Guardar cambios" : "Guardar peso"}
          </button>
        </div>
      </form>
    </Modal>
  )
}
