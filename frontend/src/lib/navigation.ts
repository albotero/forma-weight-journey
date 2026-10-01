import {
  UserRoundCog,
  Bell,
  CalendarDays,
  Clock3,
  Dna,
  FileText,
  Footprints,
  HeartPulse,
  Home,
  LineChart,
  Ruler,
  Scale,
  Syringe,
  Target,
  UserRound,
} from "lucide-react"
import type { Section } from "./types"

export const WEB_NOTIFICATIONS_ENABLED_KEY = "forma:web-notifications-enabled"
export const NOTIFIED_REMINDERS_KEY = "forma:notified-reminders"
export const sectionPaths: Record<Section, string> = {
  Inicio: "/",
  Peso: "/peso",
  Medicación: "/medicacion",
  Medidas: "/medidas",
  Composición: "/composicion",
  Síntomas: "/sintomas",
  Actividad: "/actividad",
  Laboratorios: "/laboratorios",
  Fotos: "/fotos",
  Objetivos: "/objetivos",
  Revisiones: "/revisiones",
  Recordatorios: "/recordatorios",
  Análisis: "/analisis",
  Historial: "/historial",
  "Perfil y ajustes": "/perfil",
}
export const pathSections: Record<string, Section> = Object.fromEntries(
  Object.entries(sectionPaths).map(([label, path]) => [path, label as Section]),
)
export const navigation: { label: Section; icon: typeof Home }[] = [
  { label: "Inicio", icon: Home },
  { label: "Análisis", icon: LineChart },
  { label: "Peso", icon: Scale },
  { label: "Medicación", icon: Syringe },
  { label: "Medidas", icon: Ruler },
  { label: "Composición", icon: Dna },
  { label: "Síntomas", icon: HeartPulse },
  { label: "Actividad", icon: Footprints },
  { label: "Laboratorios", icon: FileText },
  { label: "Fotos", icon: UserRound },
  { label: "Objetivos", icon: Target },
  { label: "Revisiones", icon: CalendarDays },
  { label: "Recordatorios", icon: Bell },
  { label: "Historial", icon: Clock3 },
  { label: "Perfil y ajustes", icon: UserRoundCog },
]
