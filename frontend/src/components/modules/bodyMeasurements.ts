import type { BodyMeasurementEntry } from "../../api"
import { formatDecimal } from "../../lib/format"

export const bodyFields = [
  ["neck_cm", "Cuello", "cm"],
  ["chest_cm", "Pecho", "cm"],
  ["arm_cm", "Brazo", "cm"],
  ["abdomen_cm", "Abdomen", "cm"],
  ["waist_cm", "Cintura", "cm"],
  ["hip_cm", "Cadera", "cm"],
  ["thigh_cm", "Muslo", "cm"],
] as const

export function summarizeBodyMeasurements(item: BodyMeasurementEntry) {
  const values = bodyFields
    .filter(([key]) => item[key] != null)
    .map(([key, label, unit]) => `${label} ${formatDecimal(item[key]!)} ${unit}`)
  return (
    [...values.slice(0, 2), ...(values.length > 2 ? [`+${values.length - 2} más`] : [])].join(" · ") ||
    "Medidas corporales"
  )
}
