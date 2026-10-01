import { api, type DoseEntry, type JournalEntry, type Medication } from "../api"

export const estimatedNextDose = (medication: Medication, doses: DoseEntry[]) => {
  if (!medication.dosing_interval) return null
  const lastDose = doses.find(
    (dose) => dose.medication_id === medication.id && new Date(dose.administered_at).getTime() <= Date.now(),
  )
  return lastDose
    ? new Date(
        new Date(lastDose.administered_at).getTime() + (medication.dosing_interval === "weekly" ? 7 : 1) * 86400000,
      ).toISOString()
    : null
}
export const weeklyActivityChecklistDate = (entry: JournalEntry) => {
  if (entry.data.entry_type !== "weekly" || entry.data.week_end != null) return entry.occurred_at
  const legacyWeekEnd = new Date(entry.occurred_at)
  legacyWeekEnd.setUTCDate(legacyWeekEnd.getUTCDate() + 6)
  return new Date(Math.min(legacyWeekEnd.getTime(), Date.now())).toISOString()
}
export async function loadAllRecords<T>(path: string, token: string, pageSize = 500): Promise<T[]> {
  const records: T[] = []
  let offset = 0
  while (true) {
    const separator = path.includes("?") ? "&" : "?"
    const page = await api<T[]>(`${path}${separator}limit=${pageSize}&offset=${offset}`, token)
    records.push(...page)
    if (page.length < pageSize) return records
    offset += pageSize
  }
}
export const compositionFields = [
  ["body_fat_percent", "Grasa corporal", "%", 100, 0.1],
  ["fat_free_mass_kg", "Masa libre de grasa", "kg", 500, 0.1],
  ["subcutaneous_fat_percent", "Grasa subcutánea", "%", 100, 0.1],
  ["visceral_fat_index", "Grasa visceral (índice)", "índice", 1000, 0.1],
  ["body_water_percent", "Agua corporal", "%", 100, 0.1],
  ["skeletal_muscle_percent", "Músculo esquelético", "%", 100, 0.1],
  ["muscle_mass_kg", "Masa muscular", "kg", 500, 0.1],
  ["bone_mass_kg", "Masa ósea", "kg", 100, 0.1],
  ["protein_percent", "Proteína", "%", 100, 0.1],
  ["bmr_kcal", "Metabolismo basal", "kcal", 20000, 0.01],
  ["metabolic_age", "Edad metabólica", "años", 150, 1],
] as const
