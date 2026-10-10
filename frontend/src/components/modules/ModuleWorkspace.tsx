import { useEffect, useState, type FormEvent } from "react"
import { AlertTriangle, ChevronDown, ChevronUp, GripVertical, Plus, Settings, X } from "lucide-react"
import {
  api,
  uploadPhoto,
  type BodyMeasurementEntry,
  type CatalogCategory,
  type CatalogItem,
  type CatalogResult,
  type DoseEntry,
  type JournalEntry,
  type JournalModule,
  type Medication,
  type PhotoEntry,
  type Profile,
  type TelegramConnection,
  type TelegramPairing,
  type WeightEntry,
} from "../../api"
import { dateTimeInputValue, localDateTimeToIso } from "../../dateTime.js"
import type { Section } from "../../lib/types"
import { formatDate, formatDecimal, formatDateTime, formatDoseUnit } from "../../lib/format"
import { estimatedNextDose, compositionFields, weeklyActivityChecklistDate } from "../../lib/records"
import { AnalysisWorkspace } from "../analysis/AnalysisWorkspace"
import { RecordActions, EmptyModule } from "../common/Empty"
import { journalModuleBySection, journalDefinitions, journalSectionLabels } from "./journalDefinitions"
import { bodyFields } from "./bodyMeasurements"
import { ActivityEntryEditor } from "../editors/ActivityEntryEditor"
import { JournalEntryEditor } from "../editors/JournalEntryEditor"
import { CatalogThresholdsEditor } from "../editors/CatalogThresholdsEditor"
import { CatalogEntryEditor } from "../editors/CatalogEntryEditor"
import { MetricTrendCharts } from "../charts/MetricTrendCharts"
import { LabEvolutionCharts } from "../charts/LabEvolutionCharts"
import { BodyMeasurementEditor } from "../editors/BodyMeasurementEditor"
import { PhotoCard } from "../photos/PhotoCard"
import { Modal } from "../modals/Modal"

