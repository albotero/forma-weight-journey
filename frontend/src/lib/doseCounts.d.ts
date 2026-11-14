import type { DoseEntry } from "../api"

export function doseCountsByMedication(
  doses: DoseEntry[],
  now?: number,
): Map<
  number,
  {
    totalCount: number
    latestDose: DoseEntry
    latestDoseCount: number
    hasDoseChanges: boolean
  }
>
