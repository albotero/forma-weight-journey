import { ReferenceArea } from "recharts"

export const bmiBands = [
  { label: "Bajo peso (<18,5)", from: 0, to: 18.5, color: "#dcebf1" },
  { label: "Peso saludable (18,5–24,9)", from: 18.5, to: 25, color: "#dcefe3" },
  { label: "Sobrepeso (25–29,9)", from: 25, to: 30, color: "#fff0c2" },
  { label: "Obesidad clase 1 (30–34,9)", from: 30, to: 35, color: "#f7e8d9" },
  { label: "Obesidad clase 2 (35–39,9)", from: 35, to: 40, color: "#f4d8d8" },
  { label: "Obesidad clase 3 (≥40)", from: 40, to: Infinity, color: "#e8def4" },
] as const

export function bmiRangeAreas(heightCm: number | undefined, domain: [number, number], age: number | null) {
  if (!heightCm || heightCm <= 0 || age === null || age < 18) return null
  const heightSquared = (heightCm / 100) ** 2
  return bmiBands.map(({ label, from, to, color }) => {
    const lower = Math.max(domain[0], from * heightSquared)
    const upper = Math.min(domain[1], to * heightSquared)
    return upper > lower ? (
      <ReferenceArea key={label} y1={lower} y2={upper} fill={color} fillOpacity={1} stroke="none" />
    ) : null
  })
}

export function BmiRangeLegend({ age }: { age: number | null }) {
  if (age === null || age < 18) return null
  return (
    <>
      <div className="bmi-range-legend">
        {bmiBands.map(({ label, color }) => (
          <span key={label}>
            <i style={{ backgroundColor: color }} />
            {label}
          </span>
        ))}
      </div>
      <p className="activity-disclaimer clinical-reference-note">
        Referencia adulta NICE. Los umbrales de BMI pueden ser menores para algunos grupos étnicos y requieren cautela
        en personas de 65 años o más.
      </p>
    </>
  )
}
