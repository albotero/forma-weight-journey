import { Activity, ArrowRight, LineChart, Plus } from "lucide-react"

export function EmptyInline({ label, action, onClick }: { label: string; action?: string; onClick?: () => void }) {
  return (
    <div className="empty-inline">
      <span>{label}</span>
      {action && onClick && (
        <button onClick={onClick}>
          {action} <ArrowRight size={14} />
        </button>
      )}
    </div>
  )
}
export function EmptyChart({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="empty-chart">
      <div className="empty-chart-icon">
        <LineChart size={22} />
      </div>
      <strong>Tu gráfica empieza con un registro</strong>
      <p>Registra tu peso para ver cómo evoluciona con el tiempo.</p>
      <button className="outline-button" onClick={onAdd}>
        <Plus size={16} /> Registrar peso
      </button>
    </div>
  )
}
export function RecordActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="record-actions">
      <button className="small-action" onClick={onEdit}>
        Editar
      </button>
      <button className="small-action danger" onClick={onDelete}>
        Eliminar
      </button>
    </div>
  )
}

export function EmptyModule({ text }: { text: string }) {
  return (
    <div className="module-empty">
      <Activity size={20} />
      <span>{text}</span>
    </div>
  )
}
