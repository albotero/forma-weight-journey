export function ageOnDate(birthDate, today = new Date()) {
  if (typeof birthDate !== "string") return null
  const [year, month, day] = birthDate.split("-").map(Number)
  if (!year || !month || !day) return null
  const parsedBirthDate = new Date(Date.UTC(year, month - 1, day))
  if (
    parsedBirthDate.getUTCFullYear() !== year ||
    parsedBirthDate.getUTCMonth() + 1 !== month ||
    parsedBirthDate.getUTCDate() !== day
  ) return null
  const [referenceYear, referenceMonth, referenceDay] =
    typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today)
      ? today.split("-").map(Number)
      : today instanceof Date
        ? [today.getFullYear(), today.getMonth() + 1, today.getDate()]
        : (() => {
            const referenceDate = new Date(today)
            return Number.isFinite(referenceDate.getTime())
              ? [referenceDate.getFullYear(), referenceDate.getMonth() + 1, referenceDate.getDate()]
              : []
          })()
  if (!referenceYear || !referenceMonth || !referenceDay) return null
  let age = referenceYear - year
  if (
    referenceMonth < month ||
    (referenceMonth === month && referenceDay < day)
  ) {
    age -= 1
  }
  return age >= 0 ? age : null
}

const bodyFatReference = {
  female: [
    { minAge: 20, maxAge: 39, min: 21, max: 33 },
    { minAge: 40, maxAge: 59, min: 23, max: 34 },
    { minAge: 60, maxAge: 79, min: 24, max: 36 },
  ],
  male: [
    { minAge: 20, maxAge: 39, min: 8, max: 20 },
    { minAge: 40, maxAge: 59, min: 11, max: 22 },
    { minAge: 60, maxAge: 79, min: 13, max: 25 },
  ],
}

export function bodyFatClinicalBands(reference, birthDate, today = new Date()) {
  if (reference !== "female" && reference !== "male") return []
  const age = ageOnDate(birthDate, today)
  if (age === null || age < 20 || age > 79) return []
  const range = bodyFatReference[reference].find(({ minAge, maxAge }) => age >= minAge && age <= maxAge)
  if (!range) return []
  return [
    { from: 0, to: range.min, label: "Por debajo de la referencia publicada", color: "#dcebf1" },
    { from: range.min, to: range.max, label: "Intervalo de referencia publicado", color: "#dcefe8" },
    { from: range.max, to: 100, label: "Por encima de la referencia publicada", color: "#f7e8d9" },
  ]
}

export function waistHeightClinicalBands(heightCm, age, bmi) {
  if (!Number.isFinite(heightCm) || heightCm <= 0 || !Number.isInteger(age) || age < 18) return []
  if (!Number.isFinite(bmi) || bmi >= 35) return []
  return [
    { from: heightCm * 0.4, to: heightCm * 0.5, label: "Cintura/altura 0,40–0,49", color: "#dcefe8" },
    { from: heightCm * 0.5, to: heightCm * 0.6, label: "Cintura/altura 0,50–0,59", color: "#f7e8d9" },
    { from: heightCm * 0.6, to: Number.POSITIVE_INFINITY, label: "Cintura/altura ≥ 0,60", color: "#f4d8d8" },
  ]
}