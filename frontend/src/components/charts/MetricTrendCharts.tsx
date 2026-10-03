import { useState } from "react"
import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { formatDecimal, niceAxis, formatAxisTick } from "../../lib/format"

export function MetricTrendCharts({
  series,
  title,
  rightAxisLabels = [],
  rightAxisLabel,
  hideLegend = false,
}: {
  series: {
    label: string
    unit: string
    points: { occurredAt: string; date: string; value: number }[]
  }[]
  title: string
  rightAxisLabels?: string[]
  rightAxisLabel?: string
  hideLegend?: boolean
}) {
  const [hidden, setHidden] = useState<string[]>([])
  const populated = series.filter(({ points }) => points.length)
  if (!populated.length) return null
  const times = [...new Set(populated.flatMap(({ points }) => points.map(({ occurredAt }) => occurredAt)))].sort()
  const chartData = times.map((occurredAt) => {
    const row: Record<string, string | number | null> = {
      occurredAt,
      date: populated.flatMap(({ points }) => points).find((point) => point.occurredAt === occurredAt)!.date,
    }
    populated.forEach(({ points }, index) => {
      const value = points.find((point) => point.occurredAt === occurredAt)?.value
      row[`metric_${index}`] = value ?? null
      row[`raw_${index}`] = value ?? null
    })
    return row
  })
  const metabolicIndex = title === "Composición corporal" ? populated.findIndex(({ unit }) => unit === "kcal") : -1
  const rightAxisIndexes = new Set(
    populated.flatMap(({ label }, index) =>
      index === metabolicIndex || rightAxisLabels.includes(label) ? [index] : [],
    ),
  )
  const values = chartData
    .flatMap((row) =>
      populated.flatMap(({ label }, index) =>
        hidden.includes(label) || rightAxisIndexes.has(index) ? [] : [row[`metric_${index}`]],
      ),
    )
    .filter((value): value is number => typeof value === "number")
  const { domain, ticks } = niceAxis(values, Math.max(0.01, Math.min(1, Math.max(...values) * 0.05)))
  const tickStep = ticks.length > 1 ? ticks[1] - ticks[0] : 1
  const rightAxisValues = chartData.flatMap((row) =>
    [...rightAxisIndexes].flatMap((index) =>
      hidden.includes(populated[index].label) || typeof row[`metric_${index}`] !== "number"
        ? []
        : [row[`metric_${index}`] as number],
    ),
  )
  const rightAxis = rightAxisValues.length ? niceAxis(rightAxisValues, 20) : null
  const rightAxisTickStep = rightAxis && rightAxis.ticks.length > 1 ? rightAxis.ticks[1] - rightAxis.ticks[0] : 1
  const colors = [
    "#398766",
    "#3d6fb4",
    "#c0554d",
    "#8757a5",
    "#ad8a50",
    "#2b9096",
    "#d47b45",
    "#708f44",
    "#c16b89",
    "#566e9c",
    "#927d61",
  ]
  return (
    <div className="panel analysis-chart-panel trend-chart-panel">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">EVOLUCIÓN</div>
          <h2>{title}</h2>
        </div>
        <span className="goal-caption">
          {rightAxis ? (rightAxisLabel ?? "kcal · eje derecho") : "Valores registrados"}
        </span>
      </div>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsLineChart data={chartData} margin={{ top: 20, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--line)" />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              minTickGap={30}
            />
            <YAxis
              yAxisId="values"
              domain={domain}
              ticks={ticks}
              hide={!values.length}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              tickFormatter={(value) => formatAxisTick(Number(value), tickStep)}
            />
            {rightAxis && (
              <YAxis
                yAxisId="right"
                orientation="right"
                width={48}
                domain={rightAxis.domain}
                ticks={rightAxis.ticks}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                tickFormatter={(value) => formatAxisTick(Number(value), rightAxisTickStep)}
              />
            )}
            <Tooltip
              formatter={(_value, name, item) => {
                const index = Number(String(item.dataKey).slice(7))
                return [`${formatDecimal(Number(item.payload[`raw_${index}`]))} ${populated[index].unit}`, name]
              }}
            />
            {populated.map(
              ({ label }, index) =>
                !hidden.includes(label) && (
                  <Line
                    key={label}
                    type="monotone"
                    dataKey={`metric_${index}`}
                    yAxisId={rightAxisIndexes.has(index) ? "right" : "values"}
                    name={label}
                    connectNulls
                    stroke={colors[index % colors.length]}
                    strokeWidth={2.2}
                    dot={{ fill: colors[index % colors.length], stroke: colors[index % colors.length], r: 2.5 }}
                  />
                ),
            )}
          </RechartsLineChart>
        </ResponsiveContainer>
      </div>
      {!hideLegend && (
        <div className="trend-series-legend">
          {populated.map(({ label, unit }, index) => (
            <button
              key={label}
              type="button"
              aria-pressed={!hidden.includes(label)}
              disabled={!hidden.includes(label) && hidden.length === populated.length - 1}
              onClick={() =>
                setHidden((current) =>
                  current.includes(label) ? current.filter((name) => name !== label) : [...current, label],
                )
              }
            >
              <i style={{ background: colors[index % colors.length] }} />
              {label} ({unit})
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
