import { useState, type FormEvent } from "react"
import { api, type PhotoEntry } from "../../api"
import { dateTimeInputValue, localDateTimeToIso } from "../../dateTime.js"
import { Modal } from "../modals/Modal"

export function PhotoEditor({
  photo,
  token,
  timezone,
  onClose,
  onSave,
}: {
  photo: PhotoEntry
  token: string
  timezone: string
  onClose: () => void
  onSave: () => Promise<void>
}) {
  const [caption, setCaption] = useState(photo.caption ?? "")
  const [takenAt, setTakenAt] = useState(dateTimeInputValue(photo.taken_at, timezone))
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      await api(`/photos/${photo.id}`, token, {
        method: "PUT",
        body: JSON.stringify({ caption: caption || null, taken_at: localDateTimeToIso(takenAt, timezone) }),
      })
      await onSave()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Editar foto" subtitle="La imagen queda privada en tu cuenta." onClose={onClose}>
      <form className="entry-form" onSubmit={submit}>
        <label>
          Descripción
          <input value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={300} />
        </label>
        <label>
          Fecha y hora
          <input required type="datetime-local" value={takenAt} onChange={(event) => setTakenAt(event.target.value)} />
        </label>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-actions">
          <button type="button" className="cancel-button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </form>
    </Modal>
  )
}
