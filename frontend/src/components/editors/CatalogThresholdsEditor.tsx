import { useState, type FormEvent } from "react"
import type { CatalogItem } from "../../api"
import { Modal } from "../modals/Modal"

export function CatalogThresholdsEditor({
  item,
  onClose,
  onSave,
}: {
  item: CatalogItem
  onClose: () => void
  onSave: (
    normalMin: number | null,
    normalMax: number | null,
    diastolicMin: number | null,
    diastolicMax: number | null,
  ) => Promise<void>
}) {
  const [normalMin, setNormalMin] = useState(item.normal_min != null ? String(item.normal_min) : "")
  const [normalMax, setNormalMax] = useState(item.normal_max != null ? String(item.normal_max) : "")
  const [diastolicMin, setDiastolicMin] = useState(
    item.diastolic_normal_min != null ? String(item.diastolic_normal_min) : "",
  )
  const [diastolicMax, setDiastolicMax] = useState(
    item.diastolic_normal_max != null ? String(item.diastolic_normal_max) : "",
  )
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const min = normalMin.trim() === "" ? null : Number(normalMin)
    const max = normalMax.trim() === "" ? null : Number(normalMax)
    const dMin = item.is_blood_pressure && diastolicMin.trim() !== "" ? Number(diastolicMin) : null
    const dMax = item.is_blood_pressure && diastolicMax.trim() !== "" ? Number(diastolicMax) : null
    if (min != null && max != null && min > max) {
      setError(
        item.is_blood_pressure
          ? "El mínimo sistólico debe ser menor o igual al máximo."
          : "El mínimo normal debe ser menor o igual al máximo.",
      )
      return
    }
    if (dMin != null && dMax != null && dMin > dMax) {
      setError("El mínimo diastólico debe ser menor o igual al máximo.")
      return
    }
    setBusy(true)
    setError("")
    try {
      await onSave(min, max, dMin, dMax)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar el rango normal.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Rango normal · ${item.name}`}
      subtitle="Se aplica a los próximos registros y a la gráfica de evolución."
      onClose={onClose}
    >
      <form className="entry-form" onSubmit={submit}>
        <div className="form-two-columns">
          <label>
            {item.is_blood_pressure ? "Sistólica normal desde" : "Normal desde"}{" "}
            <span className="optional">opcional</span>
            <input type="number" step="0.01" value={normalMin} onChange={(event) => setNormalMin(event.target.value)} />
          </label>
          <label>
            {item.is_blood_pressure ? "Sistólica normal hasta" : "Normal hasta"}{" "}
            <span className="optional">opcional</span>
            <input type="number" step="0.01" value={normalMax} onChange={(event) => setNormalMax(event.target.value)} />
          </label>
        </div>
        {item.is_blood_pressure && (
          <div className="form-two-columns">
            <label>
              Diastólica normal desde <span className="optional">opcional</span>
              <input
                type="number"
                step="0.01"
                value={diastolicMin}
                onChange={(event) => setDiastolicMin(event.target.value)}
              />
            </label>
            <label>
              Diastólica normal hasta <span className="optional">opcional</span>
              <input
                type="number"
                step="0.01"
                value={diastolicMax}
                onChange={(event) => setDiastolicMax(event.target.value)}
              />
            </label>
          </div>
        )}
        <p className="module-hint">
          Define solo el valor "hasta" para un máximo, solo "desde" para un mínimo, o ambos para un rango. Déjalos
          vacíos para quitar el umbral.
        </p>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-actions">
          <button type="button" className="cancel-button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Guardando…" : "Guardar rango"}
          </button>
        </div>
      </form>
    </Modal>
  )
}
