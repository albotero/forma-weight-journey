import {
  CartesianGrid,
  Legend,
  Line,
  LineChart as RechartsLineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
  XAxis,
  YAxis,
} from "recharts"
import type { CatalogItem, CatalogResult, JournalEntry } from "../../api"
import { formatDate, formatDecimal, niceAxis, formatAxisTick } from "../../lib/format"
import { EmptyModule } from "../common/Empty"

export function LabEvolutionCharts({
  entries,
  catalog,
  timezone,
}: {
  entries: JournalEntry[]
  catalog: CatalogItem[]
  timezone: string
}) {
  const series = catalog
    .map((item) => {
      const points = entries
        .filter((entry) => Array.isArray(entry.data.results))
        .flatMap((entry) => {
          const result = (entry.data.results as CatalogResult[]).find((row) => row.catalog_item_id === item.id)
          if (!result || (!item.is_blood_pressure && result.value == null)) return []
          return [
            {
              date: formatDate(entry.occurred_at, timezone),
              occurred_at: entry.occurred_at,
              value: result.value,
              systolic: result.systolic,
              diastolic: result.diastolic,
              mean: result.mean,
            },
          ]
        })
        .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
      return { item, points }
    })
    .filter((series) => series.points.length > 0)

  if (!series.length) {
    return <EmptyModule text="Registra resultados numéricos para ver la evolución de cada prueba." />
  }

  const yAxis = (
    item: CatalogItem,
    points: (typeof series)[number]["points"],
  ): { domain: [number, number]; ticks: number[] } => {
    const numericValues = item.is_blood_pressure
      ? points.flatMap((point) => [point.systolic, point.diastolic, point.mean])
      : points.map((point) => point.value)
    const thresholds = item.is_blood_pressure
      ? [item.normal_min, item.normal_max, item.diastolic_normal_min, item.diastolic_normal_max]
      : [item.normal_min, item.normal_max]
    const domainValues = [...numericValues, ...thresholds].filter((value): value is number => value != null)
    return niceAxis(domainValues)
  }

  const rangeText = (min: number | null, max: number | null, unit: string | null) => {
    if (min != null && max != null) return `${formatDecimal(min)}–${formatDecimal(max)}${unit ? ` ${unit}` : ""}`
    if (max != null) return `hasta ${formatDecimal(max)}${unit ? ` ${unit}` : ""}`
    if (min != null) return `desde ${formatDecimal(min)}${unit ? ` ${unit}` : ""}`
    return null
  }
  const normalRangeLabel = (item: CatalogItem) => {
    if (item.is_blood_pressure) {
      const systolic = rangeText(item.normal_min, item.normal_max, item.unit)
      const diastolic = rangeText(item.diastolic_normal_min, item.diastolic_normal_max, item.unit)
      const parts = [
        systolic && `Sistólica normal: ${systolic}`,
        diastolic && `Diastólica normal: ${diastolic}`,
      ].filter(Boolean)
      return parts.length ? parts.join(" · ") : null
    }
    const value = rangeText(item.normal_min, item.normal_max, item.unit)
    return value ? `Normal: ${value}` : null
  }
  const normalRangeGuides = (min: number | null, max: number | null, color: string) => {
    if (min != null && max != null) {
      return (
        <ReferenceArea
          y1={min}
          y2={max}
          fill={color}
          fillOpacity={0.08}
          stroke={color}
          strokeOpacity={0.3}
          strokeDasharray="4 3"
          ifOverflow="extendDomain"
        />
      )
    }
    // Recharts discards reference lines/areas outside the auto domain unless told to extend it
    if (min != null) return <ReferenceLine y={min} stroke={color} strokeDasharray="4 3" ifOverflow="extendDomain" />
    if (max != null) return <ReferenceLine y={max} stroke={color} strokeDasharray="4 3" ifOverflow="extendDomain" />
    return null
  }
  const withinNormal = (value: number | null, min: number | null, max: number | null) => {
    if (value == null) return null
    if (min != null && value < min) return false
    if (max != null && value > max) return false
    return true
  }
  const statusColor = (status: boolean | null, normalColor: string, alteredColor: string) =>
    status === false ? alteredColor : normalColor
  // Recharts draws type="monotone" curves with d3's curveMonotoneX, which fits a cubic Hermite
  // spline through the points via Steffen's method. Reproduce those per-point tangents (assuming
  // uniform category spacing) so the gradient crossing point matches the actual rendered curve.
  const monotoneTangents = (values: number[]) => {
    const n = values.length
    const tangents = new Array(n).fill(0)
    if (n < 2) return tangents
    const secants = values.slice(1).map((value, index) => value - values[index])
    for (let index = 1; index < n - 1; index += 1) {
      const s0 = secants[index - 1]
      const s1 = secants[index]
      const p = (s0 + s1) / 2
      const sign0 = s0 < 0 ? -1 : 1
      const sign1 = s1 < 0 ? -1 : 1
      tangents[index] = (sign0 + sign1) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0
    }
    tangents[0] = n > 2 ? (3 * secants[0] - tangents[1]) / 2 : secants[0]
    tangents[n - 1] = n > 2 ? (3 * secants[n - 2] - tangents[n - 2]) / 2 : secants[0]
    return tangents
  }
  const bezierValue = (c0: number, c1: number, c2: number, c3: number, u: number) => {
    const inverse = 1 - u
    return c0 * inverse ** 3 + 3 * c1 * inverse ** 2 * u + 3 * c2 * inverse * u ** 2 + c3 * u ** 3
  }
  // Bisection is safe here because monotone interpolation guarantees no overshoot between points
  const solveBezierCrossing = (c0: number, c1: number, c2: number, c3: number, threshold: number) => {
    const increasing = c3 >= c0
    let lo = 0
    let hi = 1
    for (let iteration = 0; iteration < 30; iteration += 1) {
      const mid = (lo + hi) / 2
      const below = bezierValue(c0, c1, c2, c3, mid) < threshold
      if (increasing === below) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  }
  const thresholdCrossed = (from: number, to: number, min: number | null, max: number | null) => {
    if (min != null && from < min !== to < min) return min
    if (max != null && from > max !== to > max) return max
    return (from + to) / 2
  }
  // Builds a hard-stop gradient so a single smooth curve can change solid color exactly where
  // the value crosses the normal-range threshold, instead of at the data point marker
  const segmentGradient = (
    gradientId: string,
    points: (typeof series)[number]["points"],
    min: number | null,
    max: number | null,
  ) => {
    const statuses = points.map((point) => withinNormal(point.value, min, max))
    const values = points.map((point) => point.value)
    const tangents = monotoneTangents(values.map((value) => value ?? 0))
    const segmentCount = Math.max(points.length - 1, 1)
    const stops: { offset: number; color: string }[] = []
    for (let index = 0; index < segmentCount; index += 1) {
      const startOffset = index / segmentCount
      const endOffset = (index + 1) / segmentCount
      const startColor = statusColor(statuses[index] ?? null, "#398766", "#c0554d")
      const endColor = statusColor(statuses[index + 1] ?? statuses[index] ?? null, "#398766", "#c0554d")
      const fromValue = values[index]
      const toValue = values[index + 1]
      if (startColor === endColor || fromValue == null || toValue == null) {
        stops.push({ offset: startOffset, color: startColor }, { offset: endOffset, color: startColor })
        continue
      }
      const threshold = thresholdCrossed(fromValue, toValue, min, max)
      const dx = 1 / 3
      const c0 = fromValue
      const c1 = fromValue + dx * tangents[index]
      const c2 = toValue - dx * tangents[index + 1]
      const c3 = toValue
      const crossFraction = solveBezierCrossing(c0, c1, c2, c3, threshold)
      const crossOffset = startOffset + (endOffset - startOffset) * crossFraction
      stops.push(
        { offset: startOffset, color: startColor },
        { offset: crossOffset, color: startColor },
        { offset: crossOffset, color: endColor },
        { offset: endOffset, color: endColor },
      )
    }
    return (
      <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
        {stops.map((stop, index) => (
          <stop key={index} offset={stop.offset} stopColor={stop.color} />
        ))}
      </linearGradient>
    )
  }
  const statusDot =
    (color: (payload: { value: number | null }) => string) =>
    (dotProps: { key?: string; cx?: number; cy?: number; payload?: { value: number | null } }) => {
      const { key, cx = 0, cy = 0, payload } = dotProps
      if (!payload) return <circle key={key} cx={cx} cy={cy} r={0} />
      return <circle key={key} cx={cx} cy={cy} r={3.5} fill={color(payload)} stroke={color(payload)} />
    }
  // A fixed dot object without strokeDasharray, since Line spreads its own (possibly dashed)
  // props into each dot and would otherwise leave a dashed ring around a solid-filled dot
  const seriesDot = (color: string) => ({ fill: color, stroke: color, r: 3.5, strokeDasharray: "0" })
  const seriesColor = (item: CatalogItem, dataKey: string, value: number | null) => {
    if (dataKey === "systolic") return "#ad8a50"
    if (dataKey === "diastolic") return "#3d6fb4"
    if (dataKey === "mean") return "#7a54bf"
    return statusColor(withinNormal(value, item.normal_min, item.normal_max), "#398766", "#c0554d")
  }
  const labTooltip =
    (item: CatalogItem) =>
    ({ active, label, payload }: TooltipProps<number, string>) => {
      if (!active || !payload?.length) return null
      const visible = payload.filter((entry) => entry.value != null)
      if (!visible.length) return null
      return (
        <div className="lab-tooltip">
          <strong>{label}</strong>
          {visible.map((entry) => (
            <div key={String(entry.dataKey)}>
              <span>{entry.name}</span>
              <strong style={{ color: seriesColor(item, String(entry.dataKey), Number(entry.value)) }}>
                {formatDecimal(Number(entry.value))}
                {item.unit ? ` ${item.unit}` : ""}
              </strong>
            </div>
          ))}
        </div>
      )
    }

  return (
    <div className="lab-charts-grid">
      {series.map(({ item, points }) => {
        const { domain, ticks } = yAxis(item, points)
        const gradientId = `lab-gradient-${item.id}`
        return (
          <div className="panel analysis-chart-panel" key={item.id}>
            <div className="panel-heading">
              <div>
                <div className="eyebrow">EVOLUCIÓN</div>
                <h2>{item.name}</h2>
              </div>
              <span className="goal-caption">
                {points.length} {points.length === 1 ? "registro" : "registros"}
              </span>
            </div>
            {normalRangeLabel(item) && <p className="module-hint">{normalRangeLabel(item)}</p>}
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <RechartsLineChart data={points} margin={{ top: 20, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    {!item.is_blood_pressure && segmentGradient(gradientId, points, item.normal_min, item.normal_max)}
                  </defs>
                  <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--line)" />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                    minTickGap={30}
                  />
                  <YAxis
                    domain={domain}
                    ticks={ticks}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                    tickFormatter={(value) => formatAxisTick(Number(value))}
                  />
                  <Tooltip content={labTooltip(item)} />
                  {item.is_blood_pressure ? (
                    <>
                      {normalRangeGuides(item.normal_min, item.normal_max, "#ad8a50")}
                      {normalRangeGuides(item.diastolic_normal_min, item.diastolic_normal_max, "#3d6fb4")}
                    </>
                  ) : (
                    normalRangeGuides(item.normal_min, item.normal_max, "#398766")
                  )}
                  {item.is_blood_pressure ? (
                    <>
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="systolic"
                        name="Sistólica"
                        stroke="#ad8a50"
                        strokeWidth={2.4}
                        dot={seriesDot("#ad8a50")}
                      />
                      <Line
                        type="monotone"
                        dataKey="diastolic"
                        name="Diastólica"
                        stroke="#3d6fb4"
                        strokeWidth={2.4}
                        dot={seriesDot("#3d6fb4")}
                      />
                      <Line
                        type="monotone"
                        dataKey="mean"
                        name="Media"
                        stroke="#7a54bf"
                        strokeWidth={2.4}
                        strokeDasharray="4 3"
                        dot={seriesDot("#7a54bf")}
                      />
                    </>
                  ) : (
                    <Line
                      type="monotone"
                      dataKey="value"
                      name={item.name}
                      stroke={`url(#${gradientId})`}
                      strokeWidth={2.4}
                      dot={statusDot((payload) =>
                        statusColor(
                          withinNormal(payload.value, item.normal_min, item.normal_max),
                          "#398766",
                          "#c0554d",
                        ),
                      )}
                    />
                  )}
                </RechartsLineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )
      })}
    </div>
  )
}
