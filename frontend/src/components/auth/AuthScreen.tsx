import { useState, type FormEvent } from "react"
import { Activity, ArrowRight, ShieldCheck, TrendingDown } from "lucide-react"
import {
  authenticate,
  completePasswordReset,
  requestPasswordReset,
  registerAccount,
  requestEmailVerification,
} from "../../api"
import type { AuthMode } from "../../lib/types"

export function AuthScreen({ onAuthenticated }: { onAuthenticated: (token: string) => void }) {
  const resetQuery = window.location.hash.split("?")[1] ?? ""
  const resetToken = new URLSearchParams(resetQuery).get("token")
  const [mode, setMode] = useState<AuthMode>(() => (resetToken ? "reset" : "login"))
  const [email, setEmail] = useState(() => (import.meta.env.DEV ? (import.meta.env.VITE_PREVIEW_EMAIL ?? "") : ""))
  const [password, setPassword] = useState(() =>
    import.meta.env.DEV ? (import.meta.env.VITE_PREVIEW_PASSWORD ?? "") : "",
  )
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    setSuccess("")
    try {
      if (mode === "forgot") {
        setSuccess(await requestPasswordReset(email))
      } else if (mode === "verify-request") {
        setSuccess(await requestEmailVerification(email))
      } else if (mode === "reset") {
        if (!resetToken) throw new Error("El enlace de restablecimiento no es válido.")
        const values = new FormData(event.currentTarget as HTMLFormElement)
        const newPassword = String(values.get("new_password"))
        if (newPassword !== String(values.get("confirm_password"))) {
          throw new Error("La confirmación no coincide con la nueva contraseña.")
        }
        setSuccess(await completePasswordReset(resetToken, newPassword))
        setMode("login")
        window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`)
      } else if (mode === "register") {
        setSuccess(await registerAccount(email, password))
        setPassword("")
      } else {
        onAuthenticated(await authenticate(email, password))
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Error de autenticación")
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="auth-layout">
      <div className="auth-story">
        <div className="brand auth-brand">
          <div className="brand-mark">
            <Activity size={20} />
          </div>
          <span>
            forma<span className="brand-period">.</span>
          </span>
        </div>
        <div className="auth-story-copy">
          <div className="eyebrow">TU ESPACIO PERSONAL</div>
          <h1>
            Un camino propio.
            <br />
            <em>Un día a la vez.</em>
          </h1>
          <p>Un lugar privado para entender tu progreso, registrar lo que importa y seguir avanzando a tu manera.</p>
          <div className="auth-points">
            <span>
              <ShieldCheck size={16} /> Tus registros vinculados a tu cuenta
            </span>
            <span>
              <TrendingDown size={16} /> Observa tu progreso
            </span>
          </div>
        </div>
        <div className="auth-quote">“El progreso no es lineal. Cada registro suma.”</div>
      </div>
      <div className="auth-form-side">
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-kicker">BIENVENIDO A FORMA</div>
          <h2>
            {mode === "login"
              ? "Qué bueno tenerte de vuelta."
              : mode === "register"
                ? "Crea tu espacio seguro."
                : mode === "forgot"
                  ? "Recupera tu cuenta."
                  : mode === "verify-request"
                    ? "Confirma tu correo."
                    : "Elige una contraseña nueva."}
          </h2>
          <p>
            {mode === "login"
              ? "Inicia sesión para ver tu seguimiento personal."
              : mode === "register"
                ? "Tu cuenta es privada y solo tú puedes acceder."
                : mode === "forgot"
                  ? "Te enviaremos un enlace de un solo uso si el correo corresponde a una cuenta."
                  : mode === "verify-request"
                    ? "Te enviaremos un enlace si hay una cuenta pendiente con esa dirección."
                    : "El enlace es temporal y solo se puede usar una vez."}
          </p>
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
          {(mode === "login" || mode === "register" || mode === "forgot" || mode === "verify-request") && (
            <label>
              Correo electrónico
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="tu@correo.com"
              />
            </label>
          )}
          {(mode === "login" || mode === "register") && (
            <label>
              Contraseña
              <input
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
                minLength={mode === "register" ? 12 : 1}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={mode === "register" ? "Mínimo 12 caracteres" : "Tu contraseña"}
              />
            </label>
          )}
          {mode === "reset" && (
            <>
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
                Confirmar contraseña
                <input
                  name="confirm_password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                />
              </label>
            </>
          )}
          {mode === "register" && (
            <small className="password-hint">
              Usa al menos 12 caracteres. La contraseña se almacena con hash seguro.
            </small>
          )}
          <button className="primary-button auth-submit" disabled={busy}>
            {busy
              ? "Un momento…"
              : mode === "login"
                ? "Iniciar sesión"
                : mode === "register"
                  ? "Crear cuenta"
                  : mode === "forgot"
                    ? "Enviar enlace"
                    : mode === "verify-request"
                      ? "Reenviar verificación"
                      : "Actualizar contraseña"}{" "}
            <ArrowRight size={17} />
          </button>
          {mode === "login" && (
            <>
              <div className="auth-switch">
                <button
                  type="button"
                  onClick={() => {
                    setMode("forgot")
                    setError("")
                    setSuccess("")
                  }}
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
              <div className="auth-switch">
                <button
                  type="button"
                  onClick={() => {
                    setMode("verify-request")
                    setError("")
                    setSuccess("")
                  }}
                >
                  ¿No recibiste el correo de verificación?
                </button>
              </div>
            </>
          )}
          {mode === "register" && success && (
            <div className="auth-switch">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void requestEmailVerification(email)
                    .then(setSuccess)
                    .catch((reason: Error) => setError(reason.message))
                }
              >
                Reenviar correo de verificación
              </button>
            </div>
          )}
          {mode === "login" || mode === "register" ? (
            <div className="auth-switch">
              {mode === "login" ? "¿Primera vez aquí?" : "¿Ya tienes una cuenta?"}{" "}
              <button
                type="button"
                onClick={() => {
                  setMode(mode === "login" ? "register" : "login")
                  setError("")
                  setSuccess("")
                }}
              >
                {mode === "login" ? "Crear cuenta" : "Iniciar sesión"}
              </button>
            </div>
          ) : (
            <div className="auth-switch">
              <button
                type="button"
                onClick={() => {
                  setMode("login")
                  setError("")
                  setSuccess("")
                  window.history.replaceState(
                    {},
                    document.title,
                    `${window.location.pathname}${window.location.search}`,
                  )
                }}
              >
                Volver a iniciar sesión
              </button>
            </div>
          )}
          <div className="auth-security">
            <ShieldCheck size={15} /> Contraseña con hash seguro · Sin anuncios ni rastreo
          </div>
        </form>
      </div>
    </div>
  )
}
