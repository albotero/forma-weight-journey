import { useState, type ReactNode } from "react"
import { measurementPointsInPeriod, measurementStats, type MeasurementPoint } from "../../lib/measurements.js"
import { formatDateTime, formatDecimal } from "../../lib/format"
import { MetricTrendCharts } from "./MetricTrendCharts"
import { chartPeriods, type ChartPeriod } from "../../lib/chartPeriod.js"

export type MeasurementSeries = {
  id: string
  label: string
  unit: string
  dashed?: boolean
  points: MeasurementPoint[]
}

export function MeasurementOverview({
  title,
  series,
  timezone,
  renderChart,
  defaultPeriod = "90d",
  combined = false,
  showChart = true,
}: {
  title: string
  series: MeasurementSeries[]
  timezone: string
  renderChart?: (selected: MeasurementSeries, visibleSeries: MeasurementSeries[]) => ReactNode
  defaultPeriod?: ChartPeriod
  combined?: boolean
  showChart?: boolean
}) {
  const [selectedId, setSelectedId] = useState("")
  const [period, setPeriod] = useState<ChartPeriod>(defaultPeriod)
  const available = series.filter(({ points }) => points.length > 0)
  const selected = available.find(({ id }) => id === selectedId) ?? available[0]
  const dateFormatter = new Intl.DateTimeFormat("es-CO", {
    day: "numeric", month: "short", year: "numeric", timeZone: timezone,
  })
  const visibleSeries = (combined ? series : selected ? [selected] : []).map((item) => ({
    ...item,
    points: measurementPointsInPeriod(item.points, timezone, period)
      .map((point) => ({ ...point, date: dateFormatter.format(new Date(point.occurredAt)) })),
  }))
  const filtered = visibleSeries[0]
  const summaries = visibleSeries.map((item) => ({
    ...item, stats: measurementStats(item.points), latestPoint: item.points.at(-1),
  }))
  const valueLabel = (value: number | null, unit: string) =>
    value === null ? "Sin datos" : `${formatDecimal(value)}${unit ? ` ${unit}` : ""}`

  return (
    <section className="measurement-overview" aria-label={`Resumen de ${title.toLowerCase()}`}>
      <div className="activity-summary-heading">
        <h2 className="module-subheading">{title}</h2>
        <div className="range-select" role="group" aria-label={`Período de ${title.toLowerCase()}`}>
          {chartPeriods.map(({ value, label }) => (
            <button
              key={label}
              type="button"
              className={period === value ? "selected" : ""}
              aria-pressed={period === value}
              onClick={() => setPeriod(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {!combined && available.length > 1 && (
        <div className="range-select measurement-tabs" role="group" aria-label={`Métrica de ${title.toLowerCase()}`}>
          {available.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={selected?.id === id ? "selected" : ""}
              aria-pressed={selected?.id === id}
              onClick={() => setSelectedId(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="activity-total-grid">
        {[
          { key: "latest" as const, label: "Último valor", detail: "Última lectura disponible en el período" },
          { key: "change" as const, label: "Cambio entre últimas lecturas", detail: "No representa un objetivo clínico" },
          { key: "average" as const, label: "Promedio del período", detail: "Promedio de las lecturas disponibles" },
          { key: "count" as const, label: "Lecturas", detail: "Número de valores disponibles" },
        ].map(({ key, label, detail }) => (
          <article className="panel activity-total-card" key={label}>
            <h3>{label}</h3>
            {combined && summaries.length > 0 ? (
              <dl className="measurement-card-values">
                {summaries.map(({ id, label: metricLabel, unit, stats, latestPoint }) => (
                  <div key={id}>
                    <dt>{metricLabel}</dt>
                    <dd>
                      <strong>
                        {key === "count" ? formatDecimal(stats.count) :
                          `${key === "change" && stats.change != null && stats.change > 0 ? "+" : ""}${valueLabel(stats[key], unit)}`}
                      </strong>
                      {key === "latest" && latestPoint && <small>{formatDateTime(latestPoint.occurredAt, timezone)}</small>}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <strong>
                {summaries[0] ? key === "count" ? formatDecimal(summaries[0].stats.count) :
                  `${key === "change" && summaries[0].stats.change != null && summaries[0].stats.change > 0 ? "+" : ""}${valueLabel(summaries[0].stats[key], summaries[0].unit)}`
                  : key === "count" ? "0" : "Sin datos"}
              </strong>
            )}
            <p className="module-hint">{detail}</p>
          </article>
        ))}
      </div>
      {showChart && (visibleSeries.some(({ points }) => points.length > 0) ? (
        renderChart ? renderChart(filtered, visibleSeries) : (
          <MetricTrendCharts
            key={combined ? title : filtered.id}
            title={combined ? title : filtered.label}
            hideLegend={!combined}
            series={visibleSeries}
          />
        )
      ) : (
        <p className="module-hint">
          {selected ? "No hay lecturas de esta medida en el período. Elige otro período." : "Registra medidas para ver su evolución."}
        </p>
      ))}
      <p className="activity-disclaimer">
        {!showChart
          ? "Las tarjetas resumen las lecturas registradas."
          : combined
          ? "Las tarjetas y la gráfica comparan todas las series."
          : "Las tarjetas y la gráfica muestran la medida seleccionada."} Las lecturas no se suman;
        los campos vacíos no se estiman. El historial completo permanece debajo.
      </p>
    </section>
  )
}
