import { ArrowDownRight } from "lucide-react"

export function MetricCard({
  label,
  icon,
  value,
  unit,
  foot,
  accent,
}: {
  label: string
  icon: React.ReactNode
  value: string
  unit: string
  foot: string
  accent: string
}) {
  return (
    <article className="metric-card">
      <div className="metric-top">
        <span>{label}</span>
        <div className={`metric-icon ${accent}`}>{icon}</div>
      </div>
      <div className="metric-value">
        {value}
        <small>{unit}</small>
      </div>
      <div className="metric-foot">
        {accent === "green" && value !== "—" && (
          <span className="tiny-trend">
            <ArrowDownRight size={13} />
          </span>
        )}
        {foot}
      </div>
    </article>
  )
}
