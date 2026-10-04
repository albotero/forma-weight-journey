import { useState, type FormEvent } from "react"
import type { DoseEntry, Medication } from "../../api"
import { dateTimeInputValue } from "../../dateTime.js"
import { Modal } from "./Modal"

export function DoseModal({
  onClose,
  medication,
  onSubmit,
  entry,
  timezone,
}: {
  onClose: () => void
  onSubmit: (
    amount: number,
    unit: DoseEntry["dose_unit"],
    site: string,
    dateTime: string,
    id?: number,
    medicationId?: number,
  ) => Promise<void>
  entry?: DoseEntry
  medication: Medication | undefined
  timezone: string
}) {
  const isOral = medication?.route === "oral"
  const [dose, setDose] = useState(entry ? String(entry.dose_amount) : "")
  const [unit, setUnit] = useState<DoseEntry["dose_unit"] | "">(entry?.dose_unit ?? (isOral ? "" : "mg"))
  const [site, setSite] = useState(entry?.injection_site ?? "")
  const [dateTime, setDateTime] = useState(() =>
    dateTimeInputValue(entry?.administered_at ?? new Date().toISOString(), timezone),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const amount = Number(dose)
  const volume =
    medication?.route === "injectable" &&
    medication.concentration_mg &&
    medication.concentration_volume_ml &&
    amount > 0
      ? amount / (medication.concentration_mg / medication.concentration_volume_ml)
      : null
  const units = volume !== null && medication?.units_per_ml ? volume * medication.units_per_ml : null
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      if (!unit) throw new Error("Selecciona la unidad de la dosis.")
      await onSubmit(amount, unit, site, dateTime, entry?.id, medication?.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar el registro")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={entry ? "Editar registro de dosis" : "Registrar dosis"}
      subtitle={
        isOral
          ? "Registra la cantidad y unidad indicadas para el medicamento."
          : "Las equivalencias se calculan desde tu concentración configurada."
      }
      onClose={onClose}
    >
      <form className="entry-form" onSubmit={submit}>
        <label>
          Cantidad registrada{" "}
          <div className="input-with-unit">
            <input
              autoFocus
              required
              type="number"
              min="0.01"
              max={isOral ? "1000000" : "1000"}
              step="0.01"
              value={dose}
              onChange={(e) => setDose(e.target.value)}
              placeholder="0.0"
            />
            {isOral ? (
              <select
                required
                aria-label="Unidad de dosis"
                value={unit}
                onChange={(event) => setUnit(event.target.value as DoseEntry["dose_unit"])}
              >
                <option value="">Unidad…</option>
                <option value="UI">UI</option>
                <option value="mcg">mcg</option>
                <option value="mg">mg</option>
                <option value="g">g</option>
                <option value="mL">mL</option>
                <option value="tableta">tableta(s)</option>
                <option value="cápsula">cápsula(s)</option>
                <option value="gota">gota(s)</option>
              </select>
            ) : (
              <span>mg</span>
            )}
          </div>
        </label>
        {volume !== null && (
          <div className="dose-calculation">
            <div>
              <span>Dose</span>
              <strong>{amount} mg</strong>
            </div>
            <div>
              <span>Volume</span>
              <strong>{volume.toFixed(3)} mL</strong>
            </div>
            {units !== null && (
              <div>
                <span>U-100 units</span>
                <strong>{units.toFixed(1)} U</strong>
              </div>
            )}
          </div>
        )}
        <label>
          Fecha y hora
          <input
            required
            type="datetime-local"
            value={dateTime}
            onChange={(event) => setDateTime(event.target.value)}
          />
        </label>
        {!isOral && (
          <>
            <label>
              Lugar de inyección <span className="optional">opcional</span>
              <select value={site} onChange={(e) => setSite(e.target.value)}>
                <option value="">Seleccionar…</option>
                <option>Abdomen</option>
                <option>Muslo izquierdo</option>
                <option>Muslo derecho</option>
                <option>Parte superior del brazo</option>
                <option>Otro</option>
              </select>
            </label>
            <p className="medical-note">
              Cálculo matemático informativo. Confirma cualquier decisión de tratamiento con tu profesional de salud.
            </p>
          </>
        )}
        {error && <div className="error-banner">{error}</div>}
        <div className="form-actions">
          <button type="button" className="cancel-button" onClick={onClose}>
            Cancelar
          </button>
          <button disabled={busy || !medication} className="primary-button">
            {busy ? "Guardando…" : entry ? "Guardar cambios" : "Guardar dosis"}
          </button>
        </div>
      </form>
    </Modal>
  )
}
