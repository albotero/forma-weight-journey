import type { WeightEntry } from "../api"

export type Section =
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
export type AuthMode = "login" | "register" | "forgot" | "reset" | "verify-request"
export type ModalType = "weight" | "dose" | "body" | "quick" | "medication" | null
export type CompositionValues = Omit<WeightEntry, "id" | "measured_at" | "weight_kg" | "source" | "notes">
export const activityTypes = [
  "Caminata",
  "Correr",
  "Bicicleta",
  "Natación",
  "Entrenamiento de fuerza",
  "Yoga/Pilates",
  "Otro",
] as const
export type ActivityType = (typeof activityTypes)[number]
