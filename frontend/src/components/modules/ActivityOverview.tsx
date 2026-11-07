import { useId, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { activityMetrics, type ActivityMetricKey, type summarizeActivity } from "../../lib/activity.js"
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
  const [weekWindowEnd, setWeekWindowEnd] = useState<string | null>(null)
  const gradientId = useId().replaceAll(":", "")
  const metric = activityMetrics.find(({ key }) => key === metricKey)!
  const averagePerWeek = (key: ActivityMetricKey) => {
    const values = summary.weeks.map((week) => week.metrics[key].total).filter((value) => value !== null)
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  }
  const weeksWithData = (key: ActivityMetricKey) =>
    summary.weeks.filter((week) => week.metrics[key].total !== null).length
  const weeklyAverages = Object.fromEntries(
    activityMetrics.map(({ key }) => [key, averagePerWeek(key)]),
  ) as Record<ActivityMetricKey, number | null>
  const calorieWeeks = summary.weeks.filter((week) => week.metrics.calories_kcal.total !== null)
  const recordedCaloriesPerWeek = calorieWeeks.length
    ? calorieWeeks.reduce((sum, week) => sum + (week.metrics.calories_kcal.total ?? 0) - (week.estimatedCalories ?? 0), 0) /
      calorieWeeks.length
    : null
  const estimatedCaloriesPerWeek = calorieWeeks.length
    ? calorieWeeks.reduce((sum, week) => sum + (week.estimatedCalories ?? 0), 0) / calorieWeeks.length
    : null
  const dateLabel = (day: string) =>
    `${formatDate(localDateTimeToIso(`${day}T12:00`, timezone), timezone)} ${day.slice(0, 4)}`
  const display = (value: number | null) => (value === null ? "Sin datos" : formatDecimal(value))
  const points = summary.weeks.map((week) => {
    const values = week.metrics[metricKey]
    return {
      date: formatDate(localDateTimeToIso(`${week.end}T12:00`, timezone), timezone),
      startLabel: dateLabel(week.start),
      endLabel: dateLabel(week.end),
      end: week.end,
      range: `${dateLabel(week.start)} – ${dateLabel(week.end)}`,
      single: values.single,
      estimated: metricKey === "calories_kcal" ? week.estimatedCalories : null,
      weekly: values.weekly,
      total: values.total,
    }
  })
  const selectedEndIndex = weekWindowEnd === null ? -1 : points.findIndex(({ end }) => end === weekWindowEnd)
  const windowEndIndex = selectedEndIndex >= 0 ? selectedEndIndex : points.length - 1
  const windowStartIndex = Math.max(0, windowEndIndex - 5)
  const windowPoints = points.slice(windowStartIndex, windowEndIndex + 1)
  const windowHasMetricData = windowPoints.some(({ total }) => total !== null)
  const hasMetricData = points.some(({ total }) => total !== null)
  const hasSingle = windowPoints.some(({ single }) => single !== null)
  const hasWeekly = windowPoints.some(({ weekly }) => weekly !== null)
  const chartAverage = weeklyAverages[metricKey]

  return (
    <section className="activity-overview" aria-label="Resumen de actividad">
      <div className="activity-summary-heading">
        <div>
          <h2 className="module-subheading">Tu actividad en cifras</h2>
          <p className="module-hint">
            {summary.start ? `${dateLabel(summary.start)} – ${dateLabel(summary.end)}` : "Todo el historial hasta hoy"}
            {" · "}
            {summary.singleCount} {summary.singleCount === 1 ? "actividad individual" : "actividades individuales"}
            {" · "}
            {summary.weeklyCount} {summary.weeklyCount === 1 ? "resumen semanal" : "resúmenes semanales"}
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
        Los totales suman actividades individuales y resúmenes semanales, incluso si coinciden. Si un resumen ya incluye
        una actividad, se contará dos veces. Los períodos siguen las fechas de tus resúmenes, no semanas de calendario.{" "}
          Si faltan calorías, se estiman con MET, duración y el último peso registrado anterior a la actividad. En
          bicicleta GPS se usan velocidad y ascenso (eficiencia mecánica supuesta del 23%); las estimaciones son
          orientativas.
        Yoga/Pilates y Otro no se estiman. Son estimaciones de gasto total, incluido el reposo, no mediciones ni
        calorías activas de un reloj. Los pasos y la distancia no se estiman.
      </p>
      {summary.invalidMeasurementCount > 0 && (
        <p className="error-banner" role="alert">
          Algunas medidas de este período no son válidas ({summary.invalidMeasurementCount}). No se incluyeron en los
          totales; revisa y corrige los registros.
        </p>
      )}
      <div className="activity-total-grid">
        {activityMetrics.map(({ key, label, unit }) => (
          <article className="panel activity-total-card" key={key}>
            <h3>{label}</h3>
            <strong>{display(weeklyAverages[key])}</strong>
            {weeklyAverages[key] !== null && <span className="activity-total-unit">{unit} / semana</span>}
            <dl>
              {key === "calories_kcal" && (
                <>
                  <div>
                    <dt>Registradas / semana</dt>
                    <dd>{display(recordedCaloriesPerWeek)}</dd>
                  </div>
                  <div>
                    <dt>Estimadas / semana</dt>
                    <dd>{display(estimatedCaloriesPerWeek)}</dd>
                  </div>
                  <div>
                    <dt>Semanas con datos</dt>
                    <dd>{weeksWithData(key)}</dd>
                  </div>
                </>
              )}
              {key !== "calories_kcal" && (
                <div>
                  <dt>Semanas con datos</dt>
                  <dd>{weeksWithData(key)}</dd>
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
          {points.length > 0 && hasMetricData && (
            <div className="panel analysis-chart-panel trend-chart-panel activity-bar-panel">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">PERÍODOS DE 7 DÍAS</div>
                  <h2>{metric.label} por semana</h2>
                </div>
                <span className="goal-caption">
                  {chartAverage === null
                    ? `${metric.unit} · período de 7 días`
                    : `Promedio semanal: ${formatDecimal(chartAverage)} ${metric.unit}`}
                </span>
              </div>
              <div className="activity-week-navigation" aria-label="Navegar por semanas">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Ver semanas anteriores"
                  title="Ver semanas anteriores"
                  disabled={windowStartIndex === 0}
                  onClick={() => setWeekWindowEnd(points[windowEndIndex - 1]?.end ?? null)}
                >
                  <ChevronLeft size={17} />
                </button>
                <span>
                  {windowPoints[0].startLabel} – {windowPoints.at(-1)!.endLabel}
                </span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Ver semanas siguientes"
                  title="Ver semanas siguientes"
                  disabled={windowEndIndex >= points.length - 1}
                  onClick={() => setWeekWindowEnd(points[windowEndIndex + 1]?.end ?? null)}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
              {windowHasMetricData ? (
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={windowPoints} barCategoryGap="28%" margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
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
                    {chartAverage !== null && (
                      <ReferenceLine y={chartAverage} stroke="#a65e43" strokeDasharray="5 5" />
                    )}
                    <Tooltip
                      cursor={{ fill: "var(--green-soft)", opacity: 0.35 }}
                      content={({ active, payload }) => {
                        const point = payload?.[0]?.payload as (typeof points)[number] | undefined
                        if (!active || !point) return null
                        return (
                          <div className="activity-chart-tooltip">
                            <strong>{point.range}</strong>
                            {point.single != null && (
                              <div>
                                <span>Individuales</span>
                                <b>
                                  {formatDecimal(point.single)} {metric.unit}
                                </b>
                              </div>
                            )}
                            {point.estimated != null && (
                              <div>
                                <span>De ellas, estimadas</span>
                                <b>{formatDecimal(point.estimated)} kcal</b>
                              </div>
                            )}
                            {point.weekly != null && (
                              <div>
                                <span>Resúmenes</span>
                                <b>
                                  {formatDecimal(point.weekly)} {metric.unit}
                                </b>
                              </div>
                            )}
                            <div className="activity-tooltip-total">
                              <span>Total</span>
                              <b>
                                {point.total === null
                                  ? "Sin datos"
                                  : `${formatDecimal(point.total)} ${metric.unit}`}
                              </b>
                            </div>
                          </div>
                        )
                      }}
                    />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ paddingTop: 16, fontSize: 11 }} />
                    {hasWeekly && (
                      <Bar
                        dataKey="weekly"
                        name="Resúmenes semanales"
                        stackId="total"
                        fill={`url(#${gradientId}-weekly)`}
                        legendType="circle"
                        maxBarSize={44}
                        radius={hasSingle ? [0, 0, 0, 0] : [5, 5, 0, 0]}
                      />
                    )}
                    {hasSingle && (
                      <Bar
                        dataKey="single"
                        name={
                          metricKey === "calories_kcal" && summary.calories.estimatedCount > 0
                            ? "Individuales (incluye estimadas)"
                            : "Individuales"
                        }
                        stackId="total"
                        fill={`url(#${gradientId}-single)`}
                        legendType="circle"
                        maxBarSize={44}
                        radius={[5, 5, 0, 0]}
                      />
                    )}
                  </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="module-hint activity-week-empty">
                  No hay datos de {metric.label.toLowerCase()} en estas semanas. Puedes seguir navegando hacia atrás.
                </p>
              )}
            </div>
          )}
          {points.length > 0 && !hasMetricData && (
            <p className="module-hint">No hay datos de {metric.label.toLowerCase()} en este período.</p>
          )}
          {!points.length && (
            <p className="module-hint">No hay datos de {metric.label.toLowerCase()} en este período.</p>
          )}
          <p className="activity-disclaimer activity-chart-note">
            Cada resumen cubre los siete días que terminan en su fecha. Las actividades individuales se asignan a un
            único período coincidente; fuera de ellos se usan bloques de siete días anclados al último resumen (o a hoy
            si no hay resúmenes). Los períodos sin medidas no se representan como cero.
          </p>
        </>
      )}
    </section>
  )
}
