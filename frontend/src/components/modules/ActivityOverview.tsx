import { useId, useState } from "react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import {
  activityMetrics,
  type ActivityMetricKey,
  type summarizeActivity,
} from "../../lib/activity.js"
import { localDateTimeToIso } from "../../dateTime.js"
import { formatDate, formatDecimal } from "../../lib/format"
import { chartPeriods, type ChartPeriod } from "../../lib/chartPeriod.js"

export function ActivityOverview({
  summary,
  timezone,
  period,
  onPeriodChange,
}: {
  summary: ReturnType<typeof summarizeActivity>
  timezone: string
  period: ChartPeriod
  onPeriodChange: (period: ChartPeriod) => void
}) {
  const [metricKey, setMetricKey] = useState<ActivityMetricKey>("calories_kcal")
  const gradientId = useId().replaceAll(":", "")
  const metric = activityMetrics.find(({ key }) => key === metricKey)!
  const dateLabel = (day: string) =>
    `${formatDate(localDateTimeToIso(`${day}T12:00`, timezone), timezone)} ${day.slice(0, 4)}`
  const display = (value: number | null) => (value === null ? "Sin datos" : formatDecimal(value))
  const points = summary.weeks.flatMap((week) => {
    const values = week.metrics[metricKey]
    return values.total === null
      ? []
      : [{
          date: formatDate(localDateTimeToIso(`${week.end}T12:00`, timezone), timezone),
          range: `${dateLabel(week.start)} – ${dateLabel(week.end)}`,
          single: values.single,
          weekly: values.weekly,
          total: values.total,
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
          {chartPeriods.map(({ value, label }) => (
            <button
              key={label}
              type="button"
              className={period === value ? "selected" : ""}
              aria-pressed={period === value}
              onClick={() => onPeriodChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="activity-disclaimer">
        Los totales suman actividades individuales y resúmenes semanales, incluso si coinciden.
        Si un resumen ya incluye una actividad, se contará dos veces.
        Los períodos siguen las fechas de tus resúmenes, no semanas de calendario.
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
            <div className="panel analysis-chart-panel trend-chart-panel activity-bar-panel">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">PERÍODOS DE 7 DÍAS</div>
                  <h2>{metric.label} por semana</h2>
                </div>
                <span className="goal-caption">{metric.unit} · fecha final del período</span>
              </div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={points} barCategoryGap="28%" margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
                    <defs>
                      <linearGradient id={`${gradientId}-single`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#52a985" />
                        <stop offset="100%" stopColor="#307a58" />
                      </linearGradient>
                      <linearGradient id={`${gradientId}-weekly`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6d9de0" />
                        <stop offset="100%" stopColor="#3d6fb4" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="2 6" vertical={false} stroke="var(--line)" />
                    <XAxis
                      dataKey="date"
                      axisLine={false}
                      tickLine={false}
                      minTickGap={30}
                      tickMargin={12}
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
                    <Tooltip cursor={{ fill: "var(--green-soft)", opacity: 0.35 }} content={({ active, payload }) => {
                      const point = payload?.[0]?.payload as (typeof points)[number] | undefined
                      if (!active || !point) return null
                      return (
                        <div className="activity-chart-tooltip">
                          <strong>{point.range}</strong>
                          {point.single != null && <div><span>Individuales</span><b>{formatDecimal(point.single)} {metric.unit}</b></div>}
                          {point.weekly != null && <div><span>Resúmenes</span><b>{formatDecimal(point.weekly)} {metric.unit}</b></div>}
                          <div className="activity-tooltip-total"><span>Total</span><b>{formatDecimal(point.total)} {metric.unit}</b></div>
                        </div>
                      )
                    }} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ paddingTop: 16, fontSize: 11 }} />
                    {hasSingle && (
                      <Bar dataKey="single" name="Individuales" stackId="total" fill={`url(#${gradientId}-single)`}
                        legendType="circle" maxBarSize={44} radius={hasWeekly ? [0, 0, 0, 0] : [5, 5, 0, 0]} />
                    )}
                    {hasWeekly && (
                      <Bar dataKey="weekly" name="Resúmenes semanales" stackId="total" fill={`url(#${gradientId}-weekly)`}
                        legendType="circle" maxBarSize={44} radius={[5, 5, 0, 0]} />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          {!points.length && <p className="module-hint">No hay datos de {metric.label.toLowerCase()} en este período.</p>}
          <p className="activity-disclaimer activity-chart-note">
            Cada resumen cubre los siete días que terminan en su fecha. Las actividades individuales se asignan
            a un único período coincidente; fuera de ellos se usan bloques de siete días anclados al último resumen
            (o a hoy si no hay resúmenes). Los períodos sin medidas no se representan como cero.
          </p>
        </>
      )}
    </section>
  )
}
