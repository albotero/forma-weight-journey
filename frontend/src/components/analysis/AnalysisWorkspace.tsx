import {
  Area,
  ComposedChart,
  Line as RechartsLine,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Activity, Check, HeartPulse, LineChart, Scale, ShieldCheck, TrendingDown } from "lucide-react"
import type {
  BodyMeasurementEntry,
  CatalogResult,
  DoseEntry,
  JournalEntry,
  Medication,
  PhotoEntry,
  Profile,
  WeightEntry,
} from "../../api"
import type { Section } from "../../lib/types"
import { formatDate, formatDecimal, formatDoseUnit, niceAxis, formatAxisTick } from "../../lib/format"
import { bmiRangeAreas, BmiRangeLegend } from "../charts/BmiRange"
import { weeklyActivityChecklistDate, compositionFields } from "../../lib/records"
import { weightMovingAverageSeries } from "../../lib/weightTrend.js"
import { MetricCard } from "../common/MetricCard"
import { EmptyModule } from "../common/Empty"
import { bodyFields } from "../modules/bodyMeasurements"

export function AnalysisWorkspace({
  weights,
  profile,
  hasGoals,
  doses,
  measurements,
  medications,
  entries,
  photos,
  onNavigate,
  onToggleMedicationsReviewed,
}: {
  weights: WeightEntry[]
  profile: Profile | null
  hasGoals: boolean
  doses: DoseEntry[]
  measurements: BodyMeasurementEntry[]
  medications: Medication[]
  entries: JournalEntry[]
  photos: PhotoEntry[]
  onNavigate: (target: Section) => void
  onToggleMedicationsReviewed: (reviewed: boolean) => void
}) {
  const now = Date.now()
  const isWithinDays = (date: string, days: number) => {
    const elapsed = now - new Date(date).getTime()
    return elapsed >= 0 && elapsed <= days * 86400000
  }
  const pastMeasurements = measurements.filter((item) => new Date(item.measured_at).getTime() <= now)
  const pastDoses = doses.filter((item) => new Date(item.administered_at).getTime() <= now)
  const pastPhotos = photos.filter((item) => new Date(item.taken_at).getTime() <= now)
  const pastEntries = entries.filter((item) => new Date(item.occurred_at).getTime() <= now)
  const pastWeights = weights
    .filter((item) => new Date(item.measured_at).getTime() <= now)
    .sort((a, b) => a.measured_at.localeCompare(b.measured_at) || a.id - b.id)
  const latest = pastWeights.at(-1)
  const previous = pastWeights.at(-2)
  const recent = pastWeights.filter((item) => isWithinDays(item.measured_at, 7))
  const average = recent.length ? recent.reduce((sum, item) => sum + item.weight_kg, 0) / recent.length : null
  const elapsedDays =
    latest && previous
      ? (new Date(latest.measured_at).getTime() - new Date(previous.measured_at).getTime()) / 86400000
      : 0
  const weeklyChange =
    latest && previous && elapsedDays > 0 ? ((latest.weight_kg - previous.weight_kg) / elapsedDays) * 7 : null
  const monthlyWeights = pastWeights.filter((item) => isWithinDays(item.measured_at, 28))
  const weeklyWeights = pastWeights.filter((item) => isWithinDays(item.measured_at, 7))
  const monthlyTrend =
    monthlyWeights.length >= 2 ? monthlyWeights.at(-1)!.weight_kg - monthlyWeights[0].weight_kg : null
  const monthlyTrendSummary =
    monthlyTrend == null
      ? "No hay al menos dos registros de peso en las últimas 4 semanas para estimar una tendencia."
      : `La tendencia de peso durante las últimas 4 semanas es de ${monthlyTrend < 0 ? "−" : monthlyTrend > 0 ? "+" : ""}${formatDecimal(Math.abs(monthlyTrend))} kg.`
  const treatmentMedication =
    medications.find((item) => item.active && item.is_primary) ?? medications.find((item) => item.active)
  const recentDoses = pastDoses
    .filter((item) => item.medication_id === treatmentMedication?.id)
    .sort((a, b) => b.administered_at.localeCompare(a.administered_at))
  const currentDose = recentDoses[0]
  const doseSequence = currentDose
    ? recentDoses.slice(
        0,
        recentDoses.findIndex(
          (item) =>
            item.medication_id !== currentDose.medication_id ||
            item.dose_amount !== currentDose.dose_amount ||
            item.dose_unit !== currentDose.dose_unit,
        ) < 0
          ? recentDoses.length
          : recentDoses.findIndex(
              (item) =>
                item.medication_id !== currentDose.medication_id ||
                item.dose_amount !== currentDose.dose_amount ||
                item.dose_unit !== currentDose.dose_unit,
            ),
      )
    : []
  const doseStartedAt = doseSequence.at(-1)?.administered_at
  const doseDays = doseStartedAt ? Math.max(0, (now - new Date(doseStartedAt).getTime()) / 86400000) : 0
  const symptoms = pastEntries.filter((entry) => entry.module === "symptoms")
  const doseSymptoms = symptoms.filter(
    (entry) =>
      currentDose &&
      new Date(entry.occurred_at).getTime() >= new Date(doseStartedAt ?? currentDose.administered_at).getTime(),
  )
  const concerningSymptoms = doseSymptoms.filter((entry) => {
    const tolerance = String(entry.data.tolerance ?? "")
    const results = Array.isArray(entry.data.results) ? (entry.data.results as CatalogResult[]) : []
    const maxSeverity = results.reduce((max, result) => Math.max(max, Number(result.severity ?? 0)), 0)
    return maxSeverity >= 5 || tolerance === "Con molestias moderadas" || tolerance === "Con molestias importantes"
  })
  const hasGastrointestinalSymptoms = concerningSymptoms.some(
    (entry) =>
      Array.isArray(entry.data.results) &&
      (entry.data.results as CatalogResult[]).some(
        (result) => result.category === "Gastrointestinal" && Number(result.severity ?? 0) >= 5,
      ),
  )
  const goodToleranceRecorded = doseSymptoms.some((entry) => entry.data.tolerance === "Buena")
  const doseMedication = currentDose && treatmentMedication
  const compositionWeights = pastWeights.filter((item) => compositionFields.some(([key]) => item[key] != null))
  const latestComposition = compositionWeights.at(-1)
  const previousComposition = compositionWeights.at(-2)
  const compositionChanges =
    previousComposition && latestComposition
      ? compositionFields.flatMap(([key, label, unit]) => {
          const current = latestComposition[key]
          const before = previousComposition[key]
          return current == null || before == null ? [] : [{ label, unit, current, change: current - before }]
        })
      : []
  const bodyMeasurementReadings = pastMeasurements
    .filter((item) => bodyFields.some(([key]) => item[key] != null))
    .sort((first, second) => first.measured_at.localeCompare(second.measured_at) || first.id - second.id)
  const latestBodyMeasurement = bodyMeasurementReadings.at(-1)
  const previousBodyMeasurement = bodyMeasurementReadings.at(-2)
  const bodyMeasurementChanges =
    previousBodyMeasurement && latestBodyMeasurement
      ? bodyFields.flatMap(([key, label, unit]) => {
          const current = latestBodyMeasurement[key]
          const before = previousBodyMeasurement[key]
          return current == null || before == null ? [] : [{ label, unit, current, change: current - before }]
        })
      : []
  const chart = weightMovingAverageSeries(pastWeights).map((item) => ({
    date: formatDate(item.measured_at, profile?.timezone),
    peso: item.weight_kg,
    promedio: item.moving_average_7d_kg,
  }))
  const weightAxis = niceAxis(
    chart.flatMap((item) => [item.peso, item.promedio]),
    2,
  )
  const labEntries = pastEntries.filter((entry) => entry.module === "labs")
  const reviewEntries = pastEntries.filter((entry) => entry.module === "reviews")
  const recentSymptoms = symptoms.filter((entry) => isWithinDays(entry.occurred_at, 7))
  const weeklyCheckIn = recentSymptoms.find((entry) => entry.data.appetite != null && entry.data.satiety != null)
  const currentWaist = pastMeasurements.some((item) => item.waist_cm != null)
  const recentMeasurements = pastMeasurements.some(
    (item) => isWithinDays(item.measured_at, 28) && bodyFields.some(([key]) => item[key] != null),
  )
  const hasBaselineLabs = labEntries.some((entry) => entry.data.phase === "Basal")
  const hasPeriodicLabs = labEntries.some(
    (entry) =>
      isWithinDays(entry.occurred_at, 90) &&
      Array.isArray(entry.data.results) &&
      (entry.data.results as CatalogResult[]).some((result) => result.systolic == null),
  )
  const hasRelevantHistory = reviewEntries.some((entry) => String(entry.data.relevant_history ?? "").trim())
  const hasRecentTreatmentReview = reviewEntries.some(
    (entry) => entry.data.review_type === "Tratamiento" && isWithinDays(entry.occurred_at, 90),
  )
  const hasRecentBloodPressure = labEntries.some(
    (entry) =>
      isWithinDays(entry.occurred_at, 7) &&
      Array.isArray(entry.data.results) &&
      (entry.data.results as CatalogResult[]).some((result) => result.systolic != null),
  )
  type ChecklistTask = {
    label: string
    done: boolean
    target: Section
    detail?: string
    toggle?: (value: boolean) => void
  }
  const checklistGroups: { title: string; subtitle: string; tasks: ChecklistTask[] }[] = [
    {
      title: "Antes de iniciar",
      subtitle:
        "Punto de partida para conversar con tu equipo; tener datos guardados no valida si están vigentes o si es clínicamente adecuado iniciar.",
      tasks: [
        { label: "Peso inicial", done: pastWeights.length > 0, target: "Peso" as Section },
        { label: "Cintura", done: currentWaist, target: "Medidas" as Section },
        {
          label: "Presión arterial",
          done: labEntries.some(
            (entry) =>
              Array.isArray(entry.data.results) &&
              (entry.data.results as CatalogResult[]).some((result) => result.systolic != null),
          ),
          target: "Laboratorios" as Section,
        },
        {
          label: "Revisar y confirmar medicamentos actuales",
          done: profile?.medications_reviewed ?? false,
          target: "Medicación" as Section,
          toggle: onToggleMedicationsReviewed,
        },
        { label: "Antecedentes relevantes", done: hasRelevantHistory, target: "Revisiones" as Section },
        {
          label: "Laboratorio basal según indicación clínica",
          done: hasBaselineLabs,
          target: "Laboratorios" as Section,
        },
      ],
    },
    {
      title: "Cada día",
      subtitle: "Registro diario recomendado.",
      tasks: [
        {
          label: "Peso",
          done: pastWeights.some((item) => isWithinDays(item.measured_at, 1)),
          target: "Peso" as Section,
        },
      ],
    },
    {
      title: "Cada semana",
      subtitle: "Seguimiento de los últimos 7 días.",
      tasks: [
        {
          label: "Dosis registrada",
          done: pastDoses.some((item) => isWithinDays(item.administered_at, 7)),
          target: "Medicación" as Section,
        },
        {
          label: "Presión arterial",
          done: hasRecentBloodPressure,
          target: "Laboratorios" as Section,
        },
        { label: "Apetito y saciedad", done: Boolean(weeklyCheckIn), target: "Síntomas" as Section },
        {
          label: "Síntomas y tolerancia",
          done: recentSymptoms.some(
            (entry) =>
              (Array.isArray(entry.data.results) && (entry.data.results as CatalogResult[]).length > 0) ||
              entry.data.tolerance != null,
          ),
          target: "Síntomas" as Section,
        },
        {
          label: "Hidratación",
          done: recentSymptoms.some((entry) => entry.data.hydration_l != null),
          target: "Síntomas" as Section,
        },
        {
          label: "Actividad",
          done: pastEntries.some(
            (entry) => entry.module === "activity" && isWithinDays(weeklyActivityChecklistDate(entry), 7),
          ),
          target: "Actividad" as Section,
        },
        {
          label: "Composición corporal",
          done: weeklyWeights.some((item) => compositionFields.some(([key]) => item[key] != null)),
          target: "Composición" as Section,
        },
      ],
    },
    {
      title: "Cada 4 semanas",
      subtitle: "Revisa cambios y contexto del último periodo de 28 días.",
      tasks: [
        {
          label: "Peso y tendencia",
          done: monthlyTrend != null,
          detail:
            monthlyTrend == null
              ? undefined
              : `${monthlyTrend > 0 ? "+" : ""}${formatDecimal(monthlyTrend)} kg en 28 días`,
          target: "Peso" as Section,
        },
        { label: "Medidas corporales", done: recentMeasurements, target: "Medidas" as Section },
        {
          label: "Fotografías",
          done: pastPhotos.some((item) => isWithinDays(item.taken_at, 28)),
          target: "Fotos" as Section,
        },
        {
          label: "Síntomas y tolerancia",
          done: symptoms.some(
            (entry) =>
              isWithinDays(entry.occurred_at, 28) &&
              ((Array.isArray(entry.data.results) && (entry.data.results as CatalogResult[]).length > 0) ||
                entry.data.tolerance != null),
          ),
          target: "Síntomas" as Section,
        },
        {
          label: "Dosis actual y tiempo desde el primer registro",
          done: Boolean(currentDose),
          detail: currentDose && doseStartedAt ? `${formatDecimal(doseDays / 7)} semanas según registros` : undefined,
          target: "Medicación" as Section,
        },
        ...(hasGoals
          ? [
              {
                label: "Revisión de objetivos",
                done: pastEntries.some((entry) => entry.module === "goals" && isWithinDays(entry.occurred_at, 28)),
                target: "Objetivos" as Section,
              },
            ]
          : []),
      ],
    },
    {
      title: "Periódicamente, según indicación clínica",
      subtitle: "La frecuencia y las pruebas se acuerdan con tu profesional de salud.",
      tasks: [
        { label: "Laboratorios según situación clínica", done: hasPeriodicLabs, target: "Laboratorios" as Section },
        {
          label: "Revisión reciente del tratamiento (3 meses)",
          done: hasRecentTreatmentReview,
          target: "Revisiones" as Section,
        },
      ],
    },
  ]
  const recommendation = !currentDose
    ? {
        title: "Seguimiento de dosis",
        message:
          "Aún no hay dosis registradas. Añade tus registros para mostrar un resumen descriptivo de tiempo y tolerancia.",
        caution: false,
      }
    : concerningSymptoms.length
      ? {
          title: "Precaución",
          message: `${hasGastrointestinalSymptoms ? "Se registraron síntomas gastrointestinales" : `Hay ${concerningSymptoms.length === 1 ? "un registro" : `${concerningSymptoms.length} registros`} de síntomas`} durante el periodo de la dosis actual con intensidad de 5/10 o más, o tolerancia percibida con molestias moderadas/importantes. ${monthlyTrendSummary} Conviene revisar tolerancia, hidratación y evolución con un profesional de salud antes de considerar cualquier cambio.`,
          caution: true,
        }
      : doseDays >= 28 && goodToleranceRecorded
        ? {
            title: "Revisión de dosis",
            message: `La misma dosis aparece registrada desde hace ${formatDecimal(doseDays / 7)} semanas. Se registró tolerancia percibida como buena y no aparecen síntomas de intensidad 5/10 o más en este periodo. ${monthlyTrendSummary} Considera revisar la respuesta y la tolerancia con tu profesional de salud antes de realizar cualquier cambio de dosis.`,
            caution: false,
          }
        : doseDays >= 28
          ? {
              title: "Revisión de seguimiento",
              message: `La misma dosis aparece en los registros desde hace ${formatDecimal(doseDays / 7)} semanas. La tolerancia no está documentada como buena; la ausencia de síntomas registrados no confirma que no los haya. ${monthlyTrendSummary} Considera revisar respuesta y tolerancia con tu profesional de salud antes de cualquier cambio.`,
              caution: false,
            }
          : {
              title: "Seguimiento de dosis",
              message: `Hay ${formatDecimal(doseDays / 7)} semanas entre el primer registro disponible de esta dosis y hoy. Estos datos son descriptivos y no indican cuándo cambiarla; revisa cualquier decisión con tu profesional de salud.`,
              caution: false,
            }

  return (
    <section className="module-page">
      <div className="module-heading">
        <div>
          <div className="eyebrow">RESUMEN DESCRIPTIVO</div>
          <h1>Análisis</h1>
        </div>
      </div>
      <p className="module-hint">
        Comparaciones basadas en tus registros. El checklist orienta qué datos podrías revisar con tu equipo de salud;
        no determina si estás listo para iniciar o cambiar un tratamiento.
      </p>
      <div className="metric-grid analysis-metrics">
        <MetricCard
          label="REGISTROS DE PESO"
          icon={<Scale size={18} />}
          value={String(pastWeights.length)}
          unit=""
          foot="Lecturas guardadas"
          accent="green"
        />
        <MetricCard
          label="PROMEDIO · 7 DÍAS"
          icon={<LineChart size={18} />}
          value={average == null ? "—" : formatDecimal(average)}
          unit={average == null ? "" : "kg"}
          foot={`${recent.length} ${recent.length === 1 ? "registro" : "registros"} recientes`}
          accent="blue"
        />
        <MetricCard
          label="CAMBIO SEMANAL ESTIMADO"
          icon={<TrendingDown size={18} />}
          value={weeklyChange == null ? "—" : `${weeklyChange > 0 ? "+" : ""}${formatDecimal(weeklyChange)}`}
          unit={weeklyChange == null ? "" : "kg/sem"}
          foot="Entre las dos lecturas más recientes"
          accent="purple"
        />
        <MetricCard
          label="ÚLTIMO PESO"
          icon={<Activity size={18} />}
          value={latest ? formatDecimal(latest.weight_kg) : "—"}
          unit={latest ? "kg" : ""}
          foot={latest ? formatDate(latest.measured_at, profile?.timezone) : "Aún no hay datos"}
          accent="amber"
        />
      </div>
      <section className="followup-section" aria-labelledby="followup-title">
        <div className="followup-heading">
          <div>
            <div className="eyebrow">ORGANIZA TU SEGUIMIENTO</div>
            <h2 id="followup-title">Checklist contextual</h2>
          </div>
          <span>El estado se actualiza con tus registros</span>
        </div>
        <div className="followup-grid">
          {checklistGroups.map((group) => (
            <article className="followup-card" key={group.title}>
              <div className="followup-card-heading">
                <div>
                  <h3>{group.title}</h3>
                  <p>{group.subtitle}</p>
                </div>
                <span className="followup-count">
                  {group.tasks.filter((task) => task.done).length}/{group.tasks.length}
                </span>
              </div>
              <ul className="followup-list">
                {group.tasks.map((task) => (
                  <li key={task.label} className={task.done ? "complete" : "pending"}>
                    {task.toggle ? (
                      <button
                        type="button"
                        className="followup-status followup-toggle"
                        aria-pressed={task.done}
                        aria-label={task.done ? "Marcar como pendiente" : "Marcar como confirmado"}
                        onClick={() => task.toggle?.(!task.done)}
                      >
                        {task.done ? <Check size={14} /> : <span />}
                      </button>
                    ) : (
                      <span className="followup-status" aria-label={task.done ? "Registrado" : "Pendiente"}>
                        {task.done ? <Check size={14} /> : <span />}
                      </span>
                    )}
                    <div className="followup-task-copy">
                      <strong>{task.label}</strong>
                      {task.detail && <small>{task.detail}</small>}
                    </div>
                    {!task.done && !task.toggle && (
                      <button type="button" className="followup-action" onClick={() => onNavigate(task.target)}>
                        Registrar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
      <aside className={`recommendation-card ${recommendation.caution ? "caution" : ""}`} aria-live="polite">
        <div className="recommendation-icon">
          {recommendation.caution ? <HeartPulse size={19} /> : <ShieldCheck size={19} />}
        </div>
        <div>
          <div className="eyebrow">SEGUIMIENTO INFORMATIVO</div>
          <h2>{recommendation.title}</h2>
          {currentDose && (
            <div className="recommendation-context">
              {doseMedication?.name ?? "Dosis registrada"} · {formatDecimal(currentDose.dose_amount)}{" "}
              {formatDoseUnit(currentDose.dose_amount, currentDose.dose_unit)} · último registro{" "}
              {formatDate(currentDose.administered_at, profile?.timezone)}
            </div>
          )}
          <p>{recommendation.message}</p>
          <small>
            Resumen automático de los datos registrados; no diagnostica ni recomienda iniciar, suspender o cambiar
            dosis.
          </small>
        </div>
      </aside>
      <div className="panel analysis-chart-panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">SERIE TEMPORAL</div>
            <h2>Peso registrado</h2>
          </div>
          <span className="goal-caption">{pastWeights.length} lecturas</span>
        </div>
        {chart.length ? (
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 20, right: 8, left: -20, bottom: 0 }}>
                {bmiRangeAreas(profile?.height_cm, weightAxis.domain)}
                <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--line)" />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--muted)", fontSize: 11 }}
                  minTickGap={30}
                />
                <YAxis
                  domain={weightAxis.domain}
                  ticks={weightAxis.ticks}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--muted)", fontSize: 11 }}
                  tickFormatter={(value) => formatAxisTick(Number(value))}
                />
                <Tooltip formatter={(value, name) => [`${formatDecimal(Number(value))} kg`, name]} />
                <Area
                  type="monotone"
                  dataKey="peso"
                  name="Peso registrado"
                  stroke="#398766"
                  strokeWidth={2.7}
                  fill="none"
                />
                <RechartsLine
                  type="monotone"
                  dataKey="promedio"
                  name="Media móvil (7 días)"
                  stroke="#3d6fb4"
                  strokeWidth={2.5}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyModule text="Registra al menos un peso para ver su evolución." />
        )}
        {chart.length > 0 && (
          <div className="chart-legend">
            <span>
              <i className="legend-dot" /> Peso registrado
            </span>
            <span>
              <i className="legend-dot" style={{ background: "#3d6fb4" }} /> Media móvil (7 días)
            </span>
          </div>
        )}
        {chart.length > 0 && profile && <BmiRangeLegend />}
      </div>
      <h2 className="module-subheading">Cambio de composición entre las dos últimas lecturas</h2>
      {compositionChanges.length ? (
        <div className="composition-results">
          {compositionChanges.map(({ label, unit, current, change }) => (
            <div key={label}>
              <span>{label}</span>
              <strong>
                {formatDecimal(current)} {unit}
              </strong>
              <small className="analysis-delta">
                {change > 0 ? "+" : ""}
                {formatDecimal(change)} {unit}
              </small>
            </div>
          ))}
        </div>
      ) : (
        <EmptyModule
          text={
            compositionWeights.length < 2
              ? "Se necesitan dos lecturas con datos de composición para compararlas."
              : "Las dos últimas lecturas de composición no tienen campos en común para comparar."
          }
        />
      )}
      <h2 className="module-subheading">Cambio de medidas corporales entre las dos últimas lecturas</h2>
      {bodyMeasurementChanges.length ? (
        <div className="composition-results">
          {bodyMeasurementChanges.map(({ label, unit, current, change }) => (
            <div key={label}>
              <span>{label}</span>
              <strong>
                {formatDecimal(current)} {unit}
              </strong>
              <small className="analysis-delta">
                {change > 0 ? "+" : ""}
                {formatDecimal(change)} {unit}
              </small>
            </div>
          ))}
        </div>
      ) : (
        <EmptyModule
          text={
            bodyMeasurementReadings.length < 2
              ? "Se necesitan dos lecturas con medidas corporales para compararlas."
              : "Las dos últimas lecturas de medidas corporales no tienen campos en común para comparar."
          }
        />
      )}
    </section>
  )
}
