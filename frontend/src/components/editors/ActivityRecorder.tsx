import { useEffect, useRef, useState } from "react"
import { MapPin, Pause, Play, Square, Trash2 } from "lucide-react"
import type { WeightEntry } from "../../api"
import { activityCalculations } from "../../lib/activity.js"
import { addActivityPosition, emptyActivityTrack, type ActivityTrack } from "../../lib/activityTracking.js"
import { formatDecimal } from "../../lib/format"
import { keepScreenAwake, type ScreenWakeLockStatus } from "../../lib/screenWakeLock.js"

export type RecordedActivity = {
  startedAt: string
  durationMin: number
  distanceKm: number
  ascentM: number | null
  descentM: number | null
}

type Session = {
  startedAt: string
  elapsedMs: number
  segmentStarted: number | null
  lastFix: number | null
  watch: number | null
  track: ActivityTrack
}

function newSession(): Session {
  return { startedAt: "", elapsedMs: 0, segmentStarted: null, lastFix: null, watch: null, track: emptyActivityTrack() }
}

function stopSession(session: Session, end = performance.now()) {
  if (session.watch !== null) navigator.geolocation.clearWatch(session.watch)
  if (session.segmentStarted !== null) session.elapsedMs += Math.max(0, end - session.segmentStarted)
  session.watch = null
  session.segmentStarted = null
  session.lastFix = null
  session.track = { ...session.track, last: null, altitude: null }
}

