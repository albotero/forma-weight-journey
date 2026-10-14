import { useState } from "react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import {
  activityMetrics,
  shiftActivityDate,
  type ActivityMetricKey,
  type summarizeActivity,
} from "../../lib/activity.js"
import { localDateTimeToIso } from "../../dateTime.js"
import { formatDate, formatDecimal } from "../../lib/format"

export function ActivityOverview({
  summary,
  timezone,
  weekCount,
  onPeriodChange,
}: {
  summary: ReturnType<typeof summarizeActivity>
  timezone: string
  weekCount: number | null
  onPeriodChange: (weeks: number | null) => void
}) {
  const [metricKey, setMetricKey] = useState<ActivityMetricKey>("calories_kcal")
  const metric = activityMetrics.find(({ key }) => key === metricKey)!
  const dateLabel = (day: string) =>
    `${formatDate(localDateTimeToIso(`${day}T12:00`, timezone), timezone)} ${day.slice(0, 4)}`
  const display = (value: number | null) => (value === null ? "Sin datos" : formatDecimal(value))
  const points = summary.weeks.flatMap((week) => {
    const values = week.metrics[metricKey]
    return values.total === null
      ? []
      : [{
          date: dateLabel(week.start),
          range: `${dateLabel(week.start)} – ${dateLabel(shiftActivityDate(week.start, 6))}`,
          single: values.single,
          weekly: values.weekly,
        }]
  })
  const hasSingle = points.some(({ single }) => single !== null)
  const hasWeekly = points.some(({ weekly }) => weekly !== null)

  return (
    <section className="activity-overview" aria-label="Resumen de actividad">
      <div className="activity-summary-heading">
        <div>
          <h2 className="module-subheading">Tu actividad en cifras</h2>
          <p className="module-hint">
            {summary.start ? `${dateLabel(summary.start)} – ${dateLabel(summary.end)}` : "Todo el historial hasta hoy"}
            {" · "}{summary.singleCount} {summary.singleCount === 1 ? "actividad individual" : "actividades individuales"}
            {" · "}{summary.weeklyCount} {summary.weeklyCount === 1 ? "resumen semanal" : "resúmenes semanales"}
          </p>
        </div>
        <div className="range-select" role="group" aria-label="Período de actividad">
          {[
            { weeks: 1, label: "Esta semana" },
            { weeks: 4, label: "4 semanas" },
            { weeks: 12, label: "12 semanas" },
            { weeks: null, label: "Todo" },
          ].map(({ weeks, label }) => (
            <button
              key={label}
              type="button"
              className={weekCount === weeks ? "selected" : ""}
              aria-pressed={weekCount === weeks}
              onClick={() => onPeriodChange(weeks)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="module-hint">
        Los totales suman actividades individuales y resúmenes semanales, incluso si coinciden.
        Si un resumen ya incluye una actividad, se contará dos veces.
        Las semanas van de lunes a domingo; cada resumen se asigna completo a la semana de su fecha final.
        Solo se suman medidas registradas, sin estimar pasos ni calorías.
      </p>
      {summary.invalidMeasurementCount > 0 && (
        <p className="error-banner" role="alert">
          Algunas medidas de este período no son válidas ({summary.invalidMeasurementCount}).
          No se incluyeron en los totales; revisa y corrige los registros.
        </p>
      )}
      <div className="activity-total-grid">
        {activityMetrics.map(({ key, label, unit }) => (
          <article className="panel activity-total-card" key={key}>
            <h3>{label}</h3>
            <strong>{display(summary.totals[key].total)}</strong>
            {summary.totals[key].total !== null && <span className="activity-total-unit">{unit}</span>}
            <dl>
              <div>
                <dt>Individuales</dt>
                <dd>{display(summary.totals[key].single)}</dd>
              </div>
              {key !== "duration_min" && (
                <div>
                  <dt>Resúmenes</dt>
                  <dd>{display(summary.totals[key].weekly)}</dd>
                </div>
              )}
            </dl>
          </article>
        ))}
      </div>
      {summary.entries.length > 0 && (
        <>
          <div className="range-select activity-metric-select" role="group" aria-label="Métrica de evolución">
            {activityMetrics.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={metricKey === key ? "selected" : ""}
                aria-pressed={metricKey === key}
                onClick={() => setMetricKey(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {points.length > 0 && (
            <div className="panel analysis-chart-panel trend-chart-panel">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">TOTALES SEMANALES</div>
                  <h2>{metric.label} por semana</h2>
                </div>
                <span className="goal-caption">{metric.unit} · individuales + resúmenes</span>
              </div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={points} margin={{ top: 20, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--line)" />
                    <XAxis
                      dataKey="date"
                      axisLine={false}
                      tickLine={false}
                      minTickGap={30}
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                    />
                    <YAxis
                      domain={[0, "auto"]}
                      allowDecimals={metricKey !== "steps"}
                      axisLine={false}
                      tickLine={false}
                      width={70}
                      tickFormatter={(value) => formatDecimal(Number(value))}
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                    />
                    <Tooltip
                      labelFormatter={(label, payload) => payload[0]?.payload.range ?? label}
                      formatter={(value, name) => [`${formatDecimal(Number(value))} ${metric.unit}`, name]}
                      contentStyle={{ background: "var(--panel)", borderColor: "var(--line)", color: "var(--text)" }}
                    />
                    <Legend />
                    {hasSingle && (
                      <Bar dataKey="single" name="Individuales" stackId="total" fill="#398766" maxBarSize={64} />
                    )}
                    {hasWeekly && (
                      <Bar dataKey="weekly" name="Resúmenes semanales" stackId="total" fill="#3d6fb4" maxBarSize={64} />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          {!points.length && <p className="module-hint">No hay datos de {metric.label.toLowerCase()} en este período.</p>}
          <p className="module-hint">Las semanas sin esta medida no se representan como cero.</p>
        </>
      )}
    </section>
  )
}
