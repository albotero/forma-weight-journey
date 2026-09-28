export type AppNotification = {
  id: string
  title: string
  body: string
  target:
    | "Inicio"
    | "Peso"
    | "Medicación"
    | "Medidas"
    | "Composición"
    | "Síntomas"
    | "Actividad"
    | "Laboratorios"
    | "Fotos"
    | "Objetivos"
    | "Revisiones"
    | "Recordatorios"
    | "Análisis"
    | "Historial"
    | "Perfil y ajustes"
  severity: "due" | "info"
}

export function buildNotifications(options: {
  entries?: Array<{
    id: number
    module: string
    title: string
    data: Record<string, unknown>
  }>
  weights?: Array<{ measured_at: string }>
  profile?: { medications_reviewed: boolean } | null
  medications?: Array<{ active: boolean }>
  now?: number
  formatReminderTime?: (value: string) => string
}): AppNotification[]

export function pendingBrowserNotifications(
  notifications: AppNotification[],
  storedIds: string | null,
): { pending: AppNotification[]; idsToStore: string[] }