export function ModuleWorkspace(props: {
  section: Section
  token: string
  weights: WeightEntry[]
  doses: DoseEntry[]
  measurements: BodyMeasurementEntry[]
  medications: Medication[]
  entries: JournalEntry[]
  photos: PhotoEntry[]
  profile: Profile | null
  hasGoals: boolean
  onNavigate: (target: Section) => void
  onRefresh: () => Promise<void>
  onError: (message: string) => void
  onNewWeight: () => void
  onNewDose: (medication: Medication) => void
  onEditWeight: (entry: WeightEntry) => void
  onEditDose: (entry: DoseEntry) => void
  onEditMedication: (entry: Medication) => void
  onDelete: (path: string) => Promise<void>
  autoOpenEntry: boolean
  onAutoOpenHandled: () => void
}) {
  const { section, token, weights, doses, measurements, medications, entries, photos } = props
  const userTimezone = props.profile?.timezone ?? "America/Bogota"
  const module = journalModuleBySection[section]
  const compositionWeights = [...weights]
    .sort((a, b) => b.measured_at.localeCompare(a.measured_at) || b.id - a.id)
    .filter((item) => compositionFields.some(([key]) => item[key] != null))
  const weeklyActivityEntries = entries
    .filter((entry) => entry.module === "activity" && entry.data.entry_type === "weekly")
    .sort((a, b) => weeklyActivityChecklistDate(a).localeCompare(weeklyActivityChecklistDate(b)))
  const weeklyActivityMetrics = [
    { key: "weekly_steps", label: "Pasos", unit: "pasos" },
    { key: "weekly_calories_kcal", label: "Calorías", unit: "kcal" },
    { key: "weekly_distance_km", label: "Distancia", unit: "km" },
  ] as const
  const visibleEntries = entries
    .filter((entry) => entry.module === module && (module !== "symptoms" || !Array.isArray(entry.data.results)))
    .sort((first, second) => {
      if (module !== "reminders") return 0
      const timestamp = (entry: JournalEntry) => {
        const scheduled = entry.data.reminder_at
        const value = typeof scheduled === "string" ? Date.parse(scheduled) : Number.NaN
        return Number.isFinite(value) ? value : Date.parse(entry.occurred_at)
      }
      return timestamp(first) - timestamp(second) || first.id - second.id
    })
  const orderedMedications = [...medications].sort(
    (first, second) => Number(second.is_primary) - Number(first.is_primary),
  )
  const photoGroups = Object.entries(
    photos.reduce<Record<string, PhotoEntry[]>>((groups, photo) => {
      const day = dateTimeInputValue(photo.taken_at, userTimezone).slice(0, 10)
      ;(groups[day] ??= []).push(photo)
      return groups
    }, {}),
  ).sort(([first], [second]) => second.localeCompare(first))
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null)
  const [showEntryForm, setShowEntryForm] = useState(false)
  const [editingMeasurement, setEditingMeasurement] = useState<BodyMeasurementEntry | null>(null)
  const [showMeasurementForm, setShowMeasurementForm] = useState(false)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoCaption, setPhotoCaption] = useState("")
  const [photoDate, setPhotoDate] = useState(() => dateTimeInputValue(new Date().toISOString(), userTimezone))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [showNewMedication, setShowNewMedication] = useState(false)
  const [newMedicationRoute, setNewMedicationRoute] = useState<Medication["route"]>("injectable")
  const [telegram, setTelegram] = useState<TelegramConnection | null>(null)
  const [pairingUrl, setPairingUrl] = useState("")
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [showCatalogEntryForm, setShowCatalogEntryForm] = useState(false)
  const [editingCatalogEntry, setEditingCatalogEntry] = useState<JournalEntry | null>(null)
  const [editingThresholdsItem, setEditingThresholdsItem] = useState<CatalogItem | null>(null)
  const [catalogChipsExpanded, setCatalogChipsExpanded] = useState(false)
  const [draggedCatalogId, setDraggedCatalogId] = useState<number | null>(null)
  const [dragOverCatalogId, setDragOverCatalogId] = useState<number | null>(null)
  const catalogCategory: CatalogCategory | undefined =
    section === "Síntomas"
      ? "symptom"
      : section === "Objetivos"
        ? "goal"
        : section === "Laboratorios"
          ? "lab"
          : undefined
  const catalogModule: JournalModule | undefined =
    catalogCategory === "symptom"
      ? "symptoms"
      : catalogCategory === "goal"
        ? "goals"
        : catalogCategory === "lab"
          ? "labs"
          : undefined
  const orderedCatalog =
    catalogCategory === "lab"
      ? [...catalog].sort(
          (a, b) =>
            Number(b.is_blood_pressure) - Number(a.is_blood_pressure) ||
            a.sort_order - b.sort_order ||
            a.name.localeCompare(b.name),
        )
      : catalog

  useEffect(() => {
    if (!catalogCategory) return
    let active = true
    void api<CatalogItem[]>(`/catalog/${catalogCategory}`, token)
      .then((items) => {
        if (active) setCatalog(items)
      })
      .catch((reason: Error) => props.onError(reason.message))
    return () => {
      active = false
    }
  }, [catalogCategory, token, props.onError])

  useEffect(() => {
    if (!props.autoOpenEntry) return
    if (catalogCategory) {
      setEditingCatalogEntry(null)
      setShowCatalogEntryForm(true)
    } else if (section === "Medidas") {
      setEditingMeasurement(null)
      setShowMeasurementForm(true)
    } else if (module) {
      setEditingEntry(null)
      setShowEntryForm(true)
    }
    props.onAutoOpenHandled()
  }, [props.autoOpenEntry, catalogCategory, section, module, props.onAutoOpenHandled])

  async function addCatalogItem(
    name: string,
    unit: string,
    symptomCategory?: "Gastrointestinal" | "Otro",
    thresholds?: { normal_min: number | null; normal_max: number | null },
  ) {
    if (!catalogCategory) return
    const created = await api<CatalogItem>("/catalog", token, {
      method: "POST",
      body: JSON.stringify({
        category: catalogCategory,
        name,
        unit: unit || null,
        symptom_category: symptomCategory ?? null,
        normal_min: thresholds?.normal_min ?? null,
        normal_max: thresholds?.normal_max ?? null,
      }),
    })
    setCatalog((current) => [...current, created])
    if (catalogCategory === "goal") await props.onRefresh()
  }

  async function updateCatalogThresholds(
    item: CatalogItem,
    normalMin: number | null,
    normalMax: number | null,
    diastolicMin: number | null,
    diastolicMax: number | null,
  ) {
    const updated = await api<CatalogItem>(`/catalog/${item.id}/thresholds`, token, {
      method: "PATCH",
      body: JSON.stringify({
        normal_min: normalMin,
        normal_max: normalMax,
        diastolic_normal_min: item.is_blood_pressure ? diastolicMin : null,
        diastolic_normal_max: item.is_blood_pressure ? diastolicMax : null,
      }),
    })
    setCatalog((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)))
  }

  async function persistCatalogOrder(fullOrder: CatalogItem[]) {
    if (!catalogCategory) return
    setCatalog(fullOrder.map((entry, sortOrder) => ({ ...entry, sort_order: sortOrder })))
    try {
      const updated = await api<CatalogItem[]>(`/catalog/${catalogCategory}/order`, token, {
        method: "PUT",
        body: JSON.stringify({ item_ids: fullOrder.map((entry) => entry.id) }),
      })
      setCatalog(updated)
    } catch (reason) {
      props.onError(reason instanceof Error ? reason.message : "No se pudo reordenar la lista")
    }
  }

  async function reorderCatalogItem(draggedId: number, targetId: number) {
    if (!catalogCategory || draggedId === targetId) return
    const orderable = orderedCatalog.filter((entry) => !entry.is_blood_pressure)
    const fromIndex = orderable.findIndex((entry) => entry.id === draggedId)
    const toIndex = orderable.findIndex((entry) => entry.id === targetId)
    if (fromIndex < 0 || toIndex < 0) return
    const reordered = [...orderable]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    const bloodPressureItem = orderedCatalog.find((entry) => entry.is_blood_pressure)
    await persistCatalogOrder(bloodPressureItem ? [bloodPressureItem, ...reordered] : reordered)
  }

  async function removeCatalogItem(item: CatalogItem) {
    if (!window.confirm(`¿Quitar "${item.name}" de tu lista? No afecta a los registros ya guardados.`)) return
    try {
      await api<void>(`/catalog/${item.id}`, token, { method: "DELETE" })
      setCatalog((current) => current.filter((entry) => entry.id !== item.id))
      if (catalogCategory === "goal") await props.onRefresh()
    } catch (reason) {
      props.onError(reason instanceof Error ? reason.message : "No se pudo quitar el elemento")
    }
  }

  async function saveCatalogEntry(payload: Omit<JournalEntry, "id" | "created_at" | "updated_at">) {
    await api(editingCatalogEntry ? `/entries/${editingCatalogEntry.id}` : "/entries", token, {
      method: editingCatalogEntry ? "PUT" : "POST",
      body: JSON.stringify(payload),
    })
    await props.onRefresh()
    setShowCatalogEntryForm(false)
    setEditingCatalogEntry(null)
  }

  async function toggleMedicationsReviewed(reviewed: boolean) {
    try {
      await api<Profile>("/profile/medications-review", token, {
        method: "PATCH",
        body: JSON.stringify({ reviewed }),
      })
      await props.onRefresh()
    } catch (reason) {
      props.onError(reason instanceof Error ? reason.message : "No se pudo actualizar la revisión de medicamentos")
    }
  }

  async function setPrimaryMedication(medication: Medication) {
    try {
      await api<Medication>(`/medications/${medication.id}/primary`, token, { method: "PATCH" })
      await props.onRefresh()
    } catch (reason) {
      props.onError(reason instanceof Error ? reason.message : "No se pudo cambiar el medicamento principal")
    }
  }

  useEffect(() => {
    if (section !== "Recordatorios") return
    let active = true
    void api<TelegramConnection>("/telegram/connection", token)
      .then((status) => {
        if (active) setTelegram(status)
      })
      .catch((reason: Error) => props.onError(reason.message))
    return () => {
      active = false
    }
  }, [section, token, props.onError])

  useEffect(() => {
    if (!pairingUrl || telegram?.linked) return
    const timer = window.setInterval(() => {
      void api<TelegramConnection>("/telegram/connection", token)
        .then(setTelegram)
        .catch(() => undefined)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [pairingUrl, telegram?.linked, token])

  async function linkTelegram() {
    try {
      const pairing = await api<TelegramPairing>("/telegram/connection", token, { method: "POST" })
      setPairingUrl(pairing.start_url)
    } catch (reason) {
      props.onError(reason instanceof Error ? reason.message : "No se pudo generar el enlace de Telegram")
    }
  }

  async function unlinkTelegram() {
    if (!window.confirm("¿Desvincular Telegram de esta cuenta? Dejarás de recibir avisos por ese chat.")) return
    try {
      await api<void>("/telegram/connection", token, { method: "DELETE" })
      setPairingUrl("")
      setTelegram((current) => (current ? { ...current, linked: false } : current))
    } catch (reason) {
      props.onError(reason instanceof Error ? reason.message : "No se pudo desconectar Telegram")
    }
  }

  async function saveJournal(payload: Omit<JournalEntry, "id" | "created_at" | "updated_at">) {
    await api(editingEntry ? `/entries/${editingEntry.id}` : "/entries", token, {
      method: editingEntry ? "PUT" : "POST",
      body: JSON.stringify(payload),
    })
    await props.onRefresh()
    setShowEntryForm(false)
    setEditingEntry(null)
  }
  async function setReminderEnabled(entry: JournalEntry, enabled: boolean) {
    try {
      await api<JournalEntry>(`/entries/${entry.id}/enabled`, token, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      })
      await props.onRefresh()
    } catch (reason) {
      props.onError(reason instanceof Error ? reason.message : "No se pudo actualizar el recordatorio")
    }
  }
  async function saveMeasurement(payload: Record<string, unknown>) {
    await api(editingMeasurement ? `/body-measurements/${editingMeasurement.id}` : "/body-measurements", token, {
      method: editingMeasurement ? "PUT" : "POST",
      body: JSON.stringify(payload),
    })
    await props.onRefresh()
    setShowMeasurementForm(false)
    setEditingMeasurement(null)
  }
  async function submitPhoto(event: FormEvent) {
    event.preventDefault()
    if (!photoFile) return
    setBusy(true)
    setError("")
    try {
      await uploadPhoto(token, photoFile, photoCaption, localDateTimeToIso(photoDate, userTimezone))
      setPhotoFile(null)
      setPhotoCaption("")
      setPhotoDate(dateTimeInputValue(new Date().toISOString(), userTimezone))
      await props.onRefresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo cargar la foto")
    } finally {
      setBusy(false)
    }
  }
  async function createMedication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError("")
    try {
      const route = String(form.get("route")) as Medication["route"]
      await api("/medications", token, {
        method: "POST",
        body: JSON.stringify({
          name: String(form.get("name")),
          active: true,
          route,
          concentration_mg: route === "injectable" ? Number(form.get("concentration_mg")) : null,
          concentration_volume_ml: route === "injectable" ? Number(form.get("concentration_volume_ml")) : null,
          units_per_ml: route === "injectable" && form.get("units_per_ml") ? Number(form.get("units_per_ml")) : null,
          dosing_interval: form.get("dosing_interval") || null,
        }),
      })
      setShowNewMedication(false)
      await props.onRefresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="module-page">
      {section !== "Análisis" && (
        <div className="module-heading">
          <div>
            <div className="eyebrow">TU ESPACIO PERSONAL</div>
            <h1>{section}</h1>
          </div>
          {section === "Peso" && (
            <button className="primary-button" onClick={props.onNewWeight}>
              <Plus size={16} /> Registrar peso
            </button>
          )}
          {section === "Composición" && (
            <button className="primary-button" onClick={props.onNewWeight}>
              <Plus size={16} /> Registrar lectura
            </button>
          )}
          {section === "Medicación" && (
            <button
              className="primary-button"
              onClick={() => {
                setNewMedicationRoute("injectable")
                setShowNewMedication(true)
              }}
            >
              <Plus size={16} /> Añadir medicación
            </button>
          )}
          {section === "Medidas" && (
            <button
              className="primary-button"
              onClick={() => {
                setEditingMeasurement(null)
                setShowMeasurementForm(true)
              }}
            >
              <Plus size={16} /> Registrar medidas
            </button>
          )}
          {module && !catalogCategory && (
            <button
              className="primary-button"
              onClick={() => {
                setEditingEntry(null)
                setShowEntryForm(true)
              }}
            >
              <Plus size={16} /> Añadir {journalDefinitions[module].title}
            </button>
          )}
          {section === "Síntomas" && (
            <>
              <button
                className="primary-button"
                onClick={() => {
                  setEditingCatalogEntry(null)
                  setShowCatalogEntryForm(true)
                }}
              >
                <Plus size={16} /> Registrar síntoma
              </button>
              <button
                className="outline-button"
                onClick={() => {
                  setEditingEntry(null)
                  setShowEntryForm(true)
                }}
              >
                Check-in semanal
              </button>
            </>
          )}
          {(section === "Objetivos" || section === "Laboratorios") && (
            <button
              className="primary-button"
              onClick={() => {
                setEditingCatalogEntry(null)
                setShowCatalogEntryForm(true)
              }}
            >
              <Plus size={16} /> {section === "Objetivos" ? "Registrar objetivo" : "Registrar resultados"}
            </button>
          )}
        </div>
      )}

      {section === "Composición" && (
        <>
          <p className="module-hint">
            Lecturas de báscula; son estimaciones del dispositivo, no mediciones diagnósticas. Todos los campos de
            composición son opcionales.
          </p>
          <MetricTrendCharts
            title="Composición corporal"
            series={compositionFields.map(([key, label, unit]) => ({
              label,
              unit,
              points: compositionWeights
                .filter((item) => item[key] != null)
                .sort((a, b) => a.measured_at.localeCompare(b.measured_at))
                .map((item) => ({
                  occurredAt: item.measured_at,
                  date: formatDate(item.measured_at, userTimezone),
                  value: Number(item[key]),
                })),
            }))}
          />
          <div className="record-list">
            {compositionWeights.map((item) => (
              <article className="record-card" key={item.id}>
                <div className="record-card-heading">
                  <div>
                    <strong>{formatDecimal(item.weight_kg)} kg</strong>
                    <time>{formatDateTime(item.measured_at, userTimezone)}</time>
                  </div>
                  <RecordActions
                    onEdit={() => props.onEditWeight(item)}
                    onDelete={() => void props.onDelete(`/weights/${item.id}`)}
                  />
                </div>
                <div className="composition-results">
                  {compositionFields
                    .filter(([key]) => item[key] != null)
                    .map(([key, label, unit]) => (
                      <div key={key}>
                        <span>{label}</span>
                        <strong>
                          {formatDecimal(Number(item[key]))} {unit}
                        </strong>
                      </div>
                    ))}
                </div>
                {item.notes && <p>{item.notes}</p>}
              </article>
            ))}
            {!compositionWeights.length && (
              <EmptyModule text="Registra una lectura con datos de composición para empezar." />
            )}
          </div>
        </>
      )}

      {section === "Análisis" && (
        <AnalysisWorkspace
          weights={weights}
          profile={props.profile}
          hasGoals={props.hasGoals}
          doses={doses}
          measurements={measurements}
          medications={medications}
          entries={entries}
          photos={photos}
          onNavigate={props.onNavigate}
          onToggleMedicationsReviewed={(reviewed) => void toggleMedicationsReviewed(reviewed)}
        />
      )}

      {section === "Peso" && (
        <div className="record-list">
          {weights.map((item) => (
            <article className="record-card" key={item.id}>
              <div className="record-card-heading">
                <div>
                  <strong>{formatDecimal(item.weight_kg)} kg</strong>
                  <time>{formatDateTime(item.measured_at, userTimezone)}</time>
                </div>
                <RecordActions
                  onEdit={() => props.onEditWeight(item)}
                  onDelete={() => void props.onDelete(`/weights/${item.id}`)}
                />
              </div>
              {item.notes && <p>{item.notes}</p>}
            </article>
          ))}
          {!weights.length && <EmptyModule text="Aún no hay registros de peso." />}
        </div>
      )}

      {section === "Medidas" && (
        <>
          <MetricTrendCharts
            title="Medidas corporales"
            series={bodyFields.map(([key, label, unit]) => ({
              label,
              unit,
              points: measurements
                .filter((item) => item[key] != null)
                .sort((a, b) => a.measured_at.localeCompare(b.measured_at))
                .map((item) => ({
                  occurredAt: item.measured_at,
                  date: formatDate(item.measured_at, userTimezone),
                  value: Number(item[key]),
                })),
            }))}
          />
          <div className="record-list">
            {measurements.map((item) => (
              <article className="record-card" key={item.id}>
                <div className="record-card-heading">
                  <strong>{formatDateTime(item.measured_at, userTimezone)}</strong>
                  <RecordActions
                    onEdit={() => {
                      setEditingMeasurement(item)
                      setShowMeasurementForm(true)
                    }}
                    onDelete={() => void props.onDelete(`/body-measurements/${item.id}`)}
                  />
                </div>
                <div className="composition-results">
                  {bodyFields
                    .filter(([key]) => item[key] != null)
                    .map(([key, label, unit]) => (
                      <div key={key}>
                        <span>{label}</span>
                        <strong>
                          {formatDecimal(Number(item[key]))} {unit}
                        </strong>
                      </div>
                    ))}
                </div>
                {item.notes && <p>{item.notes}</p>}
              </article>
            ))}
            {!measurements.length && <EmptyModule text="Registra medidas corporales para ver su evolución." />}
          </div>
        </>
      )}

      {section === "Medicación" && (
        <>
          <div className="record-list">
            {orderedMedications.map((item) => (
              <article className="record-card medication-record" key={item.id}>
                <div className="record-card-heading">
                  <div>
                    <strong>{item.name}</strong>
                    <span className={`record-status ${item.active ? "active" : ""}`}>
                      {item.active ? "Activa" : "Archivada"}
                    </span>
                    {item.is_primary && <span className="record-status active">Principal</span>}
                    <p>
                      {item.route === "oral"
                        ? "Vía oral"
                        : `${item.concentration_mg} mg / ${item.concentration_volume_ml} mL${item.units_per_ml ? ` · U-${item.units_per_ml}` : ""}`}
                    </p>
                    {item.active && (
                      <p>
                        Próxima dosis estimada:{" "}
                        {estimatedNextDose(item, doses)
                          ? `${new Date(estimatedNextDose(item, doses)!).getTime() < Date.now() ? "pendiente desde " : ""}${formatDateTime(estimatedNextDose(item, doses)!, userTimezone)}`
                          : "Configura la frecuencia y registra una dosis"}
                      </p>
                    )}
                  </div>
                  <div className="record-actions">
                    {item.active && (
                      <button className="small-action" onClick={() => props.onNewDose(item)}>
                        <Plus size={13} /> Registrar dosis
                      </button>
                    )}
                    <button
                      className="small-action"
                      onClick={() => {
                        props.onEditMedication(item)
                      }}
                    >
                      Editar
                    </button>
                    {item.active ? (
                      <button
                        className="small-action danger"
                        onClick={() =>
                          api(`/medications/${item.id}`, token, { method: "DELETE" })
                            .then(props.onRefresh)
                            .catch((e: Error) => props.onError(e.message))
                        }
                      >
                        Archivar
                      </button>
                    ) : (
                      <button
                        className="small-action"
                        onClick={() =>
                          api(`/medications/${item.id}`, token, {
                            method: "PUT",
                            body: JSON.stringify({ ...item, active: true }),
                          })
                            .then(props.onRefresh)
                            .catch((e: Error) => props.onError(e.message))
                        }
                      >
                        Reactivar
                      </button>
                    )}
                    <button
                      className="small-action danger"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `¿Eliminar "${item.name}" de forma permanente? Esto también elimina todas sus dosis registradas. Esta acción no se puede deshacer.`,
                          )
                        )
                          return
                        api(`/medications/${item.id}/permanent`, token, { method: "DELETE" })
                          .then(props.onRefresh)
                          .catch((e: Error) => props.onError(e.message))
                      }}
                    >
                      Eliminar
                    </button>
                    {item.active && !item.is_primary && (
                      <button className="small-action" onClick={() => void setPrimaryMedication(item)}>
                        Hacer principal
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
            {!medications.length && <EmptyModule text="Añade una medicación para llevar su seguimiento." />}
          </div>
          <h2 className="module-subheading">Historial de dosis</h2>
          <div className="record-list">
            {doses.map((item) => {
              const medicationName =
                medications.find((medication) => medication.id === item.medication_id)?.name ?? "Medicamento"
              return (
                <article className="record-card" key={item.id}>
                  <div className="record-card-heading">
                    <div>
                      <strong>
                        {medicationName} · {formatDecimal(item.dose_amount)}{" "}
                        {formatDoseUnit(item.dose_amount, item.dose_unit)}
                        {item.calculated_volume_ml !== null && ` · ${formatDecimal(item.calculated_volume_ml)} mL`}
                      </strong>
                      <time>{formatDateTime(item.administered_at, userTimezone)}</time>
                    </div>
                    <RecordActions
                      onEdit={() => props.onEditDose(item)}
                      onDelete={() => void props.onDelete(`/doses/${item.id}`)}
                    />
                  </div>
                </article>
              )
            })}
            {!doses.length && <EmptyModule text="Aún no hay dosis registradas." />}
          </div>
        </>
      )}

      {module && (!catalogCategory || module === "symptoms") && (
        <>
          {module === "reminders" && (
            <div className="telegram-panel">
              <div>
                <strong>{telegram?.linked ? "Telegram conectado" : "Recibe recordatorios por Telegram"}</strong>
                <p className="module-hint">
                  {telegram?.configured
                    ? "Vincula tu chat privado con un enlace de un solo uso que vence en 15 minutos."
                    : "Telegram aún no está configurado por el administrador de esta instalación."}
                </p>
                {telegram && !telegram.configured && (
                  <code className="telegram-config-hint">
                    TELEGRAM_BOT_TOKEN · TELEGRAM_BOT_USERNAME · TELEGRAM_WEBHOOK_SECRET
                  </code>
                )}
              </div>
              {telegram?.linked ? (
                <button className="small-action danger" onClick={() => void unlinkTelegram()}>
                  Desconectar
                </button>
              ) : (
                <button className="outline-button" disabled={!telegram?.configured} onClick={() => void linkTelegram()}>
                  Vincular Telegram
                </button>
              )}
              {pairingUrl && (
                <a className="telegram-link" href={pairingUrl} target="_blank" rel="noreferrer">
                  Abrir Telegram para confirmar la vinculación
                </a>
              )}
            </div>
          )}
          {module === "activity" && weeklyActivityEntries.length > 0 && (
            <div className="activity-weekly-charts">
              {weeklyActivityMetrics.map(({ key, label, unit }) => {
                const points = weeklyActivityEntries
                  .filter((entry) => entry.data[key] != null)
                  .map((entry) => ({
                    occurredAt: weeklyActivityChecklistDate(entry),
                    date: formatDate(weeklyActivityChecklistDate(entry), userTimezone),
                    value: Number(entry.data[key]),
                  }))
                if (!points.length) return null
                return (
                  <MetricTrendCharts
                    key={key}
                    title={`${label} semanales`}
                    hideLegend
                    series={[{ label, unit, points }]}
                  />
                )
              })}
            </div>
          )}
          {module === "symptoms" && <h2 className="module-subheading">Check-ins semanales</h2>}
          <div className="record-list">
            {visibleEntries.map((entry) => (
              <article className="record-card" key={entry.id}>
                <div className="record-card-heading">
                  <div>
                    <strong>{entry.title}</strong>
                    <time>{formatDateTime(entry.occurred_at, userTimezone)}</time>
                    {module === "reminders" && entry.data.auto_generated === true && (
                      <span className="record-status">
                        {entry.data.source_recorded_at
                          ? "Automático · basado en tu último registro"
                          : "Automático · pendiente de registro"}
                      </span>
                    )}
                    {module === "reminders" && typeof entry.data.last_sent_epoch === "number" && (
                      <span
                        className={`record-status ${entry.data.completed_reminder_epoch === entry.data.last_sent_epoch ? "active" : ""}`}
                      >
                        {entry.data.completed_reminder_epoch === entry.data.last_sent_epoch
                          ? "Cumplido desde Telegram"
                          : "Enviado · pendiente de confirmación"}
                      </span>
                    )}
                  </div>
                  {module === "reminders" && entry.data.auto_generated === true ? (
                    typeof entry.data.last_sent_epoch === "number" ? (
                      <span className="record-status active">
                        {entry.data.completed_reminder_epoch === entry.data.last_sent_epoch
                          ? "Cumplido desde Telegram"
                          : "Aviso enviado por Telegram"}
                      </span>
                    ) : (
                      <button
                        className={`small-action ${entry.data.enabled === "Sí" || entry.data.enabled === true ? "danger" : ""}`}
                        aria-pressed={entry.data.enabled === "Sí" || entry.data.enabled === true}
                        onClick={() =>
                          void setReminderEnabled(entry, !(entry.data.enabled === "Sí" || entry.data.enabled === true))
                        }
                      >
                        {entry.data.enabled === "Sí" || entry.data.enabled === true ? "Desactivar" : "Activar"}
                      </button>
                    )
                  ) : (
                    <RecordActions
                      onEdit={() => {
                        setEditingEntry(entry)
                        setShowEntryForm(true)
                      }}
                      onDelete={() => void props.onDelete(`/entries/${entry.id}`)}
                    />
                  )}
                </div>
                <div className="composition-results">
                  {journalDefinitions[module].fields
                    .filter(
                      ({ key }) =>
                        entry.data[key] !== undefined &&
                        entry.data[key] !== null &&
                        entry.data[key] !== "" &&
                        !(module === "reminders" && entry.data.auto_generated === true && key === "repeat"),
                    )
                    .map(({ key, label, type }) => (
                      <div key={key}>
                        <span>
                          {module === "reminders" && key === "reminder_at"
                            ? entry.data.last_sent_epoch != null
                              ? "Aviso enviado"
                              : entry.data.auto_generated === true && entry.data.enabled === "No"
                                ? "Aviso desactivado para"
                                : "Próximo aviso"
                            : label}
                        </span>
                        <strong>
                          {module === "reminders" && key === "reminder_at"
                            ? formatDateTime(String(entry.data[key]), userTimezone)
                            : module === "activity" && key === "entry_type"
                              ? entry.data.entry_type === "weekly"
                                ? "Estadísticas semanales"
                                : "Actividad individual"
                              : type === "number"
                                ? formatDecimal(Number(entry.data[key]))
                                : String(entry.data[key])}
                        </strong>
                      </div>
                    ))}
                </div>
                {entry.notes && <p>{entry.notes}</p>}
              </article>
            ))}
            {!visibleEntries.length && (
              <EmptyModule
                text={`Aún no hay registros de ${module === "symptoms" ? "check-ins semanales" : section.toLowerCase()}.`}
              />
            )}
          </div>
        </>
      )}

      {catalogCategory && catalogModule && (
        <>
          {catalog.length > 0 && (
            <>
              <button
                type="button"
                className="catalog-chip-toggle"
                aria-expanded={catalogChipsExpanded}
                onClick={() => setCatalogChipsExpanded((current) => !current)}
              >
                {catalogChipsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {catalogChipsExpanded ? "Ocultar" : "Ver"} elementos de tu lista ({catalog.length})
              </button>
              {catalogChipsExpanded && (
                <div className="catalog-chip-list">
                  {orderedCatalog.map((item) => (
                    <span
                      className={[
                        "catalog-chip",
                        !item.is_blood_pressure && "catalog-chip-draggable",
                        draggedCatalogId === item.id && "dragging",
                        dragOverCatalogId === item.id && draggedCatalogId !== item.id && "drag-over",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={item.id}
                      data-catalog-id={item.id}
                      // Pointer Events (not HTML5 drag-and-drop) so reordering also works on touch devices
                      onPointerDown={(event) => {
                        if (item.is_blood_pressure) return
                        setDraggedCatalogId(item.id)
                        event.currentTarget.setPointerCapture(event.pointerId)
                      }}
                      onPointerMove={(event) => {
                        if (draggedCatalogId !== item.id) return
                        const hovered = document
                          .elementFromPoint(event.clientX, event.clientY)
                          ?.closest<HTMLElement>("[data-catalog-id]")
                        setDragOverCatalogId(hovered ? Number(hovered.dataset.catalogId) : null)
                      }}
                      onPointerUp={(event) => {
                        event.currentTarget.releasePointerCapture(event.pointerId)
                        if (
                          draggedCatalogId != null &&
                          dragOverCatalogId != null &&
                          dragOverCatalogId !== draggedCatalogId
                        ) {
                          void reorderCatalogItem(draggedCatalogId, dragOverCatalogId)
                        }
                        setDraggedCatalogId(null)
                        setDragOverCatalogId(null)
                      }}
                      onPointerCancel={() => {
                        setDraggedCatalogId(null)
                        setDragOverCatalogId(null)
                      }}
                    >
                      {!item.is_blood_pressure && (
                        <GripVertical size={11} className="catalog-chip-grip" aria-hidden="true" />
                      )}
                      {item.name}
                      {catalogCategory === "lab" && (
                        <button
                          type="button"
                          aria-label={`Definir rango normal de ${item.name}`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => setEditingThresholdsItem(item)}
                        >
                          <Settings size={11} />
                        </button>
                      )}
                      {!item.is_blood_pressure && (
                        <button
                          type="button"
                          aria-label={`Quitar ${item.name}`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => void removeCatalogItem(item)}
                        >
                          <X size={11} />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
          {section === "Laboratorios" && (
            <LabEvolutionCharts
              entries={entries.filter((entry) => entry.module === "labs")}
              catalog={catalog}
              timezone={userTimezone}
            />
          )}
          {section === "Síntomas" && <h2 className="module-subheading">Síntomas registrados</h2>}
          <div className="record-list">
            {entries
              .filter((entry) => entry.module === catalogModule && Array.isArray(entry.data.results))
              .map((entry) => (
                <article className="record-card" key={entry.id}>
                  <div className="record-card-heading">
                    <div>
                      <strong>{entry.title}</strong>
                      <time>{formatDateTime(entry.occurred_at, userTimezone)}</time>
                    </div>
                    <RecordActions
                      onEdit={() => {
                        setEditingCatalogEntry(entry)
                        setShowCatalogEntryForm(true)
                      }}
                      onDelete={() => void props.onDelete(`/entries/${entry.id}`)}
                    />
                  </div>
                  <div className="composition-results">
                    {(entry.data.results as CatalogResult[]).map((result) => {
                      const catalogItem = catalog.find((listed) => listed.id === result.catalog_item_id)
                      const outOfRange =
                        catalogItem != null &&
                        result.value != null &&
                        ((catalogItem.normal_min != null && result.value < catalogItem.normal_min) ||
                          (catalogItem.normal_max != null && result.value > catalogItem.normal_max))
                      return (
                        <div key={result.catalog_item_id}>
                          <span>{result.name}</span>
                          <strong className={outOfRange ? "lab-out-of-range" : undefined}>
                            {outOfRange && <AlertTriangle size={12} aria-hidden="true" />}
                            {result.systolic != null
                              ? `${result.systolic}/${result.diastolic} mmHg (media ${result.mean})`
                              : result.value != null
                                ? `${formatDecimal(result.value)}${result.unit ? ` ${result.unit}` : ""}`
                                : result.text_value != null
                                  ? result.text_value
                                  : `${result.severity ?? result.intensity}/10`}
                          </strong>
                        </div>
                      )
                    })}
                  </div>
                  {typeof entry.data.tolerance === "string" && (
                    <p className="module-hint">Tolerancia percibida: {entry.data.tolerance}</p>
                  )}
                  {entry.notes && <p>{entry.notes}</p>}
                </article>
              ))}
            {!entries.some((entry) => entry.module === catalogModule && Array.isArray(entry.data.results)) && (
              <EmptyModule
                text={
                  catalogCategory === "symptom"
                    ? "Registra un síntoma seleccionándolo de tu lista."
                    : catalogCategory === "goal"
                      ? "Registra un objetivo seleccionándolo de tu lista."
                      : "Registra resultados de laboratorio seleccionándolos de tu lista."
                }
              />
            )}
          </div>
        </>
      )}

      {section === "Fotos" && (
        <>
          <form className="photo-upload-form" onSubmit={submitPhoto}>
            <label>
              Foto (JPEG, PNG o WebP; máximo 10 MB)
              <input
                required
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <label>
              Fecha y hora
              <input
                type="datetime-local"
                required
                value={photoDate}
                onChange={(event) => setPhotoDate(event.target.value)}
              />
            </label>
            <label>
              Descripción <span className="optional">opcional</span>
              <input value={photoCaption} onChange={(event) => setPhotoCaption(event.target.value)} />
            </label>
            <button className="primary-button" disabled={busy || !photoFile}>
              {busy ? "Cargando…" : "Guardar foto privada"}
            </button>
          </form>
          {photoGroups.map(([day, dayPhotos]) => (
            <section className="photo-collection" key={day}>
              <div className="photo-collection-heading">
                <h2>
                  {new Intl.DateTimeFormat("es-CO", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                    timeZone: "UTC",
                  }).format(new Date(`${day}T00:00:00Z`))}
                </h2>
                <span>
                  {dayPhotos.length} {dayPhotos.length === 1 ? "foto" : "fotos"}
                </span>
              </div>
              <div className="photo-grid">
                {dayPhotos.map((photo) => (
                  <PhotoCard
                    key={photo.id}
                    photo={photo}
                    token={token}
                    timezone={userTimezone}
                    onRefresh={props.onRefresh}
                    onDelete={() => void props.onDelete(`/photos/${photo.id}`)}
                  />
                ))}
              </div>
            </section>
          ))}
          {!photos.length && <EmptyModule text="Las fotos se almacenan de forma privada en tu cuenta." />}
        </>
      )}

      {section === "Historial" && (
        <div className="record-list">
          {[
            ...weights.map((item) => ({
              id: `w-${item.id}`,
              date: item.measured_at,
              title: `${item.weight_kg} kg`,
              label: "Peso",
              edit: () => props.onEditWeight(item),
              remove: () => props.onDelete(`/weights/${item.id}`),
            })),
            ...doses.map((item) => ({
              id: `d-${item.id}`,
              date: item.administered_at,
              title: `${medications.find((medication) => medication.id === item.medication_id)?.name ?? "Medicamento"} · ${formatDecimal(item.dose_amount)} ${formatDoseUnit(item.dose_amount, item.dose_unit)}`,
              label: "Dosis",
              edit: () => props.onEditDose(item),
              remove: () => props.onDelete(`/doses/${item.id}`),
            })),
            ...measurements.map((item) => ({
              id: `m-${item.id}`,
              date: item.measured_at,
              title: "Medidas corporales",
              label: "Medidas",
              edit: () => {
                setEditingMeasurement(item)
                setShowMeasurementForm(true)
              },
              remove: () => props.onDelete(`/body-measurements/${item.id}`),
            })),
            ...entries
              .filter((item) => item.module !== "reminders")
              .map((item) => ({
                id: `e-${item.id}`,
                date: item.occurred_at,
                title: item.title,
                label: journalSectionLabels[item.module],
                edit: () => {
                  setEditingEntry(item)
                  setShowEntryForm(true)
                },
                remove: () => props.onDelete(`/entries/${item.id}`),
              })),
          ]
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((item) => (
              <article className="record-card history-card" key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <span>
                    {item.label} · {formatDateTime(item.date, userTimezone)}
                  </span>
                </div>
                <RecordActions onEdit={item.edit} onDelete={() => void item.remove()} />
              </article>
            ))}
        </div>
      )}

      {showEntryForm &&
        module &&
        (module === "activity" ? (
          <ActivityEntryEditor
            entry={editingEntry ?? undefined}
            timezone={userTimezone}
            onClose={() => {
              setShowEntryForm(false)
              setEditingEntry(null)
            }}
            onSave={saveJournal}
          />
        ) : (
          <JournalEntryEditor
            module={module}
            entry={editingEntry ?? undefined}
            timezone={userTimezone}
            onClose={() => {
              setShowEntryForm(false)
              setEditingEntry(null)
            }}
            onSave={saveJournal}
          />
        ))}
      {showCatalogEntryForm && catalogCategory && (
        <CatalogEntryEditor
          category={catalogCategory}
          catalog={orderedCatalog}
          entry={editingCatalogEntry ?? undefined}
          timezone={userTimezone}
          onClose={() => {
            setShowCatalogEntryForm(false)
            setEditingCatalogEntry(null)
          }}
          onSave={saveCatalogEntry}
          onAddCatalogItem={addCatalogItem}
        />
      )}
      {editingThresholdsItem && (
        <CatalogThresholdsEditor
          item={editingThresholdsItem}
          onClose={() => setEditingThresholdsItem(null)}
          onSave={(normalMin, normalMax, diastolicMin, diastolicMax) =>
            updateCatalogThresholds(editingThresholdsItem, normalMin, normalMax, diastolicMin, diastolicMax)
          }
        />
      )}
      {showMeasurementForm && (
        <BodyMeasurementEditor
          entry={editingMeasurement ?? undefined}
          timezone={userTimezone}
          onClose={() => {
            setShowMeasurementForm(false)
            setEditingMeasurement(null)
          }}
          onSave={saveMeasurement}
        />
      )}
      {showNewMedication && (
        <Modal
          title="Añadir medicación"
          subtitle="Registra medicamentos orales e inyectables. Las conversiones solo aplican a inyectables."
          onClose={() => setShowNewMedication(false)}
        >
          <form className="entry-form" onSubmit={createMedication}>
            <label>
              Nombre
              <input name="name" required maxLength={120} />
            </label>
            <label>
              Vía de administración
              <select
                name="route"
                value={newMedicationRoute}
                onChange={(event) => setNewMedicationRoute(event.target.value as Medication["route"])}
              >
                <option value="injectable">Inyectable</option>
                <option value="oral">Oral</option>
              </select>
            </label>
            {newMedicationRoute === "injectable" && (
              <>
                <div className="form-two-columns">
                  <label>
                    Concentración
                    <input name="concentration_mg" required type="number" min="0.01" step="0.01" />
                  </label>
                  <label>
                    Volumen (mL)
                    <input name="concentration_volume_ml" required type="number" min="0.01" step="0.01" />
                  </label>
                </div>
                <label>
                  Unidades/mL <span className="optional">opcional</span>
                  <input name="units_per_ml" type="number" min="0.01" step="0.01" />
                </label>
              </>
            )}
            <label>
              Frecuencia <span className="optional">opcional</span>
              <select name="dosing_interval" defaultValue="">
                <option value="">Sin configurar</option>
                <option value="daily">Diaria</option>
                <option value="weekly">Semanal</option>
              </select>
            </label>
            {error && <div className="error-banner">{error}</div>}
            <div className="form-actions">
              <button type="button" className="cancel-button" onClick={() => setShowNewMedication(false)}>
                Cancelar
              </button>
              <button className="primary-button" disabled={busy}>
                {busy ? "Guardando…" : "Añadir"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
    </section>
  )
}
