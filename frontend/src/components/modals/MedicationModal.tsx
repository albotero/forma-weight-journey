import { useState, type FormEvent } from "react"
import type { Medication } from "../../api"
import { Modal } from "./Modal"

export function MedicationModal({
  onClose,
  medication,
  onSubmit,
}: {
  onClose: () => void
  medication: Medication
  onSubmit: (
    medication: Medication,
    name: string,
    route: Medication["route"],
    concentrationMg: number | null,
    volumeMl: number | null,
    unitsPerMl: number | null,
    dosingInterval: Medication["dosing_interval"],
  ) => Promise<void>
}) {
  const [name, setName] = useState(medication.name)
  const [route, setRoute] = useState<Medication["route"]>(medication.route)
  const [concentrationMg, setConcentrationMg] = useState(String(medication.concentration_mg ?? ""))
  const [volumeMl, setVolumeMl] = useState(String(medication.concentration_volume_ml ?? ""))
  const [unitsPerMl, setUnitsPerMl] = useState(medication.units_per_ml === null ? "" : String(medication.units_per_ml))
  const [dosingInterval, setDosingInterval] = useState(medication.dosing_interval ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      await onSubmit(
        medication,
        name,
        route,
        route === "injectable" ? Number(concentrationMg) : null,
        route === "injectable" ? Number(volumeMl) : null,
        route === "injectable" && unitsPerMl.trim() ? Number(unitsPerMl) : null,
        dosingInterval ? (dosingInterval as Medication["dosing_interval"]) : null,
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar la concentración")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Editar medicación" subtitle="Elige la vía y registra los datos aplicables." onClose={onClose}>
      <form className="entry-form" onSubmit={submit}>
        <label>
          Medicamento
          <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Vía de administración
          <select value={route} onChange={(event) => setRoute(event.target.value as Medication["route"])}>
            <option value="injectable">Inyectable</option>
            <option value="oral">Oral</option>
          </select>
        </label>
        {route === "injectable" && (
          <>
            <div className="config-fields">
              <label>
                Concentración
                <div className="input-with-unit">
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={concentrationMg}
                    onChange={(event) => setConcentrationMg(event.target.value)}
                  />
                  <span>mg</span>
                </div>
              </label>
              <label>
                Volumen
                <div className="input-with-unit">
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={volumeMl}
                    onChange={(event) => setVolumeMl(event.target.value)}
                  />
                  <span>mL</span>
                </div>
              </label>
            </div>
            <label>
              Unidades por mL <span className="optional">opcional · 100 para U-100</span>
              <div className="input-with-unit">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={unitsPerMl}
                  onChange={(event) => setUnitsPerMl(event.target.value)}
                  placeholder="Dejar vacío para desactivar"
                />
                <span>U/mL</span>
              </div>
            </label>
            <p className="medical-note">
              Verifica la concentración en el envase. Las conversiones son informativas y no recomiendan una dosis.
            </p>
          </>
        )}
        <label>
          Frecuencia <span className="optional">opcional</span>
          <select value={dosingInterval} onChange={(event) => setDosingInterval(event.target.value)}>
            <option value="">Sin configurar</option>
            <option value="daily">Diaria</option>
            <option value="weekly">Semanal</option>
          </select>
        </label>
        {route === "oral" && <p className="medical-note">Las dosis orales se registran con la unidad que indiques.</p>}
        {error && <div className="error-banner">{error}</div>}
        <div className="form-actions">
          <button type="button" className="cancel-button" onClick={onClose}>
            Cancelar
          </button>
          <button disabled={busy} className="primary-button">
            {busy ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </form>
    </Modal>
  )
}
