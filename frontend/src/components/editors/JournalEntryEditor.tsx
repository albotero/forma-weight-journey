import { useState, type FormEvent } from "react"
import type { JournalEntry, JournalModule } from "../../api"
import { dateTimeInputValue, localDateTimeToIso } from "../../dateTime.js"
import { journalDefinitions } from "../modules/journalDefinitions"
import { Modal } from "../modals/Modal"

export function JournalEntryEditor({
  module,
  entry,
  timezone,
  onClose,
  onSave,
}: {
  module: JournalModule
  entry?: JournalEntry
  timezone: string
  onClose: () => void
  onSave: (payload: Omit<JournalEntry, "id" | "created_at" | "updated_at">) => Promise<void>
}) {
  const [title, setTitle] = useState(entry?.title ?? (module === "symptoms" ? "Seguimiento semanal" : ""))
  const [occurredAt, setOccurredAt] = useState(() =>
    dateTimeInputValue(entry?.occurred_at ?? new Date().toISOString(), timezone),
  )
  const [notes, setNotes] = useState(entry?.notes ?? "")
  const [data, setData] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      journalDefinitions[module].fields.map(({ key }) => [
        key,
        entry?.data[key] == null
          ? ""
          : key === "reminder_at"
            ? dateTimeInputValue(String(entry.data[key]), timezone)
            : String(entry.data[key]),
      ]),
    ),
  )
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    const parsed = Object.fromEntries(
      journalDefinitions[module].fields.map(({ key, type }) => [
        key,
        data[key] === ""
          ? null
          : type === "number"
            ? Number(data[key])
            : key === "reminder_at"
              ? localDateTimeToIso(data[key], timezone)
              : data[key],
      ]),
    )
    try {
      await onSave({
        module,
        title,
        occurred_at:
          module === "reminders" && data.reminder_at
            ? localDateTimeToIso(data.reminder_at, timezone)
            : localDateTimeToIso(occurredAt, timezone),
        notes: notes || null,
        data: parsed,
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
      title={`${entry ? "Editar" : "Añadir"} ${journalDefinitions[module].title}`}
      subtitle="Se completa con la fecha y hora actuales; puedes cambiarlas."
      onClose={onClose}
    >
      <form className="entry-form" onSubmit={submit}>
        {module !== "symptoms" && (
          <label>
            {journalDefinitions[module].title}
            <input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} />
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
        {journalDefinitions[module].fields.map(({ key, label, type, options }) => (
          <label key={key}>
            {label}
            {options ? (
              <select
                value={data[key] ?? ""}
                onChange={(event) => setData((current) => ({ ...current, [key]: event.target.value }))}
              >
                <option value="">Seleccionar…</option>
                {options.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            ) : (
              <input
                type={type ?? "text"}
                min={type === "number" ? "0" : undefined}
                step={type === "number" ? "0.01" : undefined}
                value={data[key] ?? ""}
                onChange={(event) => setData((current) => ({ ...current, [key]: event.target.value }))}
              />
            )}
          </label>
        ))}
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
            {busy ? "Guardando…" : entry ? "Guardar cambios" : "Guardar registro"}
          </button>
        </div>
      </form>
    </Modal>
  )
}