export function ActivityRecorder({
  activityType,
  intensity,
  weights,
  onActiveChange,
  onFinish,
}: {
  activityType: string
  intensity: string
  weights: WeightEntry[]
  onActiveChange: (active: boolean) => void
  onFinish: (activity: RecordedActivity) => void
}) {
  const session = useRef<Session>(newSession())
  const [running, setRunning] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [track, setTrack] = useState(emptyActivityTrack)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [wakeLockStatus, setWakeLockStatus] = useState<ScreenWakeLockStatus>("requesting")

  useEffect(() => {
    if (!running) return
    return keepScreenAwake(setWakeLockStatus)
  }, [running])

  useEffect(() => {
    function hide() {
      if (document.visibilityState !== "hidden" || session.current.watch === null) return
      stopSession(session.current)
      setElapsedMs(session.current.elapsedMs)
      setRunning(false)
      setMessage("Sesión pausada al salir de la app o bloquear la pantalla. Reanuda cuando puedas mantenerla abierta.")
    }
    document.addEventListener("visibilitychange", hide)
    return () => {
      document.removeEventListener("visibilitychange", hide)
      stopSession(session.current)
    }
  }, [])

  useEffect(() => {
    if (!hasSession) return
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", beforeUnload)
    return () => window.removeEventListener("beforeunload", beforeUnload)
  }, [hasSession])

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => {
      const current = session.current
      const now = performance.now()
      if (current.lastFix !== null && now - current.lastFix > 30000) {
        stopSession(current, current.lastFix)
        setRunning(false)
        setMessage("")
        setError("Sesión pausada: más de 30 segundos sin ubicación precisa. Reanuda cuando recuperes la señal.")
      }
      setElapsedMs(current.elapsedMs + (current.segmentStarted === null ? 0 : now - current.segmentStarted))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [running])

  function start() {
    if (!window.isSecureContext || !navigator.geolocation) {
      setError("El GPS requiere HTTPS y un navegador con acceso a ubicación.")
      return
    }
    setError("")
    setMessage("Esperando ubicación precisa; permite el acceso cuando el iPhone lo solicite.")
    setRunning(true)
    setHasSession(true)
    onActiveChange(true)
    try {
      const watch: number = navigator.geolocation.watchPosition(
        (position) => {
          const current = session.current
          if (current.watch !== watch) return
          const { latitude, longitude, accuracy, altitude, altitudeAccuracy } = position.coords
          if (Date.now() - position.timestamp > 15000 || accuracy > 35) {
            current.track = { ...current.track, last: null, altitude: null }
            setMessage("Señal GPS imprecisa; no se suma distancia hasta recuperar una ubicación fiable.")
            return
          }
          const now = performance.now()
          if (current.segmentStarted === null) current.segmentStarted = now
          if (!current.startedAt) current.startedAt = new Date().toISOString()
          current.lastFix = now
          current.track = addActivityPosition(
            current.track,
            {
              latitude,
              longitude,
              accuracy,
              altitude,
              altitudeAccuracy,
              timestamp: position.timestamp,
            },
            activityType,
          )
          setTrack(current.track)
          setMessage(`GPS activo · precisión aproximada ${Math.round(accuracy)} m`)
          setError("")
        },
        (reason) => {
          if (session.current.watch !== watch) return
          stopSession(session.current, session.current.lastFix ?? performance.now())
          setElapsedMs(session.current.elapsedMs)
          setRunning(false)
          setMessage("")
          setError(
            reason.code === 1
              ? "Ubicación denegada. Habilita el permiso de ubicación para este sitio en los ajustes de Safari."
              : "No se pudo obtener ubicación. La sesión está pausada; prueba al aire libre y reanuda.",
          )
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
      )
      session.current.watch = watch
    } catch {
      stopSession(session.current)
      setRunning(false)
      setMessage("")
      setError("No se pudo iniciar el GPS. Comprueba los permisos de ubicación del navegador.")
    }
  }

  function pause() {
    stopSession(session.current)
    setElapsedMs(session.current.elapsedMs)
    setRunning(false)
    setMessage("Sesión pausada")
  }

  function discard() {
    if (!window.confirm("¿Descartar esta sesión GPS sin guardar?")) return
    stopSession(session.current)
    session.current = newSession()
    setTrack(session.current.track)
    setElapsedMs(0)
    setRunning(false)
    setHasSession(false)
    setMessage("")
    setError("")
    onActiveChange(false)
  }

  function finish() {
    stopSession(session.current)
    const current = session.current
    onFinish({
      startedAt: current.startedAt,
      durationMin: Number((current.elapsedMs / 60000).toFixed(2)),
      distanceKm: Number((current.track.distanceM / 1000).toFixed(2)),
      ascentM: current.track.ascentM === null ? null : Number(current.track.ascentM.toFixed(2)),
      descentM: current.track.descentM === null ? null : Number(current.track.descentM.toFixed(2)),
    })
    session.current = newSession()
    setRunning(false)
    setHasSession(false)
    setElapsedMs(0)
    setTrack(emptyActivityTrack())
    setMessage("Sesión finalizada. Revisa los datos y guarda el registro.")
    setError("")
    onActiveChange(false)
  }

  const calculated = activityCalculations(
    {
      occurred_at: session.current.startedAt,
      data: {
        entry_type: "single",
        tracking_source: "gps",
        activity_type: activityType,
        intensity,
        duration_min: elapsedMs / 60000,
        distance_km: track.distanceM / 1000,
      },
    },
    weights,
  )

  return (
    <section className="activity-recorder" aria-label="Registro GPS">
      <h3>
        <MapPin size={18} aria-hidden="true" /> Sesión GPS
      </h3>
      <p className="module-hint">
        La sesión se pausa si bloqueas el teléfono o cambias de app. El GPS consume batería y puede perder precisión.
        No se guarda tu ruta ni se miden pulsaciones.
      </p>
      {running && (
        <p className="module-hint" role="status">
          {wakeLockStatus === "active"
            ? "Pantalla encendida durante la grabación. No bloquees el teléfono ni cambies de app."
            : wakeLockStatus === "requesting"
              ? "Solicitando mantener la pantalla encendida..."
              : "No se puede impedir el bloqueo automático. Desactívalo temporalmente en los ajustes del teléfono y mantén esta pantalla abierta."}
        </p>
      )}
      {hasSession && (
        <dl className="activity-recorder-metrics">
          <div>
            <dt>Tiempo</dt>
            <dd>
              {Math.floor(elapsedMs / 60000)}:{String(Math.floor(elapsedMs / 1000) % 60).padStart(2, "0")}
            </dd>
          </div>
          <div>
            <dt>Distancia</dt>
            <dd>{formatDecimal(track.distanceM / 1000)} km</dd>
          </div>
          <div>
            <dt>Velocidad media</dt>
            <dd>{calculated.speedKmh === null ? "—" : `${formatDecimal(calculated.speedKmh)} km/h`}</dd>
          </div>
          <div>
            <dt>Calorías estimadas</dt>
            <dd>
              {calculated.estimatedCalories === null
                ? "Sin datos"
                : `${formatDecimal(calculated.estimatedCalories)} kcal`}
            </dd>
          </div>
          <div>
            <dt>Ascenso / descenso</dt>
            <dd>
              {track.ascentM === null
                ? "Sin datos fiables"
                : `${formatDecimal(track.ascentM)} / ${formatDecimal(track.descentM ?? 0)} m`}
            </dd>
          </div>
        </dl>
      )}
      <div className="activity-recorder-actions">
        {running ? (
          <button type="button" className="cancel-button" onClick={pause}>
            <Pause size={16} /> Pausar
          </button>
        ) : (
          <button type="button" className="cancel-button" onClick={start}>
            <Play size={16} /> {hasSession ? "Reanudar" : `Iniciar ${activityType.toLowerCase()}`}
          </button>
        )}
        {hasSession && (
          <>
            <button type="button" className="cancel-button" disabled={elapsedMs < 1000} onClick={finish}>
              <Square size={16} /> Finalizar
            </button>
            <button
              type="button"
              className="icon-button"
              title="Descartar sesión GPS"
              aria-label="Descartar sesión GPS"
              onClick={discard}
            >
              <Trash2 size={18} />
            </button>
          </>
        )}
      </div>
      {message && (
        <p className="module-hint" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
