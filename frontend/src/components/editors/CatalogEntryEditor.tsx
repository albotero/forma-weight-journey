import { useState, type FormEvent } from "react"
import { Plus } from "lucide-react"
import type { CatalogCategory, CatalogItem, CatalogResult, JournalEntry, JournalModule } from "../../api"
import { dateTimeInputValue, localDateTimeToIso } from "../../dateTime.js"
import { isNumericString } from "../../lib/format"
import { Modal } from "../modals/Modal"

export function CatalogEntryEditor({
  category,
  catalog,
  entry,
  timezone,
  onClose,
  onSave,
  onAddCatalogItem,
}: {
  category: CatalogCategory
  catalog: CatalogItem[]
  entry?: JournalEntry
  timezone: string
  onClose: () => void
  onSave: (payload: Omit<JournalEntry, "id" | "created_at" | "updated_at">) => Promise<void>
  onAddCatalogItem: (
    name: string,
    unit: string,
    symptomCategory?: "Gastrointestinal" | "Otro",
    thresholds?: { normal_min: number | null; normal_max: number | null },
  ) => Promise<void>
}) {
  const existingResults = Array.isArray(entry?.data.results) ? (entry!.data.results as CatalogResult[]) : []
  const [occurredAt, setOccurredAt] = useState(() =>
    dateTimeInputValue(entry?.occurred_at ?? new Date().toISOString(), timezone),
  )
  const [notes, setNotes] = useState(entry?.notes ?? "")
  const [tolerance, setTolerance] = useState(String(entry?.data.tolerance ?? ""))
  const [phase, setPhase] = useState(String(entry?.data.phase ?? ""))
  const [laboratory, setLaboratory] = useState(String(entry?.data.laboratory ?? ""))
  const [selections, setSelections] = useState<
    Record<number, { checked: boolean; value: string; systolic: string; diastolic: string }>
  >(() =>
    Object.fromEntries(
      catalog.map((item) => {
        const existing = existingResults.find((result) => result.catalog_item_id === item.id)
        return [
          item.id,
          {
            checked: Boolean(existing),
            value:
              existing?.value != null
                ? String(existing.value)
                : existing?.text_value != null
                  ? existing.text_value
                  : existing?.severity != null
                    ? String(existing.severity)
                    : existing?.intensity != null
                      ? String(existing.intensity)
                      : "",
            systolic: existing?.systolic != null ? String(existing.systolic) : "",
            diastolic: existing?.diastolic != null ? String(existing.diastolic) : "",
          },
        ]
      }),
    ),
  )
  const [newItemName, setNewItemName] = useState("")
  const [newItemUnit, setNewItemUnit] = useState("")
  const [newItemNormalMin, setNewItemNormalMin] = useState("")
  const [newItemNormalMax, setNewItemNormalMax] = useState("")
  const [newItemSymptomCategory, setNewItemSymptomCategory] = useState<"Gastrointestinal" | "Otro">("Otro")
  const [addingItem, setAddingItem] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  function toggle(itemId: number) {
    setSelections((current) => ({
      ...current,
      [itemId]: { ...current[itemId], checked: !current[itemId]?.checked },
    }))
  }
  function updateField(itemId: number, field: "value" | "systolic" | "diastolic", value: string) {
    setSelections((current) => ({
      ...current,
      [itemId]: {
        ...(current[itemId] ?? { checked: true, value: "", systolic: "", diastolic: "" }),
        [field]: value,
      },
    }))
  }

  async function submitNewItem() {
    if (!newItemName.trim()) return
    setBusy(true)
    setError("")
    try {
      await onAddCatalogItem(
        newItemName.trim(),
        newItemUnit.trim(),
        category === "symptom" ? newItemSymptomCategory : undefined,
        category === "lab"
          ? {
              normal_min: newItemNormalMin.trim() === "" ? null : Number(newItemNormalMin),
              normal_max: newItemNormalMax.trim() === "" ? null : Number(newItemNormalMax),
            }
          : undefined,
      )
      setNewItemName("")
      setNewItemUnit("")
      setNewItemNormalMin("")
      setNewItemNormalMax("")
      setAddingItem(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo añadir el elemento")
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    const results: CatalogResult[] = []
    for (const item of catalog) {
      const selection = selections[item.id]
      if (!selection?.checked) continue
      if (item.is_blood_pressure) {
        if (!selection.systolic || !selection.diastolic) continue
        const systolic = Number(selection.systolic)
        const diastolic = Number(selection.diastolic)
        results.push({
          catalog_item_id: item.id,
          name: item.name,
          unit: item.unit,
          value: null,
          text_value: null,
          severity: null,
          intensity: null,
          systolic,
          diastolic,
          mean: Math.round(((systolic + diastolic) / 2) * 100) / 100,
          category: null,
        })
      } else {
        const raw = selection.value.trim()
        if (raw === "") continue
        const labIsNumeric = category === "lab" && isNumericString(raw)
        const numeric = category === "lab" ? (labIsNumeric ? Number(raw) : null) : Number(raw)
        results.push({
          catalog_item_id: item.id,
          name: item.name,
          unit: item.unit,
          value: category === "lab" ? numeric : null,
          text_value: category === "lab" && !labIsNumeric ? raw : null,
          severity: category === "symptom" ? numeric : null,
          intensity: category === "goal" ? numeric : null,
          systolic: null,
          diastolic: null,
          mean: null,
          category: item.symptom_category ?? null,
        })
      }
    }
    if (!results.length) {
      setError("Selecciona al menos un elemento e indica su valor")
      setBusy(false)
      return
    }
    const module: JournalModule = category === "symptom" ? "symptoms" : category === "goal" ? "goals" : "labs"
    const title =
      category === "lab"
        ? laboratory.trim() || "Resultados de laboratorio"
        : category === "goal"
          ? "Registro de objetivos"
          : results.map((result) => result.name).join(", ")
    const data: Record<string, unknown> = { results }
    if (category === "symptom" && tolerance) data.tolerance = tolerance
    if (category === "lab") {
      if (phase) data.phase = phase
      if (laboratory) data.laboratory = laboratory
    }
    try {
      await onSave({
        module,
        title,
        occurred_at: localDateTimeToIso(occurredAt, timezone),
        notes: notes || null,
        data,
      })
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar")
    } finally {
      setBusy(false)
    }
  }

  const intensityLabel = category === "symptom" ? "Intensidad (0–10)" : "Progreso (0–10)"

  return (
    <Modal
      title={`${entry ? "Editar" : "Registrar"} ${
        category === "symptom" ? "síntomas" : category === "goal" ? "objetivos" : "resultados de laboratorio"
      }`}
      subtitle="Selecciona los elementos de tu lista que correspondan y define su valor."
      onClose={onClose}
      size="wide"
    >
      <form className="entry-form" onSubmit={submit}>
        <label>
          Fecha y hora
          <input
            required
            type="datetime-local"
            value={occurredAt}
            onChange={(event) => setOccurredAt(event.target.value)}
          />
        </label>
        {category === "lab" && (
          <>
            <div className="form-two-columns">
              <label>
                Contexto
                <select value={phase} onChange={(event) => setPhase(event.target.value)}>
                  <option value="">Seleccionar…</option>
                  <option>Basal</option>
                  <option>Seguimiento</option>
                </select>
              </label>
              <label>
                Laboratorio <span className="optional">opcional</span>
                <input value={laboratory} onChange={(event) => setLaboratory(event.target.value)} />
              </label>
            </div>
            <p className="module-hint">
              El valor puede ser numérico o texto (por ejemplo, "Negativo"). Solo los valores numéricos se grafican.
            </p>
          </>
        )}
        {category === "symptom" && (
          <label>
            Tolerancia percibida <span className="optional">opcional</span>
            <select value={tolerance} onChange={(event) => setTolerance(event.target.value)}>
              <option value="">Seleccionar…</option>
              <option>Buena</option>
              <option>Con molestias leves</option>
              <option>Con molestias moderadas</option>
              <option>Con molestias importantes</option>
            </select>
          </label>
        )}
        <div className="catalog-selection-list">
          {catalog.map((item) => {
            const selection = selections[item.id] ?? { checked: false, value: "", systolic: "", diastolic: "" }
            return (
              <div className="catalog-selection-row" key={item.id}>
                <label className={`catalog-selection-checkbox${selection.checked ? " selected" : ""}`}>
                  <input type="checkbox" checked={selection.checked} onChange={() => toggle(item.id)} />
                  {item.name}
                  {item.unit ? ` (${item.unit})` : ""}
                </label>
                {selection.checked &&
                  (item.is_blood_pressure ? (
                    <div className="catalog-selection-values">
                      <input
                        type="number"
                        step="1"
                        min="0"
                        placeholder="Sistólica"
                        value={selection.systolic}
                        onChange={(event) => updateField(item.id, "systolic", event.target.value)}
                      />
                      <input
                        type="number"
                        step="1"
                        min="0"
                        placeholder="Diastólica"
                        value={selection.diastolic}
                        onChange={(event) => updateField(item.id, "diastolic", event.target.value)}
                      />
                    </div>
                  ) : (
                    <input
                      className="catalog-selection-values"
                      type={category === "lab" ? "text" : "number"}
                      step={category === "lab" ? undefined : "1"}
                      min={category === "lab" ? undefined : "0"}
                      max={category === "lab" ? undefined : "10"}
                      placeholder={category === "lab" ? "Valor numérico o texto" : intensityLabel}
                      value={selection.value}
                      onChange={(event) => updateField(item.id, "value", event.target.value)}
                    />
                  ))}
              </div>
            )
          })}
          {!catalog.length && (
            <p className="module-hint">Aún no tienes elementos en tu lista. Añade el primero abajo.</p>
          )}
        </div>
        {addingItem ? (
          <div className="catalog-new-item">
            <input
              placeholder="Nombre"
              maxLength={120}
              value={newItemName}
              onChange={(event) => setNewItemName(event.target.value)}
            />
            {category === "lab" && (
              <input
                placeholder="Unidad (opcional)"
                maxLength={40}
                value={newItemUnit}
                onChange={(event) => setNewItemUnit(event.target.value)}
              />
            )}
            {category === "lab" && (
              <>
                <input
                  type="number"
                  step="0.01"
                  placeholder="Normal desde (opcional)"
                  value={newItemNormalMin}
                  onChange={(event) => setNewItemNormalMin(event.target.value)}
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="Normal hasta (opcional)"
                  value={newItemNormalMax}
                  onChange={(event) => setNewItemNormalMax(event.target.value)}
                />
              </>
            )}
            {category === "symptom" && (
              <select
                value={newItemSymptomCategory}
                onChange={(event) => setNewItemSymptomCategory(event.target.value as "Gastrointestinal" | "Otro")}
              >
                <option>Otro</option>
                <option>Gastrointestinal</option>
              </select>
            )}
            <button type="button" className="small-action" disabled={busy} onClick={() => void submitNewItem()}>
              Guardar en la lista
            </button>
            <button type="button" className="small-action" onClick={() => setAddingItem(false)}>
              Cancelar
            </button>
          </div>
        ) : (
          <button type="button" className="outline-button" onClick={() => setAddingItem(true)}>
            <Plus size={14} /> Añadir elemento nuevo a la lista
          </button>
        )}
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
