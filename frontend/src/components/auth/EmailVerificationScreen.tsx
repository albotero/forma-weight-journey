import { useEffect, useState } from "react"
import { Activity, ArrowRight } from "lucide-react"
import { confirmEmailVerification } from "../../api"

export function EmailVerificationScreen({ token }: { token: string }) {
  const [message, setMessage] = useState("Confirmando tu correo…")
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    void confirmEmailVerification(token)
      .then((result) => {
        if (active) setMessage(result)
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message)
      })
    return () => {
      active = false
    }
  }, [token])

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
          <div className="eyebrow">CUENTA PRIVADA</div>
          <h1>Un correo confirmado.</h1>
        </div>
      </div>
      <div className="auth-form-side">
        <div className="auth-form">
          <div className="auth-kicker">VERIFICACIÓN DE CORREO</div>
          <h2>{error ? "No se pudo confirmar." : "Revisando el enlace."}</h2>
          <p role={error ? "alert" : "status"}>{error || message}</p>
          <button
            className="primary-button auth-submit"
            onClick={() => {
              window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`)
              window.location.reload()
            }}
          >
            Ir a iniciar sesión <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </div>
  )
}
