import { Activity, ArrowRight, FileText, Footprints, HeartPulse, Ruler, Scale, Syringe } from "lucide-react"
import type { Section, ModalType } from "../../lib/types"
import { Modal } from "./Modal"

export function QuickModal({
  onClose,
  onChoose,
}: {
  onClose: () => void
  onChoose: (target: { modal?: ModalType; section?: Section }) => void
}) {
  const options = [
    { label: "Peso", icon: Scale, modal: "weight" as const, color: "green", available: true },
    { label: "Composición", icon: Activity, modal: "weight" as const, color: "blue", available: true },
    { label: "Dosis", icon: Syringe, modal: "dose" as const, color: "purple", available: true },
    { label: "Medidas", icon: Ruler, section: "Medidas" as const, color: "blue", available: true },
    { label: "Síntomas", icon: HeartPulse, section: "Síntomas" as const, color: "rose", available: true },
    { label: "Actividad", icon: Footprints, section: "Actividad" as const, color: "amber", available: true },
    { label: "Laboratorios", icon: FileText, section: "Laboratorios" as const, color: "blue", available: true },
  ]
  return (
    <Modal title="¿Qué quieres registrar?" subtitle="Elige una opción para un registro rápido." onClose={onClose}>
      <div className="quick-grid">
        {options.map(({ label, icon: Icon, modal, section, color, available }) => (
          <button
            key={label}
            className={`quick-option ${available ? "" : "coming-soon"}`}
            disabled={!available}
            onClick={() => onChoose({ modal, section })}
          >
            <span className={`quick-option-icon ${color}`}>
              <Icon size={19} />
            </span>
            <strong>{label}</strong>
            {available ? <ArrowRight size={15} /> : <small>Pronto</small>}
          </button>
        ))}
      </div>
    </Modal>
  )
}
