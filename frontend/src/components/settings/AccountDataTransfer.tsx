import { useState } from "react"
import { Download, Upload } from "lucide-react"
import {
  downloadAccountExport,
  downloadAccountJsonExport,
  logoutSession,
  previewAccountImport,
  restoreAccountImport,
  type AccountImportPreview,
} from "../../api"
import { formatDate } from "../../lib/format"

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function AccountDataTransfer({ token }: { token: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<AccountImportPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  async function downloadExport() {
    setBusy(true)
    setError("")
    setSuccess("")
    try {
      const blob = await downloadAccountExport(token)
      saveBlob(blob, "forma-account-export.zip")
      setSuccess("ZIP restaurable descargado con los datos y las fotos. Guárdalo en un lugar privado.")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo descargar la copia.")
    } finally {
      setBusy(false)
    }
  }

  async function downloadJsonExport() {
    setBusy(true)
    setError("")
    setSuccess("")
    try {
      const blob = await downloadAccountJsonExport(token)
      saveBlob(blob, "forma-account-export.json")
      setSuccess("JSON descargado para análisis externo. No incluye los archivos de imagen.")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo descargar el JSON.")
    } finally {
      setBusy(false)
    }
  }

  async function inspectImport() {
    if (!file) return
    setBusy(true)
    setError("")
    setSuccess("")
    setPreview(null)
    try {
      setPreview(await previewAccountImport(token, file))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo validar la copia.")
    } finally {
      setBusy(false)
    }
  }

  async function restoreImport() {
    if (!file || !preview) return
    if (
      !window.confirm(
        "Se reemplazarán todos los registros actuales de esta cuenta. Esta acción no se puede deshacer. ¿Continuar?",
      )
    )
      return
    setBusy(true)
    setError("")
    try {
      await restoreAccountImport(token, file)
      setSuccess("Datos restaurados. Inicia sesión de nuevo para continuar.")
      window.setTimeout(() => {
        void logoutSession().finally(() => window.location.reload())
      }, 1000)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo restaurar la copia.")
      setBusy(false)
    }
  }

  const countLabels: Record<string, string> = {
    medications: "Medicamentos",
    doses: "Dosis",
    weights: "Pesos",
    body_measurements: "Medidas",
    journal_entries: "Diario y recordatorios",
    catalog_items: "Elementos de catálogo",
    photos: "Fotos",
  }

  return (
    <section className="account-card account-data-card">
      <div className="account-card-heading">
        <div>
          <h2>Exportar y restaurar datos</h2>
          <p>JSON para analizar los datos; ZIP para restaurarlos con sus fotos.</p>
        </div>
        <Download size={19} />
      </div>
      <button className="outline-button" disabled={busy} onClick={() => void downloadExport()}>
        <Download size={16} /> Descargar ZIP restaurable
      </button>
      <button className="outline-button" disabled={busy} onClick={() => void downloadJsonExport()}>
        <Download size={16} /> Descargar JSON
      </button>
      <label className="account-import-file">
        Archivo de copia (.zip)
        <input
          type="file"
          accept=".zip,application/zip"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null)
            setPreview(null)
            setError("")
          }}
        />
      </label>
      <button className="outline-button" disabled={!file || busy} onClick={() => void inspectImport()}>
        <Upload size={16} /> {busy ? "Validando…" : "Revisar copia"}
      </button>
      {preview && (
        <div className="account-import-preview" aria-live="polite">
          <strong>Contenido validado</strong>
          <span>
            {preview.account_email} · copia del {formatDate(preview.exported_at)}
          </span>
          <dl>
            {Object.entries(preview.counts).map(([key, value]) => (
              <div key={key}>
                <dt>{countLabels[key] ?? key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p>
            La restauración reemplaza los datos actuales, revoca las sesiones y requiere volver a vincular Telegram.
          </p>
          <button className="small-action danger" disabled={busy} onClick={() => void restoreImport()}>
            {busy ? "Restaurando…" : "Reemplazar con esta copia"}
          </button>
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className="success-banner" role="status">
          {success}
        </div>
      )}
    </section>
  )
}
