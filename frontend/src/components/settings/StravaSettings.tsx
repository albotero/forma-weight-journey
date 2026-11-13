import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { api } from "../../api"
import { formatDateTime } from "../../lib/format"
import { Modal } from "../modals/Modal"

export type StravaStatus = {
  configured: boolean
  client_id: string
  linked: boolean
  callback_url: string
  callback_domain: string
  configuration_error: string | null
  last_sync_at: string | null
  last_error: string | null
  webhook_active: boolean
  webhook_error: string | null
  imported_count: number
  pending_count: number
  failed_count: number
  import_error: string | null
}

export function StravaSettings({ token, onRefresh }: { token: string; onRefresh: () => Promise<void> }) {
  const [connection, setConnection] = useState<StravaStatus | null>(null)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [importHistory, setImportHistory] = useState(false)
  const refresh = useRef(onRefresh)
  const lastSync = useRef<string | null>(null)
  useEffect(() => { refresh.current = onRefresh }, [onRefresh])

  const load = useCallback(async () => {
    const status = await api<StravaStatus>("/strava/connection", token)
    setConnection(status)
    if (status.last_sync_at && status.last_sync_at !== lastSync.current) {
      const previous = lastSync.current
      lastSync.current = status.last_sync_at
      if (previous !== null) await refresh.current()
    }
    return status
  }, [token])

  useEffect(() => {
    let active = true
    void load().catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "No se pudo consultar la conexión Strava.")
    })
    const result = new URLSearchParams(window.location.search).get("strava")
    if (result === "connected") {
      setMessage("Strava conectado. Las actividades aparecerán al terminar la sincronización inicial.")
      void refresh.current().catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "No se pudieron actualizar las actividades.")
      })
    }
    if (result) {
      const url = new URL(window.location.href)
      url.searchParams.delete("strava")
      window.history.replaceState(window.history.state, "", url)
    }
    return () => { active = false }
  }, [load])

  useEffect(() => {
    if (!connection?.linked) return
    const timer = window.setInterval(() => {
      void load().catch((reason) => setError(reason instanceof Error ? reason.message : "No se pudo actualizar el estado de Strava."))
    }, 15000)
    return () => window.clearInterval(timer)
  }, [connection?.linked, load])

  async function saveCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setBusy(true)
    setError("")
    setMessage("")
    try {
      await api("/strava/credentials", token, { method: "PUT", body: JSON.stringify({
        client_id: String(values.get("client_id")).trim(),
        client_secret: String(values.get("client_secret")).trim(),
        current_password: String(values.get("current_password")),
      }) })
      form.reset()
      await load()
      setMessage("Credenciales guardadas de forma cifrada. Ya puedes conectar tu cuenta Strava.")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudieron guardar las credenciales de Strava.")
    } finally {
      setBusy(false)
    }
  }

  async function connect() {
    setBusy(true)
    setError("")
    try {
      const result = await api<{ authorization_url: string }>("/strava/authorize", token, {
        method: "POST", body: JSON.stringify({ import_last_30_days: importHistory }),
      })
      window.location.assign(result.authorization_url)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo iniciar la autorización de Strava.")
      setBusy(false)
    }
  }

  async function synchronize(webhook = false) {
    setBusy(true)
    setError("")
    setMessage("")
    try {
      await api(webhook ? "/strava/webhook-setup" : "/strava/sync", token, { method: "POST" })
      await load()
      setMessage(webhook ? "Webhook de Strava configurado." : "Sincronización en cola. El servidor la procesará en segundo plano.")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo solicitar la sincronización de Strava.")
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    if (!window.confirm("¿Desconectar Strava y eliminar de Forma las actividades importadas y sus credenciales? No se borrará nada en Strava ni los registros manuales de Forma.")) return
    setBusy(true)
    setError("")
    try {
      await api("/strava/connection", token, { method: "DELETE" })
      await load()
      await refresh.current()
      setMessage("Strava desconectado. Se eliminaron sus credenciales y actividades importadas de Forma.")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo desconectar Strava.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="account-card">
      <div className="account-card-heading">
        <div>
          <h2>Strava · sincronización de actividades</h2>
          <p>Graba en la app iOS de Strava, incluso con pantalla bloqueada, y guarda allí la actividad para recibirla en Forma.</p>
        </div>
      </div>
      {!connection && !error && <p role="status">Consultando Strava…</p>}
      {connection && <>
        <p className="module-hint">
          Usa una aplicación Strava dedicada a esta cuenta Forma. Configura en{" "}
          <a href="https://www.strava.com/settings/api" target="_blank" rel="noreferrer">los ajustes API de Strava</a>{" "}
          el dominio de autorización <strong>{connection.callback_domain || "pendiente de configurar en el servidor"}</strong>.
          El Client Secret se cifra en el servidor, no se vuelve a mostrar y Forma no lo guarda en el almacenamiento del navegador.
        </p>
        {connection.callback_url && <p className="module-hint">Callback OAuth: <code>{connection.callback_url}</code></p>}
        {connection.configuration_error && <p className="error-banner" role="alert">{connection.configuration_error}</p>}
        <div className="telegram-account-status">
          <span className={`record-status ${connection.linked ? "active" : ""}`}>
            {connection.linked ? "Strava conectado" : connection.configured ? "Credenciales configuradas" : "Strava no configurado"}
          </span>
          {connection.configured && <span>Client ID: {connection.client_id}</span>}
        </div>
        {!connection.linked && !connection.webhook_active && (
          <form className="entry-form account-form" onSubmit={(event) => void saveCredentials(event)}>
            <label>Client ID<input name="client_id" inputMode="numeric" pattern="[0-9]{1,20}" defaultValue={connection.client_id} required disabled={busy} /></label>
            <label>Client Secret<input name="client_secret" type="password" autoComplete="new-password" minLength={8} maxLength={256} required disabled={busy} /></label>
            <label>Contraseña actual de Forma<input name="current_password" type="password" autoComplete="current-password" required disabled={busy} /></label>
            <div className="form-actions"><button className="primary-button" disabled={busy || Boolean(connection.configuration_error)}>Guardar credenciales Strava</button></div>
          </form>
        )}
        {connection.linked ? <>
          <p className="module-hint">
            {connection.webhook_active ? "Recepción automática por webhook, normalmente en el siguiente ciclo de 30 segundos." : "Sin webhook: comprobación automática cada 15 minutos."}
            {" "}Sincroniza caminatas, senderismo, carreras y ciclismo al aire libre. No importa entrenamientos virtuales ni bicicleta eléctrica.
            {" "}Actividades importadas: {connection.imported_count}; pendientes: {connection.pending_count}.
            {connection.last_sync_at && ` Última sincronización: ${formatDateTime(connection.last_sync_at)}.`}
          </p>
          <p className="module-hint">Edita las actividades en Strava. Al eliminarlas allí o revocar el acceso, se eliminan sus copias sincronizadas en Forma. Borrarlas solo en Forma evita que vuelvan a importarse.</p>
          <div className="form-actions">
            <button type="button" className="outline-button" disabled={busy} onClick={() => void synchronize()}>Sincronizar ahora</button>
            {!connection.webhook_active && <button type="button" className="outline-button" disabled={busy} onClick={() => void synchronize(true)}>Reintentar webhook</button>}
          </div>
        </> : connection.configured && (
          <button type="button" className="primary-button" disabled={busy || Boolean(connection.configuration_error)} onClick={() => {
            setImportHistory(false)
            setConnecting(true)
          }}>Conectar con Strava</button>
        )}
        {connection.last_error && <p className="error-banner" role="alert">{connection.last_error}</p>}
        {connection.failed_count > 0 && <p className="error-banner" role="alert">
          {connection.failed_count} actividades no se pudieron importar: {connection.import_error} Corrige los datos en Strava y pulsa Sincronizar ahora para reintentarlas.
        </p>}
        {connection.webhook_error && <p className="error-banner" role="alert">{connection.webhook_error} La sincronización periódica sigue disponible mientras la cuenta esté conectada.</p>}
        {connection.configured && <p><button type="button" className="small-action danger" disabled={busy} onClick={() => void disconnect()}>Desconectar y eliminar configuración Strava</button></p>}
      </>}
      {error && <p className="error-banner" role="alert">{error}</p>}
      {message && <p className="success-banner" role="status">{message}</p>}
      {connecting && <Modal title="Conectar con Strava" subtitle="Elige qué importar antes de autorizar tu cuenta." onClose={() => { if (!busy) setConnecting(false) }}>
        <label><input type="checkbox" checked={importHistory} disabled={busy} onChange={(event) => setImportHistory(event.target.checked)} /> Importar también los últimos 30 días</label>
        <p className="module-hint">Si no lo marcas, se importarán actividades nuevas desde la conexión. Autorizarás lectura de tus actividades, incluidas las privadas y sus recorridos. Forma no publica ni modifica datos en Strava.</p>
        <div className="form-actions">
          <button type="button" className="cancel-button" disabled={busy} onClick={() => setConnecting(false)}>Cancelar</button>
          <button type="button" className="primary-button" disabled={busy} onClick={() => void connect()}>{busy ? "Abriendo Strava…" : "Autorizar en Strava"}</button>
        </div>
        {error && <p className="error-banner" role="alert">{error}</p>}
      </Modal>}
    </section>
  )
}
