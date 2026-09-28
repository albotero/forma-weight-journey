const reminderTargets = {
  weight: "Peso",
  dose: "Medicación",
  blood_pressure: "Laboratorios",
  composition: "Composición",
  measurements: "Medidas",
}

export function buildNotifications({
  entries = [],
  weights = [],
  profile = null,
  medications = [],
  now = Date.now(),
  formatReminderTime = (value) => value,
}) {
  const notifications = []
  for (const entry of entries) {
    if (entry.module !== "reminders") continue
    if (entry.data.enabled !== "Sí" && entry.data.enabled !== true) continue
    const reminderAt = entry.data.reminder_at
    if (typeof reminderAt !== "string") continue
    const due = new Date(reminderAt).getTime()
    if (Number.isNaN(due) || due > now) continue
    if (
      typeof entry.data.last_sent_epoch === "number" &&
      entry.data.completed_reminder_epoch === entry.data.last_sent_epoch
    ) {
      continue
    }
    const autoKey = typeof entry.data.auto_key === "string" ? entry.data.auto_key : null
    notifications.push({
      id: `reminder-${entry.id}-${reminderAt}`,
      title: entry.title,
      body: `Programado para ${formatReminderTime(reminderAt)}`,
      target: reminderTargets[autoKey] ?? "Recordatorios",
      severity: "due",
    })
  }

  const hasWeightToday = weights.some((item) => {
    const elapsed = now - new Date(item.measured_at).getTime()
    return elapsed >= 0 && elapsed <= 86400000
  })
  if (!hasWeightToday) {
    notifications.push({
      id: "checklist-weight-today",
      title: "Registra tu peso de hoy",
      body: "Aún no tienes un registro de peso en las últimas 24 horas.",
      target: "Peso",
      severity: "info",
    })
  }
  if (profile && !profile.medications_reviewed && medications.some((item) => item.active)) {
    notifications.push({
      id: "checklist-medications-review",
      title: "Confirma tus medicamentos actuales",
      body: "Revisa y confirma la lista de medicamentos activos en el checklist de Análisis.",
      target: "Medicación",
      severity: "info",
    })
  }
  return notifications
}

export function pendingBrowserNotifications(notifications, storedIds) {
  let savedIds = []
  try {
    const parsed = JSON.parse(storedIds ?? "[]")
    if (Array.isArray(parsed)) savedIds = parsed.filter((id) => typeof id === "string")
  } catch {
    savedIds = []
  }
  const seen = new Set(savedIds)
  const pending = notifications.filter((item) => item.severity === "due" && !seen.has(item.id))
  for (const item of pending) seen.add(item.id)
  return { pending, idsToStore: Array.from(seen).slice(-200) }
}
