export function doseCountsByMedication(doses, now = Date.now()) {
  const grouped = new Map()
  for (const dose of doses) {
    if (new Date(dose.administered_at).getTime() > now) continue
    const medicationDoses = grouped.get(dose.medication_id) ?? []
    medicationDoses.push(dose)
    grouped.set(dose.medication_id, medicationDoses)
  }

  return new Map(
    [...grouped].map(([medicationId, medicationDoses]) => {
      medicationDoses.sort(
        (first, second) =>
          new Date(first.administered_at).getTime() - new Date(second.administered_at).getTime() ||
          first.id - second.id,
      )
      const latestDose = medicationDoses.at(-1)
      const latestDoseKey = `${latestDose.dose_amount}:${latestDose.dose_unit}`
      let latestDoseCount = 0
      for (let index = medicationDoses.length - 1; index >= 0; index -= 1) {
        const dose = medicationDoses[index]
        if (`${dose.dose_amount}:${dose.dose_unit}` !== latestDoseKey) break
        latestDoseCount += 1
      }

      return [
        medicationId,
        {
          totalCount: medicationDoses.length,
          latestDose,
          latestDoseCount,
          hasDoseChanges: medicationDoses.some(
            (dose) => `${dose.dose_amount}:${dose.dose_unit}` !== latestDoseKey,
          ),
        },
      ]
    }),
  )
}
