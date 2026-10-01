import { useEffect, useState, type FormEvent } from "react"
import { Bell, KeyRound, Mail } from "lucide-react"
import {
  api,
  requestEmailChange,
  type Account,
  type Profile,
  type TelegramConnection,
  type TelegramPairing,
} from "../../api"
import { WEB_NOTIFICATIONS_ENABLED_KEY } from "../../lib/navigation"
import { formatDate } from "../../lib/format"
import { AccountDataTransfer } from "./AccountDataTransfer"

export function AccountSettings({
  token,
  onRefresh,
  onProfileUpdated,
  onPasswordChanged,
  onError,
}: {
  token: string
  onRefresh: () => Promise<void>
  onProfileUpdated: (profile: Profile) => void
  onPasswordChanged: () => void
  onError: (message: string) => void
}) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [account, setAccount] = useState<Account | null>(null)
  const [telegram, setTelegram] = useState<TelegramConnection | null>(null)
  const [pairingUrl, setPairingUrl] = useState("")
  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [savingEmail, setSavingEmail] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">(() =>
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported",
  )
  const [webNotificationsEnabled, setWebNotificationsEnabled] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem(WEB_NOTIFICATIONS_ENABLED_KEY) === "1",
  )

  async function toggleWebNotifications() {
    if (webNotificationsEnabled) {
      window.localStorage.setItem(WEB_NOTIFICATIONS_ENABLED_KEY, "0")
      setWebNotificationsEnabled(false)
      return
    }
    if (!("Notification" in window)) return
    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
    if (permission === "granted") {
      window.localStorage.setItem(WEB_NOTIFICATIONS_ENABLED_KEY, "1")
      setWebNotificationsEnabled(true)
    }
  }

  useEffect(() => {
    let active = true
    void Promise.all([
      api<Profile>("/profile", token),
      api<Account>("/account", token),
      api<TelegramConnection>("/telegram/connection", token),
    ])
      .then(([profileData, accountData, telegramData]) => {
        if (!active) return
        setProfile(profileData)
        setAccount(accountData)
        setTelegram(telegramData)
      })
      .catch((reason: Error) => onError(reason.message))
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [token, onError])

  useEffect(() => {
    if (!pairingUrl || telegram?.linked) return
    const timer = window.setInterval(() => {
      void api<TelegramConnection>("/telegram/connection", token)
        .then(setTelegram)
        .catch(() => undefined)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [pairingUrl, telegram?.linked, token])

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    setSavingProfile(true)
    setError("")
    setSuccess("")
    try {
      const updated = await api<Profile>("/profile", token, {
        method: "PUT",
        body: JSON.stringify({
          height_cm: Number(values.get("height_cm")),
          initial_weight_kg: Number(values.get("initial_weight_kg")),
          timezone: String(values.get("timezone")),
          birth_date: values.get("birth_date") ? String(values.get("birth_date")) : null,
        }),
      })
      setProfile(updated)
      onProfileUpdated(updated)
      await onRefresh()
      setSuccess("Perfil actualizado.")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar el perfil.")
    } finally {
      setSavingProfile(false)
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    const currentPassword = String(values.get("current_password"))
    const newPassword = String(values.get("new_password"))
    if (newPassword !== String(values.get("confirm_password"))) {
      setError("La confirmación no coincide con la nueva contraseña.")
      return
    }
    setSavingPassword(true)
    setError("")
    setSuccess("")
    try {
      await api<void>("/auth/password", token, {
        method: "PUT",
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      })
      setSuccess("Contraseña actualizada. Se revocaron las sesiones; inicia sesión de nuevo.")
      window.setTimeout(onPasswordChanged, 1200)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo cambiar la contraseña.")
      setSavingPassword(false)
    }
  }

  async function changeEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    const newEmail = String(values.get("new_email")).trim().toLowerCase()
    setSavingEmail(true)
    setError("")
    setSuccess("")
    try {
      const message = await requestEmailChange(token, String(values.get("current_password")), newEmail)
      setAccount((current) => (current ? { ...current, pending_email: newEmail } : current))
      setSuccess(message)
      form.reset()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo solicitar el cambio de correo.")
    } finally {
      setSavingEmail(false)
    }
  }

  async function linkTelegram() {
    setError("")
    try {
      const pairing = await api<TelegramPairing>("/telegram/connection", token, { method: "POST" })
      setPairingUrl(pairing.start_url)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo generar el enlace Telegram.")
    }
  }

  async function unlinkTelegram() {
    if (!window.confirm("¿Desvincular Telegram de esta cuenta? Dejarás de recibir avisos por ese chat.")) return
    try {
      await api<void>("/telegram/connection", token, { method: "DELETE" })
      setPairingUrl("")
      setTelegram((current) => (current ? { ...current, linked: false } : current))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo desvincular Telegram.")
    }
  }

  const timezones = [
    "America/Bogota",
    "America/Lima",
    "America/Mexico_City",
    "America/Santiago",
    "America/Buenos_Aires",
    "America/New_York",
    "Europe/Madrid",
    "UTC",
  ]

  return (
    <section className="module-page account-page">
      <div className="module-heading">
        <div>
          <div className="eyebrow">CUENTA PRIVADA</div>
          <h1>Perfil y ajustes</h1>
        </div>
      </div>
      {loading ? (
        <div className="loading-screen" role="status">
          Cargando ajustes…
        </div>
      ) : (
        <>
          <div className="account-card account-identity">
            <div className="account-card-icon">
              <Mail size={18} />
            </div>
            <div>
              <span>Correo de acceso</span>
              <strong>{account?.email ?? "No disponible"}</strong>
              {account?.email_verified && <small>Correo verificado</small>}
              {account?.pending_email && <small>Pendiente de confirmar: {account.pending_email}</small>}
              {account && <small>Cuenta creada el {formatDate(account.created_at)}</small>}
            </div>
          </div>

          <div className="account-settings-grid">
            <section className="account-card">
              <div className="account-card-heading">
                <div>
                  <h2>Cambiar correo de acceso</h2>
                  <p>El correo actual seguirá activo hasta confirmar el enlace enviado al nuevo.</p>
                </div>
                <Mail size={19} />
              </div>
              <form className="entry-form account-form" onSubmit={changeEmail}>
                <label>
                  Nuevo correo electrónico
                  <input name="new_email" type="email" autoComplete="email" required />
                </label>
                <label>
                  Contraseña actual
                  <input name="current_password" type="password" autoComplete="current-password" required />
                </label>
                <div className="form-actions">
                  <button className="primary-button" disabled={savingEmail}>
                    {savingEmail ? "Enviando…" : "Enviar confirmación"}
                  </button>
                </div>
              </form>
            </section>

            <section className="account-card">
              <div className="account-card-heading">
                <div>
                  <h2>Datos de perfil</h2>
                  <p>Se usan para contextualizar tus registros y mostrar fechas locales.</p>
                </div>
              </div>
              {profile && (
                <form className="entry-form account-form" onSubmit={saveProfile}>
                  <div className="form-two-columns">
                    <label>
                      Altura (cm)
                      <input
                        name="height_cm"
                        type="number"
                        min="1"
                        max="260"
                        step="0.01"
                        defaultValue={profile.height_cm}
                        required
                      />
                    </label>
                    <label>
                      Peso inicial (kg)
                      <input
                        name="initial_weight_kg"
                        type="number"
                        min="1"
                        max="500"
                        step="0.01"
                        defaultValue={profile.initial_weight_kg}
                        required
                      />
                    </label>
                  </div>
                  <label>
                    Fecha de nacimiento <span className="optional">opcional</span>
                    <input name="birth_date" type="date" defaultValue={profile.birth_date ?? ""} />
                  </label>
                  <label>
                    Zona horaria
                    <select name="timezone" defaultValue={profile.timezone}>
                      {!timezones.includes(profile.timezone) && (
                        <option value={profile.timezone}>{profile.timezone}</option>
                      )}
                      {timezones.map((zone) => (
                        <option key={zone} value={zone}>
                          {zone}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="form-actions">
                    <button className="primary-button" disabled={savingProfile}>
                      {savingProfile ? "Guardando…" : "Guardar perfil"}
                    </button>
                  </div>
                </form>
              )}
            </section>

            <section className="account-card">
              <div className="account-card-heading">
                <div>
                  <h2>Seguridad</h2>
                  <p>Elige una contraseña única de al menos 12 caracteres.</p>
                </div>
                <KeyRound size={19} />
              </div>
              <form className="entry-form account-form" onSubmit={changePassword}>
                <label>
                  Contraseña actual
                  <input name="current_password" type="password" autoComplete="current-password" required />
                </label>
                <label>
                  Nueva contraseña
                  <input
                    name="new_password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                  />
                </label>
                <label>
                  Confirmar nueva contraseña
                  <input
                    name="confirm_password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                  />
                </label>
                <div className="form-actions">
                  <button className="primary-button" disabled={savingPassword}>
                    {savingPassword ? "Actualizando…" : "Cambiar contraseña"}
                  </button>
                </div>
              </form>
            </section>

            <AccountDataTransfer token={token} />

            <section className="account-card account-telegram-card">
              <div className="account-card-heading">
                <div>
                  <h2>Telegram para recordatorios</h2>
                  <p>El vínculo se hace con tu chat privado, no necesitas compartir tu número telefónico.</p>
                </div>
                <Bell size={19} />
              </div>
              <div className="telegram-account-status">
                <span className={`record-status ${telegram?.linked ? "active" : ""}`}>
                  {telegram?.linked ? "Telegram conectado" : "Telegram no conectado"}
                </span>
                {telegram?.bot_username && <span>Bot: @{telegram.bot_username}</span>}
              </div>
              <p className="module-hint">
                Para vincularlo, abre Telegram desde el enlace temporal y pulsa Iniciar. El bot no solicita ni almacena
                tu número telefónico.
              </p>
              {telegram?.linked ? (
                <button className="small-action danger" onClick={() => void unlinkTelegram()}>
                  Desvincular Telegram
                </button>
              ) : (
                <button className="outline-button" disabled={!telegram?.configured} onClick={() => void linkTelegram()}>
                  {telegram?.configured
                    ? "Vincular cuenta de Telegram"
                    : "Telegram no configurado por el administrador"}
                </button>
              )}
              {pairingUrl && (
                <a className="telegram-link" href={pairingUrl} target="_blank" rel="noreferrer">
                  Abrir Telegram para confirmar el vínculo
                </a>
              )}
            </section>

            <section className="account-card">
              <div className="account-card-heading">
                <div>
                  <h2>Notificaciones del navegador</h2>
                  <p>
                    Recibe un aviso en este dispositivo cuando un recordatorio esté vencido, sin depender de Telegram.
                  </p>
                </div>
                <Bell size={19} />
              </div>
              <div className="telegram-account-status">
                <span className={`record-status ${webNotificationsEnabled ? "active" : ""}`}>
                  {webNotificationsEnabled ? "Activadas" : "Desactivadas"}
                </span>
                {notificationPermission === "denied" && <span>Bloqueadas por el navegador</span>}
              </div>
              <p className="module-hint">
                Se muestran mientras esta pestaña permanece abierta; para avisos aunque cierres el navegador, usa la
                vinculación con Telegram.
              </p>
              <button
                className="outline-button"
                disabled={notificationPermission === "denied"}
                onClick={() => void toggleWebNotifications()}
              >
                {notificationPermission === "denied"
                  ? "Permite notificaciones en los ajustes del navegador"
                  : webNotificationsEnabled
                    ? "Desactivar notificaciones"
                    : "Activar notificaciones"}
              </button>
            </section>
          </div>
        </>
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
