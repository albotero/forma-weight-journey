import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { MapPin, Pause, Play, Square, Trash2 } from "lucide-react"
import type { WeightEntry } from "../../api"
import { activityCalculations } from "../../lib/activity.js"
import { addActivityPosition, emptyActivityTrack, type ActivityTrack } from "../../lib/activityTracking.js"
import { formatDecimal } from "../../lib/format"
import { keepScreenAwake, type ScreenWakeLockStatus } from "../../lib/screenWakeLock.js"
import { recordedActivity, writeActivityDraft, type ActivityDraft } from "../../lib/activityDraft.js"

const ActivityRouteMap = lazy(() => import("./ActivityRouteMap").then((module) => ({ default: module.ActivityRouteMap })))

export type RecordedActivity = {
  startedAt: string
  durationMin: number
  distanceKm: number
  ascentM: number | null
  descentM: number | null
  movingDurationMin: number
  route: ActivityTrack["route"]
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
  session.track = { ...session.track, last: null, sample: null, altitude: null }
}

export function ActivityRecorder({
  activityType,
  intensity,
  weights,
  storageKey,
  initialDraft,
  onActiveChange,
  onFinish,
}: {
  activityType: string
  intensity: string
  weights: WeightEntry[]
  storageKey?: string
  initialDraft?: ActivityDraft | null
  onActiveChange: (active: boolean) => void
  onFinish: (activity: RecordedActivity, recoverySaved: boolean) => void
}) {
  const session = useRef<Session>(initialDraft && !initialDraft.finished
    ? { ...newSession(), startedAt: initialDraft.startedAt, elapsedMs: initialDraft.elapsedMs, track: initialDraft.track }
    : newSession())
  const [running, setRunning] = useState(false)
  const [hasSession, setHasSession] = useState(Boolean(initialDraft && !initialDraft.finished))
  const [elapsedMs, setElapsedMs] = useState(session.current.elapsedMs)
  const [track, setTrack] = useState(session.current.track)
  const [message, setMessage] = useState(initialDraft && !initialDraft.finished
    ? "Sesión recuperada y pausada. Reanuda para continuar; el intervalo sin grabación no se cuenta." : "")
  const [error, setError] = useState("")
  const [storageError, setStorageError] = useState("")
  const [pocketMode, setPocketMode] = useState(false)
  const [unlockReady, setUnlockReady] = useState(false)
  const [showMap, setShowMap] = useState(false)
  const [mapPoints, setMapPoints] = useState(track.route)
  const [wakeLockStatus, setWakeLockStatus] = useState<ScreenWakeLockStatus>("requesting")

  const persist = useCallback((finished = false) => {
    const current = session.current
    if (!current.startedAt) return false
    try {
      writeActivityDraft(window.localStorage, storageKey, {
        version: 1, activityType, intensity, startedAt: current.startedAt,
        elapsedMs: current.elapsedMs + (current.segmentStarted === null ? 0 : Math.max(0, performance.now() - current.segmentStarted)),
        track: current.track, finished,
      })
      setStorageError("")
      return true
    } catch (reason) {
      setStorageError(`No se pudo guardar la recuperación GPS en este dispositivo. ${reason instanceof Error ? reason.message : "Comprueba el almacenamiento del navegador."}`)
      return false
    }
  }, [storageKey, activityType, intensity])

  useEffect(() => {
    if (initialDraft && !initialDraft.finished) onActiveChange(true)
  }, [initialDraft, onActiveChange])

  useEffect(() => {
    if (!showMap || pocketMode) return
    setMapPoints(session.current.track.route)
    if (!running) return
    const timer = window.setInterval(() => setMapPoints(session.current.track.route), 5000)
    return () => window.clearInterval(timer)
  }, [showMap, running, pocketMode])

  useEffect(() => {
    if (!pocketMode) return
    setUnlockReady(false)
    const timer = window.setTimeout(() => setUnlockReady(true), 2000)
    return () => window.clearTimeout(timer)
  }, [pocketMode])

  useEffect(() => {
    if (!running) return
    return keepScreenAwake(setWakeLockStatus)
  }, [running])

  useEffect(() => {
    function suspend() {
      if (session.current.watch === null) return
      stopSession(session.current)
      persist()
      setElapsedMs(session.current.elapsedMs)
      setRunning(false)
      setMessage("Sesión pausada al salir de la app o bloquear la pantalla. Reanuda cuando puedas mantenerla abierta.")
    }
    function hide() {
      if (document.visibilityState === "hidden") suspend()
    }
    document.addEventListener("visibilitychange", hide)
    window.addEventListener("pagehide", suspend)
    return () => {
      document.removeEventListener("visibilitychange", hide)
      window.removeEventListener("pagehide", suspend)
      stopSession(session.current)
      persist()
    }
  }, [persist])

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
        persist()
        setRunning(false)
        setMessage("")
        setError("Sesión pausada: más de 30 segundos sin ubicación precisa. Reanuda cuando recuperes la señal.")
      }
      setElapsedMs(current.elapsedMs + (current.segmentStarted === null ? 0 : now - current.segmentStarted))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [running, persist])

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
          const { latitude, longitude, accuracy, altitude, altitudeAccuracy, speed } = position.coords
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
              speed,
              timestamp: position.timestamp,
            },
            activityType,
          )
          persist()
          setTrack(current.track)
          setMessage(`GPS activo · precisión aproximada ${Math.round(accuracy)} m`)
          setError("")
        },
        (reason) => {
          if (session.current.watch !== watch) return
          stopSession(session.current, session.current.lastFix ?? performance.now())
          persist()
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
      persist()
      setRunning(false)
      setMessage("")
      setError("No se pudo iniciar el GPS. Comprueba los permisos de ubicación del navegador.")
    }
  }

  function pause() {
    stopSession(session.current)
    persist()
    setElapsedMs(session.current.elapsedMs)
    setRunning(false)
    setMessage("Sesión pausada")
  }

  function discard() {
    if (!window.confirm("¿Descartar esta sesión GPS sin guardar?")) return
    try {
      if (storageKey) window.localStorage.removeItem(storageKey)
    } catch (reason) {
      setStorageError(`No se pudo eliminar el borrador GPS. ${reason instanceof Error ? reason.message : ""}`)
      return
    }
    stopSession(session.current)
    session.current = newSession()
    setTrack(session.current.track)
    setElapsedMs(0)
    setRunning(false)
    setHasSession(false)
    setMessage("")
    setError("")
    setStorageError("")
    onActiveChange(false)
  }

  function finish() {
    stopSession(session.current)
    const current = session.current
    const recoverySaved = persist(true)
    onFinish(recordedActivity({
      version: 1, activityType, intensity, startedAt: current.startedAt,
      elapsedMs: current.elapsedMs, track: current.track, finished: true,
    }), recoverySaved)
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
        moving_duration_min: Math.min(track.movingMs, elapsedMs) / 60000,
        distance_km: track.distanceM / 1000,
        elevation_gain_m: track.ascentM,
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
        Mantén esta pantalla abierta; al salir, la sesión se pausa. El GPS consume batería y puede perder precisión.
        La ruta se guarda junto con esta actividad. Cada ubicación fiable guarda un borrador local para recuperar
        tras recargar en esta cuenta y navegador; se elimina al guardar o descartar. No es una copia en el servidor.
        Para grabar con el teléfono bloqueado necesitas una app iOS de GPS en segundo plano.
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
            <dt>En movimiento</dt>
            <dd>
              {Math.floor(track.movingMs / 60000)}:{String(Math.floor(track.movingMs / 1000) % 60).padStart(2, "0")}
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
      {track.route.length > 1 && <button type="button" className="cancel-button" onClick={() => {
        setMapPoints(session.current.track.route)
        setShowMap(!showMap)
      }}>{showMap ? "Ocultar mapa en vivo" : "Mostrar mapa en vivo (más batería)"}</button>}
      {showMap && !pocketMode && mapPoints.length > 1 && (
        <Suspense fallback={<div className="activity-route-loading" role="status">Cargando mapa…</div>}>
          <ActivityRouteMap points={mapPoints} />
        </Suspense>
      )}
      <div className="activity-recorder-actions">
        {running ? (
          <><button type="button" className="cancel-button" onClick={pause}>
            <Pause size={16} /> Pausar
          </button>
          <button type="button" className="cancel-button" onClick={() => setPocketMode(true)}>Modo bolsillo</button></>
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
      {storageError && <p className="error-banner" role="alert">{storageError}</p>}
      {pocketMode && <div className="activity-pocket-shield" role="dialog" aria-modal="true" aria-label="Modo bolsillo">
        <h2>Modo bolsillo</h2>
        <p>Protege de toques en Forma, no del bloqueo ni de gestos del sistema. Mantén el teléfono desbloqueado.
          No garantiza grabación en segundo plano. Detente antes de usar los controles.</p>
        <p role="status">{running ? "GPS activo" : "Grabación pausada: desbloquea para revisar el estado"}</p>
        <button type="button" className="cancel-button" disabled={!unlockReady} onClick={() => {
          if (window.confirm("¿Desactivar el modo bolsillo?")) setPocketMode(false)
        }}>Desbloquear controles</button>
      </div>}
    </section>
  )
}
