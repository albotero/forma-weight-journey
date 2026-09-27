export function dateTimeInputValue(value, timeZone = "America/Bogota") {
  const date = new Date(value)
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]))
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`
}

export function localDateTimeToIso(value, timeZone = "America/Bogota") {
  const match = /^\s*(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\s*$/.exec(value)
  if (!match) throw new Error("Selecciona una fecha y hora válidas.")

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0", fractionText = "0"] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const millisecond = Number(fractionText.padEnd(3, "0"))
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    throw new Error("Selecciona una fecha y hora válidas.")
  }

  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute)
  let guess = desiredUtc
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess))
    const partsByType = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, Number(partValue)]))
    const representedUtc = Date.UTC(
      partsByType.year,
      partsByType.month - 1,
      partsByType.day,
      partsByType.hour,
      partsByType.minute,
    )
    const correction = desiredUtc - representedUtc
    guess += correction
    if (correction === 0) break
  }

  guess += second * 1000 + millisecond
  const result = new Date(guess)
  const selectedMinute = `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}`
  if (dateTimeInputValue(result.toISOString(), timeZone) !== selectedMinute) {
    throw new Error("La hora local no existe por un cambio de horario. Elige otra hora.")
  }
  return result.toISOString()
}
