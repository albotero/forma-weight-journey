import { useState, type ReactNode } from "react"
import { measurementPointsInPeriod, measurementStats, type MeasurementPoint } from "../../lib/measurements.js"
import { formatDateTime, formatDecimal } from "../../lib/format"
import { MetricTrendCharts } from "./MetricTrendCharts"

export type MeasurementSeries = {
  id: string
  label: string
  unit: string
  points: MeasurementPoint[]
}

export function MeasurementOverview({
  title,
  series,
  timezone,
  renderChart,
}: {
  title: string
  series: MeasurementSeries[]
  timezone: string
  renderChart?: (selected: MeasurementSeries) => ReactNode
}) {
  const [selectedId, setSelectedId] = useState("")
  const [weeks, setWeeks] = useState<number | null>(4)
  const available = series.filter(({ points }) => points.length > 0)
  const selected = available.find(({ id }) => id === selectedId) ?? available[0]
  const dateFormatter = new Intl.DateTimeFormat("es-CO", {
    day: "numeric", month: "short", year: "numeric", timeZone: timezone,
  })
  const filtered = selected && {
    ...selected,
    points: measurementPointsInPeriod(selected.points, timezone, weeks)
      .map((point) => ({ ...point, date: dateFormatter.format(new Date(point.occurredAt)) })),
  }
  const stats = measurementStats(filtered?.points ?? [])
  const latestPoint = filtered?.points.at(-1)
  const valueLabel = (value: number | null) =>
    value === null ? "Sin datos" : `${formatDecimal(value)}${selected?.unit ? ` ${selected.unit}` : ""}`

  return (
    <section className="measurement-overview" aria-label={`Resumen de ${title.toLowerCase()}`}>
      <div className="activity-summary-heading">
        <h2 className="module-subheading">{title}</h2>
        <div className="range-select" role="group" aria-label={`Período de ${title.toLowerCase()}`}>
          {[
            { value: 1, label: "Esta semana" },
            { value: 4, label: "4 semanas" },
            { value: 12, label: "12 semanas" },
            { value: null, label: "Todo" },
          ].map(({ value, label }) => (
            <button
              key={label}
              type="button"
              className={weeks === value ? "selected" : ""}
              aria-pressed={weeks === value}
              onClick={() => setWeeks(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {available.length > 0 && (
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
          {
            label: "Último valor",
            value: valueLabel(stats.latest),
            detail: latestPoint ? formatDateTime(latestPoint.occurredAt, timezone) : "Sin lecturas en el período",
          },
          {
            label: "Cambio entre últimas lecturas",
            value: `${stats.change != null && stats.change > 0 ? "+" : ""}${valueLabel(stats.change)}`,
            detail: "No representa un objetivo clínico",
          },
          {
            label: "Promedio del período",
            value: valueLabel(stats.average),
            detail: "Promedio de las lecturas disponibles",
          },
          {
            label: "Lecturas",
            value: formatDecimal(stats.count),
            detail: selected?.label ?? "Sin medidas registradas",
          },
        ].map(({ label, value, detail }) => (
          <article className="panel activity-total-card" key={label}>
            <h3>{label}</h3>
            <strong>{value}</strong>
            <p className="module-hint">{detail}</p>
          </article>
        ))}
      </div>
      {filtered?.points.length ? (
        renderChart ? renderChart(filtered) : (
          <MetricTrendCharts
            key={filtered.id}
            title={filtered.label}
            hideLegend
            series={[filtered]}
          />
        )
      ) : (
        <p className="module-hint">
          {selected ? "No hay lecturas de esta medida en el período. Elige otro período." : "Registra medidas para ver su evolución."}
        </p>
      )}
      <p className="module-hint">
        Las tarjetas y la gráfica muestran la medida seleccionada. Las lecturas no se suman;
        los campos vacíos no se estiman. El historial completo permanece debajo.
      </p>
    </section>
  )
}
