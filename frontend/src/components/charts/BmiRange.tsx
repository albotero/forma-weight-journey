import { ReferenceArea } from "recharts"

export const bmiBands = [
  { label: "Normal", from: 18.5, to: 25, color: "#4CD13D" },
  { label: "Sobrepeso", from: 25, to: 30, color: "#EEF21B" },
  { label: "Obesidad", from: 30, to: 40, color: "#FF6666" },
  { label: "Obesidad mórbida", from: 40, to: Infinity, color: "#B13DD1" },
] as const

export function bmiRangeAreas(heightCm: number | undefined, domain: [number, number]) {
  if (!heightCm || heightCm <= 0) return null
  const heightSquared = (heightCm / 100) ** 2
  return bmiBands.map(({ label, from, to, color }) => {
    const lower = Math.max(domain[0], from * heightSquared)
    const upper = Math.min(domain[1], to * heightSquared)
    return upper > lower ? (
      <ReferenceArea
        key={label}
        y1={lower}
        y2={upper}
        fill={color}
        fillOpacity={label === "Sobrepeso" ? 0.38 : 0.32}
        stroke="none"
      />
    ) : null
  })
}

export function BmiRangeLegend() {
  return (
    <div className="bmi-range-legend">
      {bmiBands.map(({ label, color }) => (
        <span key={label}>
          <i style={{ backgroundColor: color }} />
          {label}
        </span>
      ))}
    </div>
  )
}
