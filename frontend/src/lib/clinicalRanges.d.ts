export type ClinicalRangeBand = { from: number; to: number; label: string; color: string }
export type BodyFatReference = "female" | "male" | null

export function ageOnDate(birthDate: string | null | undefined, today?: Date | string): number | null
export function bodyFatClinicalBands(
  reference: BodyFatReference,
  birthDate: string | null | undefined,
  today?: Date | string,
): ClinicalRangeBand[]
export function waistHeightClinicalBands(heightCm: number | null | undefined, age: number | null, bmi: number | null): ClinicalRangeBand[]