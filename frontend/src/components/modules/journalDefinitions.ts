import type { JournalModule } from "../../api"
import type { Section } from "../../lib/types"

export const journalModuleBySection: Partial<Record<Section, JournalModule>> = {
  Síntomas: "symptoms",
  Actividad: "activity",
  Laboratorios: "labs",
  Objetivos: "goals",
  Revisiones: "reviews",
  Recordatorios: "reminders",
}
export const journalDefinitions: Record<
  JournalModule,
  { title: string; fields: { key: string; label: string; type?: string; options?: string[] }[] }
> = {
  symptoms: {
    title: "check-in semanal",
    fields: [
      { key: "appetite", label: "Apetito", options: ["Menor", "Sin cambios", "Mayor"] },
      { key: "satiety", label: "Saciedad", options: ["Menor", "Sin cambios", "Mayor"] },
      { key: "hydration_l", label: "Hidratación aproximada (L)", type: "number" },
      {
        key: "tolerance",
        label: "Tolerancia percibida",
        options: ["Buena", "Con molestias leves", "Con molestias moderadas", "Con molestias importantes"],
      },
    ],
  },
  activity: {
    title: "actividad",
    fields: [
      { key: "entry_type", label: "Tipo de registro" },
      { key: "activity_type", label: "Actividad" },
      { key: "other_activity", label: "Otra actividad" },
      { key: "duration_min", label: "Duración (min)", type: "number" },
      { key: "distance_km", label: "Distancia (km)", type: "number" },
      { key: "calories_kcal", label: "Calorías (kcal)", type: "number" },
      { key: "intensity", label: "Intensidad", options: ["Suave", "Moderada", "Intensa"] },
      { key: "weekly_calories_kcal", label: "Calorías semanales (kcal)", type: "number" },
      { key: "weekly_steps", label: "Pasos semanales", type: "number" },
      { key: "weekly_distance_km", label: "Distancia semanal (km)", type: "number" },
    ],
  },
  labs: {
    title: "resultado de laboratorio",
    fields: [],
  },
  goals: {
    title: "objetivo",
    fields: [],
  },
  reviews: {
    title: "revisión",
    fields: [
      { key: "review_type", label: "Tipo de revisión", options: ["Tratamiento", "Seguimiento general"] },
      { key: "provider", label: "Profesional / centro" },
      { key: "relevant_history", label: "Antecedentes relevantes", type: "text" },
      { key: "follow_up_date", label: "Seguimiento", type: "date" },
      { key: "topics", label: "Temas tratados" },
    ],
  },
  reminders: {
    title: "recordatorio",
    fields: [
      { key: "reminder_at", label: "Fecha y hora", type: "datetime-local" },
      { key: "repeat", label: "Repetición", options: ["No repetir", "Diario", "Semanal", "Mensual"] },
      { key: "enabled", label: "Activo", options: ["Sí", "No"] },
    ],
  },
}
export const journalSectionLabels: Record<JournalModule, Section> = {
  symptoms: "Síntomas",
  activity: "Actividad",
  labs: "Laboratorios",
  goals: "Objetivos",
  reviews: "Revisiones",
  reminders: "Recordatorios",
}
