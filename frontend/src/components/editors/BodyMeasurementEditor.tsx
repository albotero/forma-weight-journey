import { useState, type FormEvent } from "react"
import type { BodyMeasurementEntry } from "../../api"
import { dateTimeInputValue, localDateTimeToIso } from "../../dateTime.js"
import { bodyFields } from "../modules/bodyMeasurements"
import { Modal } from "../modals/Modal"

export function BodyMeasurementEditor({
  entry,
  timezone,
  onClose,
  onSave,
}: {
  entry?: BodyMeasurementEntry
  timezone: string
  onClose: () => void
  onSave: (payload: Record<string, unknown>) => Promise<void>
}) {
  const [date, setDate] = useState(() => dateTimeInputValue(entry?.measured_at ?? new Date().toISOString(), timezone))
  const [notes, setNotes] = useState(entry?.notes ?? "")
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(bodyFields.map(([key]) => [key, entry?.[key] == null ? "" : String(entry[key])])),
  )
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      await onSave({
        measured_at: localDateTimeToIso(date, timezone),
        notes: notes || null,
        ...Object.fromEntries(bodyFields.map(([key]) => [key, values[key] ? Number(values[key]) : null])),
      })
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={entry ? "Editar medidas" : "Registrar medidas"}
      subtitle="Incluye una o más medidas corporales."
      onClose={onClose}
      size="wide"
    >
      <form className="entry-form" onSubmit={submit}>
        <label>
          Fecha y hora
          <input required type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <div className="composition-input-grid">
          {bodyFields.map(([key, label]) => (
            <label key={key}>
              {label} (cm)
              <input
                type="number"
                min="0.1"
                max="300"
                step="0.01"
                value={values[key]}
                onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
              />
            </label>
          ))}
        </div>
        <label>
          Notas <span className="optional">opcional</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-actions">
          <button type="button" className="cancel-button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </Modal>
  )
}
