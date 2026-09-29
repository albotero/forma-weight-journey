import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart as RechartsLineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  Activity,
  UserRoundCog,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Clock3,
  Dna,
  Download,
  FileText,
  Footprints,
  Gauge,
  HeartPulse,
  Home,
  KeyRound,
  LineChart,
  LogOut,
  Mail,
  Menu,
  Moon,
  MoreHorizontal,
  Plus,
  Ruler,
  Scale,
  Settings,
  ShieldCheck,
  Syringe,
  Target,
  TrendingDown,
  Upload,
  UserRound,
  X,
} from "lucide-react"
import {
  api,
  authenticate,
  confirmEmailVerification,
  completePasswordReset,
  downloadAccountExport,
  loadPhoto,
  logoutSession,
  previewAccountImport,
  refreshSession,
  requestEmailChange,
  requestPasswordReset,
  registerAccount,
  requestEmailVerification,
  restoreAccountImport,
  uploadPhoto,
  type AccountImportPreview,
  type BodyMeasurementEntry,
  type Account,
  type CatalogCategory,
  type CatalogItem,
  type CatalogResult,
  type DoseEntry,
  type JournalEntry,
  type JournalModule,
  type Medication,
  type PhotoEntry,
  type Profile,
  type TelegramConnection,
  type TelegramPairing,
  type WeightEntry,
} from "./api"
import { dateTimeInputValue, localDateTimeToIso } from "./dateTime.js"
import { buildNotifications, pendingBrowserNotifications } from "./notifications.js"

type Section =
  | "Inicio"
  | "Peso"
  | "Medicación"
  | "Medidas"
  | "Composición"
  | "Síntomas"
  | "Actividad"
  | "Laboratorios"
  | "Fotos"
  | "Objetivos"
  | "Revisiones"
  | "Recordatorios"
  | "Análisis"
  | "Historial"
  | "Perfil y ajustes"
type AuthMode = "login" | "register" | "forgot" | "reset" | "verify-request"
type ModalType = "weight" | "dose" | "body" | "quick" | "medication" | null
type CompositionValues = Omit<WeightEntry, "id" | "measured_at" | "weight_kg" | "source" | "notes">
const activityTypes = [
  "Caminata",
  "Correr",
  "Bicicleta",
  "Natación",
  "Entrenamiento de fuerza",
  "Yoga/Pilates",
  "Otro",
] as const
type ActivityType = (typeof activityTypes)[number]
const WEB_NOTIFICATIONS_ENABLED_KEY = "forma:web-notifications-enabled"
const NOTIFIED_REMINDERS_KEY = "forma:notified-reminders"
const sectionPaths: Record<Section, string> = {
  Inicio: "/",
  Peso: "/peso",
  Medicación: "/medicacion",
  Medidas: "/medidas",
  Composición: "/composicion",
  Síntomas: "/sintomas",
  Actividad: "/actividad",
  Laboratorios: "/laboratorios",
  Fotos: "/fotos",
  Objetivos: "/objetivos",
  Revisiones: "/revisiones",
  Recordatorios: "/recordatorios",
  Análisis: "/analisis",
  Historial: "/historial",
  "Perfil y ajustes": "/perfil",
}
const pathSections: Record<string, Section> = Object.fromEntries(
  Object.entries(sectionPaths).map(([label, path]) => [path, label as Section]),
)
const navigation: { label: Section; icon: typeof Home }[] = [
  { label: "Inicio", icon: Home },
  { label: "Peso", icon: Scale },
  { label: "Medicación", icon: Syringe },
  { label: "Medidas", icon: Ruler },
  { label: "Composición", icon: Dna },
  { label: "Síntomas", icon: HeartPulse },
  { label: "Actividad", icon: Footprints },
  { label: "Laboratorios", icon: FileText },
  { label: "Fotos", icon: UserRound },
  { label: "Objetivos", icon: Target },
  { label: "Revisiones", icon: CalendarDays },
  { label: "Recordatorios", icon: Bell },
  { label: "Análisis", icon: LineChart },
  { label: "Historial", icon: Clock3 },
  { label: "Perfil y ajustes", icon: UserRoundCog },
]
const formatDate = (date: string, timeZone = "America/Bogota") =>
  new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone }).format(new Date(date))
const formatDecimal = (value: number) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(value)
const isNumericString = (raw: string) => /^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(raw.trim())
const formatDateTime = (value: string, timeZone = "America/Bogota") =>
  new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(value))
async function loadAllRecords<T>(path: string, token: string, pageSize = 500): Promise<T[]> {
  const records: T[] = []
  let offset = 0
  while (true) {
    const separator = path.includes("?") ? "&" : "?"
    const page = await api<T[]>(`${path}${separator}limit=${pageSize}&offset=${offset}`, token)
    records.push(...page)
    if (page.length < pageSize) return records
    offset += pageSize
  }
}
const compositionFields = [
  ["body_fat_percent", "Grasa corporal", "%", 100, 0.1],
  ["fat_free_mass_kg", "Masa libre de grasa", "kg", 500, 0.1],
  ["subcutaneous_fat_percent", "Grasa subcutánea", "%", 100, 0.1],
  ["visceral_fat_index", "Grasa visceral (índice)", "índice", 1000, 0.1],
  ["body_water_percent", "Agua corporal", "%", 100, 0.1],
  ["skeletal_muscle_percent", "Músculo esquelético", "%", 100, 0.1],
  ["muscle_mass_kg", "Masa muscular", "kg", 500, 0.1],
  ["bone_mass_kg", "Masa ósea", "kg", 100, 0.1],
  ["protein_percent", "Proteína", "%", 100, 0.1],
  ["bmr_kcal", "Metabolismo basal", "kcal", 20000, 0.01],
  ["metabolic_age", "Edad metabólica", "años", 150, 1],
] as const

export default function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const section: Section = pathSections[location.pathname] ?? "Inicio"
  const setSection = useCallback((target: Section) => navigate(sectionPaths[target]), [navigate])
  const [token, setToken] = useState<string | null>(null)
  const [restoringSession, setRestoringSession] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [account, setAccount] = useState<Account | null>(null)
  const [weights, setWeights] = useState<WeightEntry[]>([])
  const [medications, setMedications] = useState<Medication[]>([])
  const [doses, setDoses] = useState<DoseEntry[]>([])
  const [bodyMeasurements, setBodyMeasurements] = useState<BodyMeasurementEntry[]>([])
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([])
  const [photos, setPhotos] = useState<PhotoEntry[]>([])
  const [editingWeight, setEditingWeight] = useState<WeightEntry | null>(null)
  const [editingDose, setEditingDose] = useState<DoseEntry | null>(null)
  const [doseMedicationId, setDoseMedicationId] = useState<number | null>(null)
  const [editingMedication, setEditingMedication] = useState<Medication | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [modal, setModal] = useState<ModalType>(null)
  const [dark, setDark] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [range, setRange] = useState("90 días")

  const refresh = useCallback(async (authToken: string) => {
    setLoading(true)
    setError("")
    try {
      const [
        profileData,
        accountData,
        weightData,
        medicationData,
        doseData,
        measurementData,
        photoData,
        ...moduleEntries
      ] = await Promise.all([
        api<Profile>("/profile", authToken),
        api<Account>("/account", authToken),
        loadAllRecords<WeightEntry>("/weights", authToken),
        api<Medication[]>("/medications", authToken),
        loadAllRecords<DoseEntry>("/doses", authToken),
        loadAllRecords<BodyMeasurementEntry>("/body-measurements", authToken),
        api<PhotoEntry[]>("/photos", authToken),
        ...(["symptoms", "activity", "labs", "goals", "reviews", "reminders"] as const).map((module) =>
          loadAllRecords<JournalEntry>(`/entries/${module}`, authToken),
        ),
      ])
      setProfile(profileData)
      setAccount(accountData)
      setWeights(weightData)
      setMedications(medicationData)
      setDoses(doseData)
      setBodyMeasurements(measurementData)
      setPhotos(photoData)
      setJournalEntries(moduleEntries.flat())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Error de conexión")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    void refreshSession()
      .then((restoredToken) => {
        if (active) {
          setToken(restoredToken)
          setRestoringSession(false)
        }
      })
      .catch(() => {
        if (active) setRestoringSession(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (token) void refresh(token)
  }, [token, refresh])

  const sortedWeights = useMemo(
    () => [...weights].sort((a, b) => a.measured_at.localeCompare(b.measured_at)),
    [weights],
  )
  const newestWeights = useMemo(
    () => [...weights].sort((a, b) => b.measured_at.localeCompare(a.measured_at) || b.id - a.id),
    [weights],
  )
  const latestWeightEntry = [...sortedWeights]
    .filter((item) => new Date(item.measured_at).getTime() <= Date.now())
    .at(-1)
  const currentWeight = latestWeightEntry?.weight_kg
  const startingWeight = profile?.initial_weight_kg ?? 106
  const loss = currentWeight === undefined ? 0 : startingWeight - currentWeight
  const lossPercent = currentWeight === undefined ? 0 : (loss / startingWeight) * 100
  const bmiNow = currentWeight && profile ? currentWeight / (profile.height_cm / 100) ** 2 : null
  const currentDose = doses[0]
  const userTimezone = profile?.timezone ?? "America/Bogota"
  const accountInitial = account?.email.trim().charAt(0).toLocaleUpperCase("es-CO") || "?"
  const activeMedication = medications.find((item) => item.active)
  const chartData = useMemo(() => {
    const days =
      range === "30 días" ? 30 : range === "90 días" ? 90 : range === "6 meses" ? 183 : range === "1 año" ? 365 : 10000
    const cutoff = Date.now() - days * 86400000
    return sortedWeights
      .filter((item) => {
        const timestamp = new Date(item.measured_at).getTime()
        return timestamp >= cutoff && timestamp <= Date.now()
      })
      .map((item) => ({ date: formatDate(item.measured_at, userTimezone), peso: item.weight_kg }))
  }, [sortedWeights, range, userTimezone])
  const average7 = useMemo(() => {
    const recent = sortedWeights.filter((item) => {
      const elapsed = Date.now() - new Date(item.measured_at).getTime()
      return elapsed >= 0 && elapsed <= 7 * 86400000
    })
    return recent.length ? recent.reduce((sum, item) => sum + item.weight_kg, 0) / recent.length : null
  }, [sortedWeights])
  const goals = [5, 10, 15, 20].map((percent) => ({ percent, weight: startingWeight * (1 - percent / 100) }))
  const progress = (goal: number) =>
    Math.max(0, Math.min(100, ((startingWeight - (currentWeight ?? startingWeight)) / (startingWeight - goal)) * 100))

  const notifications = useMemo(
    () =>
      buildNotifications({
        entries: journalEntries,
        weights,
        profile,
        medications,
        formatReminderTime: (value) => formatDateTime(value, userTimezone),
      }),
    [journalEntries, weights, profile, medications, userTimezone],
  )
  const dueNotificationsCount = notifications.filter((item) => item.severity === "due").length

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return
    if (window.localStorage.getItem(WEB_NOTIFICATIONS_ENABLED_KEY) !== "1") return
    if (Notification.permission !== "granted") return
    const due = notifications.filter((item) => item.severity === "due")
    if (!due.length) return
    const { pending, idsToStore } = pendingBrowserNotifications(
      due,
      window.localStorage.getItem(NOTIFIED_REMINDERS_KEY),
    )
    if (!pending.length) return
    for (const item of pending) {
      const popup = new Notification(item.title, { body: item.body, tag: item.id })
      popup.onclick = () => {
        window.focus()
        setSection(item.target)
      }
    }
    window.localStorage.setItem(NOTIFIED_REMINDERS_KEY, JSON.stringify(idsToStore))
  }, [notifications, setSection])

  const verificationToken = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("token")
  if (window.location.hash.startsWith("#verify?") && verificationToken) {
    return <EmailVerificationScreen token={verificationToken} />
  }
  if (restoringSession)
    return (
      <div className="loading-screen" role="status">
        Restaurando sesión…
      </div>
    )
  if (!token) return <AuthScreen onAuthenticated={setToken} />

  async function submitWeight(
    weight: number,
    notes: string,
    dateTime: string,
    composition: CompositionValues,
    id?: number,
  ) {
    if (!token) return
    await api(id ? `/weights/${id}` : "/weights", token, {
      method: id ? "PUT" : "POST",
      body: JSON.stringify({
        weight_kg: weight,
        measured_at: localDateTimeToIso(dateTime, userTimezone),
        source: "Web",
        notes: notes || null,
        ...composition,
      }),
    })
    await refresh(token)
    setModal(null)
  }

  async function submitDose(mg: number, injectionSite: string, dateTime: string, id?: number, medicationId?: number) {
    const targetMedicationId = medicationId ?? activeMedication?.id
    if (!token || !targetMedicationId) return
    await api(id ? `/doses/${id}` : "/doses", token, {
      method: id ? "PUT" : "POST",
      body: JSON.stringify({
        medication_id: targetMedicationId,
        dose_mg: mg,
        administered_at: localDateTimeToIso(dateTime, userTimezone),
        injection_site: injectionSite || null,
      }),
    })
    await refresh(token)
    setModal(null)
    setDoseMedicationId(null)
  }

  async function removeRecord(path: string) {
    if (!token || !window.confirm("¿Eliminar este registro? Esta acción no se puede deshacer.")) return
    await api(path, token, { method: "DELETE" })
    await refresh(token)
  }

  async function updateMedication(
    medication: Medication,
    name: string,
    concentrationMg: number,
    volumeMl: number,
    unitsPerMl: number | null,
  ) {
    if (!token) return
    await api(`/medications/${medication.id}`, token, {
      method: "PUT",
      body: JSON.stringify({
        name,
        active: medication.active,
        concentration_mg: concentrationMg,
        concentration_volume_ml: volumeMl,
        units_per_ml: unitsPerMl,
      }),
    })
    await refresh(token)
    setModal(null)
    setEditingMedication(null)
  }

  const logout = () => {
    void logoutSession()
    setToken(null)
    setProfile(null)
    setAccount(null)
    setWeights([])
    setDoses([])
    setMedications([])
    setBodyMeasurements([])
    setJournalEntries([])
    setPhotos([])
  }

  return (
    <div className={dark ? "app-shell dark" : "app-shell"}>
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <Activity size={20} strokeWidth={2.6} />
          </div>
          <span>
            forma<span className="brand-period">.</span>
          </span>
          <button className="mobile-close icon-button" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú">
            <X size={19} />
          </button>
        </div>
        <div className="workspace-label">TU ESPACIO</div>
        <nav className="side-nav" aria-label="Navegación principal">
          {navigation
            .filter(({ label }) => label !== "Perfil y ajustes")
            .map(({ label, icon: Icon }) => (
              <button
                key={label}
                onClick={() => {
                  setSection(label)
                  setMobileOpen(false)
                }}
                className={`nav-item ${section === label ? "active" : ""}`}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{label}</span>
                {label === "Inicio" && <span className="nav-live" />}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-card">
            <div className="privacy-icon">
              <ShieldCheck size={17} />
            </div>
            <div>
              <strong>Tus datos, privados</strong>
              <p>Vinculados a tu cuenta</p>
            </div>
          </div>
          <button className="nav-item" onClick={() => setDark((value) => !value)}>
            <Moon size={18} />
            <span>{dark ? "Modo claro" : "Modo oscuro"}</span>
          </button>
          <button className="nav-item" onClick={logout}>
            <LogOut size={18} />
            <span>Cerrar sesión</span>
          </button>
          <button
            className="profile-chip"
            aria-label="Abrir menú de cuenta"
            aria-expanded={accountMenuOpen}
            onClick={() => setAccountMenuOpen((open) => !open)}
          >
            <div className="avatar">{accountInitial}</div>
            <div>
              <strong>Tu seguimiento</strong>
              <p>Espacio personal</p>
            </div>
            <MoreHorizontal size={20} className="profile-more" />
          </button>
          {accountMenuOpen && (
            <div className="account-context-menu" role="menu">
              <button
                role="menuitem"
                onClick={() => {
                  setSection("Perfil y ajustes")
                  setAccountMenuOpen(false)
                }}
              >
                <UserRoundCog size={16} /> Perfil y ajustes
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setSection("Recordatorios")
                  setAccountMenuOpen(false)
                }}
              >
                <Bell size={16} /> Recordatorios
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setDark((value) => !value)
                  setAccountMenuOpen(false)
                }}
              >
                <Moon size={16} /> {dark ? "Modo claro" : "Modo oscuro"}
              </button>
              <button role="menuitem" onClick={logout}>
                <LogOut size={16} /> Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu icon-button" onClick={() => setMobileOpen(true)} aria-label="Abrir menú">
            <Menu size={21} />
          </button>
          <div className="breadcrumb">
            Tu espacio <span>/</span> <strong>{section}</strong>
          </div>
          <div className="topbar-actions">
            <span className="today-label">
              <span className="status-dot" /> Seguimiento personal
            </span>
            <div className="notification-menu">
              <button
                className="icon-button notification-button"
                aria-label="Notificaciones"
                aria-expanded={notificationsOpen}
                onClick={() => setNotificationsOpen((open) => !open)}
              >
                <Bell size={19} />
                {dueNotificationsCount > 0 && <i />}
              </button>
              {notificationsOpen && (
                <div className="notification-panel" role="menu">
                  <div className="notification-panel-heading">
                    <strong>Notificaciones</strong>
                    <span>{notifications.length ? `${notifications.length} pendientes` : "Al día"}</span>
                  </div>
                  {notifications.length ? (
                    <ul className="notification-list">
                      {notifications.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            className={`notification-item ${item.severity}`}
                            onClick={() => {
                              setSection(item.target)
                              setNotificationsOpen(false)
                              setMobileOpen(false)
                            }}
                          >
                            <strong>{item.title}</strong>
                            <span>{item.body}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="notification-empty">No tienes notificaciones pendientes.</p>
                  )}
                </div>
              )}
            </div>
            <button
              className="top-avatar"
              aria-label="Abrir Perfil y ajustes"
              title={account?.email ?? "Perfil y ajustes"}
              onClick={() => {
                setSection("Perfil y ajustes")
                setMobileOpen(false)
              }}
            >
              {accountInitial}
            </button>
          </div>
        </header>
        <div className="page-content">
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button onClick={() => token && void refresh(token)}>Reintentar</button>
            </div>
          )}
          {section === "Inicio" ? (
            <>
              <section className="welcome-row">
                <div>
                  <div className="eyebrow">
                    {new Intl.DateTimeFormat("es-CO", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      timeZone: userTimezone,
                    })
                      .format(new Date())
                      .toLocaleUpperCase("es-CO")}
                  </div>
                  <h1>
                    {section === "Inicio"
                      ? "Tu progreso, a tu ritmo."
                      : section === "Peso"
                        ? "Tu evolución de peso."
                        : "Una mirada a tus datos."}
                  </h1>
                  <p className="welcome-subtitle">Cada dato cuenta. Aquí tienes un resumen de tu recorrido.</p>
                </div>
                <button className="primary-button" onClick={() => setModal("quick")}>
                  <Plus size={18} strokeWidth={2.5} /> <span>Registrar</span>
                </button>
              </section>
              <section className="metric-grid" aria-label="Resumen de progreso">
                <MetricCard
                  label="PESO ACTUAL"
                  icon={<Scale size={18} />}
                  value={currentWeight ? formatDecimal(currentWeight) : "—"}
                  unit="kg"
                  foot={
                    currentWeight
                      ? `Último registro · ${formatDate(latestWeightEntry!.measured_at, userTimezone)}`
                      : "Aún no hay registros"
                  }
                  accent="green"
                />
                <MetricCard
                  label="CAMBIO TOTAL"
                  icon={<TrendingDown size={18} />}
                  value={currentWeight ? `${loss > 0 ? "−" : "+"}${formatDecimal(Math.abs(loss))}` : "—"}
                  unit="kg"
                  foot={
                    currentWeight
                      ? `${Math.abs(lossPercent).toFixed(1)}% desde el inicio`
                      : `Inicio · ${startingWeight} kg`
                  }
                  accent="blue"
                />
                <MetricCard
                  label="PROMEDIO · 7 DÍAS"
                  icon={<LineChart size={18} />}
                  value={average7 ? formatDecimal(average7) : "—"}
                  unit={average7 ? "kg" : ""}
                  foot={average7 ? "Promedio de tus registros recientes" : "Registra tu peso para ver la tendencia"}
                  accent="purple"
                />
                <MetricCard
                  label="IMC ACTUAL"
                  icon={<Gauge size={18} />}
                  value={bmiNow ? bmiNow.toFixed(1) : "—"}
                  unit=""
                  foot={
                    bmiNow && profile
                      ? `Inicial · ${(startingWeight / (profile.height_cm / 100) ** 2).toFixed(1)}`
                      : "Se calcula con altura y peso"
                  }
                  accent="amber"
                />
              </section>
              <section className="content-grid">
                <div className="panel chart-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="eyebrow">TENDENCIA</div>
                      <h2>Evolución del peso</h2>
                    </div>
                    <div className="range-select" role="group" aria-label="Rango del gráfico">
                      {["30 días", "90 días", "6 meses", "1 año", "Todo"].map((item) => (
                        <button key={item} onClick={() => setRange(item)} className={range === item ? "selected" : ""}>
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                  {chartData.length ? (
                    <div className="chart-wrap">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 20, right: 8, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="weightFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#6fb99c" stopOpacity={0.22} />
                              <stop offset="100%" stopColor="#6fb99c" stopOpacity={0.01} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--line)" />
                          <XAxis
                            dataKey="date"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: "var(--muted)", fontSize: 11 }}
                            dy={10}
                            minTickGap={30}
                          />
                          <YAxis
                            domain={["dataMin - 2", "dataMax + 2"]}
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: "var(--muted)", fontSize: 11 }}
                            tickFormatter={(v) => `${v}`}
                          />
                          <Tooltip
                            contentStyle={{
                              borderRadius: 12,
                              border: "1px solid var(--line)",
                              boxShadow: "0 8px 24px #153b2b12",
                              background: "var(--panel)",
                              color: "var(--text)",
                            }}
                            formatter={(value) => [`${formatDecimal(Number(value))} kg`, "Peso"]}
                            labelStyle={{ color: "var(--muted)", marginBottom: 4 }}
                          />
                          <Area
                            type="monotone"
                            dataKey="peso"
                            stroke="#398766"
                            strokeWidth={2.7}
                            fill="url(#weightFill)"
                            activeDot={{ r: 5, strokeWidth: 3, stroke: "var(--panel)" }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <EmptyChart onAdd={() => setModal("weight")} />
                  )}
                  <div className="chart-legend">
                    <span>
                      <i className="legend-dot" /> Peso registrado
                    </span>
                    <span className="chart-note">Los cambios reflejan tus registros, no una recomendación médica.</span>
                  </div>
                </div>
                <div className="panel medication-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="eyebrow">TRATAMIENTO</div>
                      <h2>Medicación</h2>
                    </div>
                    <button
                      className="dots-button"
                      aria-label="Configurar concentración"
                      onClick={() => setModal("medication")}
                    >
                      <Settings size={17} />
                    </button>
                  </div>
                  {activeMedication ? (
                    <>
                      <div className="medication-name">
                        <div className="medication-symbol">
                          <Syringe size={21} />
                        </div>
                        <div>
                          <strong>{activeMedication.name}</strong>
                          <span>En seguimiento</span>
                        </div>
                        <span className="med-active">Activo</span>
                      </div>
                      <div className="dose-highlight">
                        <span>ÚLTIMO REGISTRO</span>
                        <strong>
                          {currentDose ? (
                            <>
                              <span>{currentDose.dose_mg}</span> <small>mg</small>
                            </>
                          ) : (
                            "—"
                          )}
                        </strong>
                        <p>
                          {currentDose
                            ? formatDate(currentDose.administered_at, userTimezone)
                            : "Sin dosis registradas"}
                        </p>
                      </div>
                      <div className="dose-details">
                        <span>Concentración</span>
                        <strong>
                          {activeMedication.concentration_mg} mg / {activeMedication.concentration_volume_ml} mL
                        </strong>
                        <span>Equivalencia</span>
                        <strong>
                          {(activeMedication.concentration_mg / activeMedication.concentration_volume_ml).toFixed(1)}{" "}
                          mg/mL{activeMedication.units_per_ml ? ` · U-100 habilitado` : ""}
                        </strong>
                      </div>
                      <button className="outline-button full-button" onClick={() => setModal("dose")}>
                        <Plus size={16} /> Registrar dosis
                      </button>
                    </>
                  ) : (
                    <EmptyInline label="Configura una medicación para empezar." />
                  )}
                </div>
              </section>
              <section className="lower-grid">
                <div className="panel goals-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="eyebrow">PASO A PASO</div>
                      <h2>Objetivos de peso</h2>
                    </div>
                    <span className="goal-caption">Desde {startingWeight} kg</span>
                  </div>
                  <div className="goals-list">
                    {goals.map(({ percent, weight }) => (
                      <div className="goal-row" key={percent}>
                        <div className="goal-number">
                          {percent}
                          <small>%</small>
                        </div>
                        <div className="goal-info">
                          <div className="goal-line">
                            <strong>{formatDecimal(weight)} kg</strong>
                            <span>{currentWeight ? `${Math.round(progress(weight))}%` : "Por comenzar"}</span>
                          </div>
                          <div className="progress-track">
                            <div style={{ width: `${progress(weight)}%` }} />
                          </div>
                        </div>
                        <div className={`goal-check ${progress(weight) >= 100 ? "done" : ""}`}>
                          {progress(weight) >= 100 ? <Check size={15} /> : <ArrowRight size={15} />}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="fine-print">
                    Metas informativas calculadas sobre tu peso inicial. Personalízalas con tu equipo de salud.
                  </p>
                </div>
                <div className="panel recent-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="eyebrow">TU ACTIVIDAD</div>
                      <h2>Registros recientes</h2>
                    </div>
                    <button className="text-button" onClick={() => setSection("Historial")}>
                      Ver historial <ArrowRight size={14} />
                    </button>
                  </div>
                  {sortedWeights.length || doses.length ? (
                    <div className="activity-list">
                      {[
                        ...sortedWeights.map((item) => ({
                          id: `w${item.id}`,
                          kind: "weight" as const,
                          date: item.measured_at,
                          text: `${formatDecimal(item.weight_kg)} kg`,
                          sub: "Peso registrado",
                        })),
                        ...doses.map((item) => ({
                          id: `d${item.id}`,
                          kind: "dose" as const,
                          date: item.administered_at,
                          text: `${item.dose_mg} mg`,
                          sub: "Dosis registrada",
                        })),
                      ]
                        .sort((a, b) => b.date.localeCompare(a.date))
                        .slice(0, 4)
                        .map((item) => (
                          <div className="activity-row" key={item.id}>
                            <div className={`activity-icon ${item.kind}`}>
                              {item.kind === "weight" ? <Scale size={16} /> : <Syringe size={16} />}
                            </div>
                            <div className="activity-copy">
                              <strong>{item.text}</strong>
                              <span>{item.sub}</span>
                            </div>
                            <time>{formatDate(item.date, userTimezone)}</time>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <EmptyInline
                      label="Tus registros aparecerán aquí."
                      action="Registrar peso"
                      onClick={() => setModal("weight")}
                    />
                  )}
                </div>
              </section>
              <div className="disclaimer">
                <ShieldCheck size={17} />
                <p>
                  <strong>Seguimiento, no diagnóstico.</strong> Esta herramienta organiza tus registros personales y no
                  sustituye la orientación de un profesional de salud. Las dosis y conversiones mostradas son cálculos
                  matemáticos basados en la concentración guardada.
                </p>
                <button aria-label="Más información">
                  <CircleHelp size={17} />
                </button>
              </div>
            </>
          ) : section === "Perfil y ajustes" ? (
            <AccountSettings
              token={token}
              onRefresh={() => refresh(token)}
              onProfileUpdated={setProfile}
              onPasswordChanged={logout}
              onError={setError}
            />
          ) : (
            <ModuleWorkspace
              section={section}
              token={token}
              weights={newestWeights}
              doses={doses}
              measurements={bodyMeasurements}
              medications={medications}
              entries={journalEntries}
              photos={photos}
              profile={profile}
              onNavigate={(target) => setSection(target)}
              onRefresh={() => refresh(token)}
              onError={setError}
              onNewWeight={() => setModal("weight")}
              onNewDose={(medication) => {
                setEditingDose(null)
                setDoseMedicationId(medication.id)
                setModal("dose")
              }}
              onEditWeight={(entry) => {
                setEditingWeight(entry)
                setModal("weight")
              }}
              onEditDose={(entry) => {
                setEditingDose(entry)
                setModal("dose")
              }}
              onEditMedication={(entry) => {
                setEditingMedication(entry)
                setModal("medication")
              }}
              onDelete={removeRecord}
            />
          )}
          {loading && (
            <div className="loading-indicator" role="status">
              Actualizando tus datos…
            </div>
          )}
        </div>
      </main>
      <nav className="mobile-bottom-nav" aria-label="Navegación móvil">
        {[
          { label: "Inicio" as Section, icon: Home },
          { label: "Registrar" as const, icon: Plus },
          { label: "Historial" as Section, icon: Clock3 },
          { label: "Análisis" as Section, icon: LineChart },
          { label: "Más" as const, icon: MoreHorizontal },
        ].map(({ label, icon: Icon }) => (
          <button
            key={label}
            className={section === label ? "active" : ""}
            onClick={() =>
              label === "Registrar" ? setModal("quick") : label === "Más" ? setMobileOpen(true) : setSection(label)
            }
          >
            <Icon size={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {modal === "quick" && (
        <QuickModal
          onClose={() => setModal(null)}
          onChoose={(target) => {
            if (target.modal) setModal(target.modal)
            else if (target.section) {
              setModal(null)
              setSection(target.section)
            }
          }}
        />
      )}
      {modal === "weight" && (
        <WeightModal
          key={editingWeight?.id ?? "new-weight"}
          entry={editingWeight ?? undefined}
          timezone={userTimezone}
          onClose={() => {
            setModal(null)
            setEditingWeight(null)
          }}
          onSubmit={submitWeight}
        />
      )}
      {modal === "dose" && (
        <DoseModal
          key={editingDose?.id ?? "new-dose"}
          entry={editingDose ?? undefined}
          timezone={userTimezone}
          onClose={() => {
            setModal(null)
            setEditingDose(null)
            setDoseMedicationId(null)
          }}
          medication={
            medications.find((item) => item.id === editingDose?.medication_id) ??
            medications.find((item) => item.id === doseMedicationId) ??
            activeMedication
          }
          onSubmit={submitDose}
        />
      )}
      {modal === "medication" && (editingMedication ?? activeMedication) && (
        <MedicationModal
          onClose={() => {
            setModal(null)
            setEditingMedication(null)
          }}
          medication={(editingMedication ?? activeMedication)!}
          onSubmit={updateMedication}
        />
      )}
      {mobileOpen && (
        <button className="mobile-backdrop" aria-label="Cerrar menú" onClick={() => setMobileOpen(false)} />
      )}
    </div>
  )
}

function MetricCard({
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

function AccountSettings({
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

function AccountDataTransfer({ token }: { token: string }) {
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
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = "forma-account-export.zip"
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setSuccess("Copia descargada. Guárdala en un lugar privado.")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo descargar la copia.")
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
          <p>Descarga tus registros y fotos o restaura una copia de esta cuenta.</p>
        </div>
        <Download size={19} />
      </div>
      <button className="outline-button" disabled={busy} onClick={() => void downloadExport()}>
        <Download size={16} /> Descargar copia
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

function AuthScreen({ onAuthenticated }: { onAuthenticated: (token: string) => void }) {
  const resetQuery = window.location.hash.split("?")[1] ?? ""
  const resetToken = new URLSearchParams(resetQuery).get("token")
  const [mode, setMode] = useState<AuthMode>(() => (resetToken ? "reset" : "login"))
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
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

function EmailVerificationScreen({ token }: { token: string }) {
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

function AnalysisWorkspace({
  weights,
  profile,
  doses,
  measurements,
  medications,
  entries,
  photos,
  onNavigate,
  onToggleMedicationsReviewed,
}: {
  weights: WeightEntry[]
  profile: Profile | null
  doses: DoseEntry[]
  measurements: BodyMeasurementEntry[]
  medications: Medication[]
  entries: JournalEntry[]
  photos: PhotoEntry[]
  onNavigate: (target: Section) => void
  onToggleMedicationsReviewed: (reviewed: boolean) => void
}) {
  const now = Date.now()
  const isWithinDays = (date: string, days: number) => {
    const elapsed = now - new Date(date).getTime()
    return elapsed >= 0 && elapsed <= days * 86400000
  }
  const pastMeasurements = measurements.filter((item) => new Date(item.measured_at).getTime() <= now)
  const pastDoses = doses.filter((item) => new Date(item.administered_at).getTime() <= now)
  const pastPhotos = photos.filter((item) => new Date(item.taken_at).getTime() <= now)
  const pastEntries = entries.filter((item) => new Date(item.occurred_at).getTime() <= now)
  const pastWeights = weights
    .filter((item) => new Date(item.measured_at).getTime() <= now)
    .sort((a, b) => a.measured_at.localeCompare(b.measured_at) || a.id - b.id)
  const latest = pastWeights.at(-1)
  const previous = pastWeights.at(-2)
  const recent = pastWeights.filter((item) => isWithinDays(item.measured_at, 7))
  const average = recent.length ? recent.reduce((sum, item) => sum + item.weight_kg, 0) / recent.length : null
  const elapsedDays =
    latest && previous
      ? (new Date(latest.measured_at).getTime() - new Date(previous.measured_at).getTime()) / 86400000
      : 0
  const weeklyChange =
    latest && previous && elapsedDays > 0 ? ((latest.weight_kg - previous.weight_kg) / elapsedDays) * 7 : null
  const monthlyWeights = pastWeights.filter((item) => isWithinDays(item.measured_at, 28))
  const monthlyTrend =
    monthlyWeights.length >= 2 ? monthlyWeights.at(-1)!.weight_kg - monthlyWeights[0].weight_kg : null
  const monthlyTrendSummary =
    monthlyTrend == null
      ? "No hay al menos dos registros de peso en las últimas 4 semanas para estimar una tendencia."
      : `La tendencia de peso durante las últimas 4 semanas es de ${monthlyTrend < 0 ? "−" : monthlyTrend > 0 ? "+" : ""}${formatDecimal(Math.abs(monthlyTrend))} kg.`
  const recentDoses = [...pastDoses].sort((a, b) => b.administered_at.localeCompare(a.administered_at))
  const currentDose = recentDoses[0]
  const doseSequence = currentDose
    ? recentDoses.slice(
        0,
        recentDoses.findIndex(
          (item) => item.medication_id !== currentDose.medication_id || item.dose_mg !== currentDose.dose_mg,
        ) < 0
          ? recentDoses.length
          : recentDoses.findIndex(
              (item) => item.medication_id !== currentDose.medication_id || item.dose_mg !== currentDose.dose_mg,
            ),
      )
    : []
  const doseStartedAt = doseSequence.at(-1)?.administered_at
  const doseDays = doseStartedAt ? Math.max(0, (now - new Date(doseStartedAt).getTime()) / 86400000) : 0
  const symptoms = pastEntries.filter((entry) => entry.module === "symptoms")
  const doseSymptoms = symptoms.filter(
    (entry) =>
      currentDose &&
      new Date(entry.occurred_at).getTime() >= new Date(doseStartedAt ?? currentDose.administered_at).getTime(),
  )
  const concerningSymptoms = doseSymptoms.filter((entry) => {
    const tolerance = String(entry.data.tolerance ?? "")
    const results = Array.isArray(entry.data.results) ? (entry.data.results as CatalogResult[]) : []
    const maxSeverity = results.reduce((max, result) => Math.max(max, Number(result.severity ?? 0)), 0)
    return maxSeverity >= 5 || tolerance === "Con molestias moderadas" || tolerance === "Con molestias importantes"
  })
  const hasGastrointestinalSymptoms = concerningSymptoms.some(
    (entry) =>
      Array.isArray(entry.data.results) &&
      (entry.data.results as CatalogResult[]).some(
        (result) => result.category === "Gastrointestinal" && Number(result.severity ?? 0) >= 5,
      ),
  )
  const goodToleranceRecorded = doseSymptoms.some((entry) => entry.data.tolerance === "Buena")
  const doseMedication = currentDose && medications.find((item) => item.id === currentDose.medication_id)
  const compositionChanges =
    previous && latest
      ? compositionFields.flatMap(([key, label, unit]) => {
          const current = latest[key]
          const before = previous[key]
          return current == null || before == null ? [] : [{ label, unit, current, change: current - before }]
        })
      : []
  const chart = pastWeights.map((item) => ({
    date: formatDate(item.measured_at, profile?.timezone),
    peso: item.weight_kg,
  }))
  const labEntries = pastEntries.filter((entry) => entry.module === "labs")
  const reviewEntries = pastEntries.filter((entry) => entry.module === "reviews")
  const recentSymptoms = symptoms.filter((entry) => isWithinDays(entry.occurred_at, 7))
  const weeklyCheckIn = recentSymptoms.find((entry) => entry.data.appetite != null && entry.data.satiety != null)
  const currentWaist = pastMeasurements.some((item) => item.waist_cm != null)
  const recentWaist = pastMeasurements.some((item) => item.waist_cm != null && isWithinDays(item.measured_at, 28))
  const hasBaselineLabs = labEntries.some((entry) => entry.data.phase === "Basal")
  const hasPeriodicLabs = labEntries.some((entry) => entry.data.phase === "Seguimiento")
  const hasRelevantHistory = reviewEntries.some((entry) => String(entry.data.relevant_history ?? "").trim())
  const hasRecentTreatmentReview = reviewEntries.some(
    (entry) => entry.data.review_type === "Tratamiento" && isWithinDays(entry.occurred_at, 90),
  )
  const hasRecentBloodPressure = labEntries.some(
    (entry) =>
      isWithinDays(entry.occurred_at, 7) &&
      Array.isArray(entry.data.results) &&
      (entry.data.results as CatalogResult[]).some((result) => result.systolic != null),
  )
  type ChecklistTask = {
    label: string
    done: boolean
    target: Section
    detail?: string
    toggle?: (value: boolean) => void
  }
  const checklistGroups: { title: string; subtitle: string; tasks: ChecklistTask[] }[] = [
    {
      title: "Antes de iniciar",
      subtitle:
        "Punto de partida para conversar con tu equipo; tener datos guardados no valida si están vigentes o si es clínicamente adecuado iniciar.",
      tasks: [
        { label: "Peso inicial", done: pastWeights.length > 0, target: "Peso" as Section },
        { label: "Cintura", done: currentWaist, target: "Medidas" as Section },
        {
          label: "Presión arterial",
          done: labEntries.some(
            (entry) =>
              Array.isArray(entry.data.results) &&
              (entry.data.results as CatalogResult[]).some((result) => result.systolic != null),
          ),
          target: "Laboratorios" as Section,
        },
        {
          label: "Revisar y confirmar medicamentos actuales",
          done: profile?.medications_reviewed ?? false,
          target: "Medicación" as Section,
          toggle: onToggleMedicationsReviewed,
        },
        { label: "Antecedentes relevantes", done: hasRelevantHistory, target: "Revisiones" as Section },
        {
          label: "Laboratorio basal según indicación clínica",
          done: hasBaselineLabs,
          target: "Laboratorios" as Section,
        },
      ],
    },
    {
      title: "Cada día",
      subtitle: "Registro diario recomendado.",
      tasks: [
        {
          label: "Peso",
          done: pastWeights.some((item) => isWithinDays(item.measured_at, 1)),
          target: "Peso" as Section,
        },
      ],
    },
    {
      title: "Cada semana",
      subtitle: "Seguimiento de los últimos 7 días.",
      tasks: [
        {
          label: "Dosis registrada",
          done: pastDoses.some((item) => isWithinDays(item.administered_at, 7)),
          target: "Medicación" as Section,
        },
        {
          label: "Presión arterial",
          done: hasRecentBloodPressure,
          target: "Laboratorios" as Section,
        },
        { label: "Apetito y saciedad", done: Boolean(weeklyCheckIn), target: "Síntomas" as Section },
        {
          label: "Síntomas y tolerancia",
          done: recentSymptoms.some(
            (entry) =>
              (Array.isArray(entry.data.results) && (entry.data.results as CatalogResult[]).length > 0) ||
              entry.data.tolerance != null,
          ),
          target: "Síntomas" as Section,
        },
        {
          label: "Hidratación",
          done: recentSymptoms.some((entry) => entry.data.hydration_l != null),
          target: "Síntomas" as Section,
        },
        {
          label: "Actividad",
          done: pastEntries.some((entry) => entry.module === "activity" && isWithinDays(entry.occurred_at, 7)),
          target: "Actividad" as Section,
        },
      ],
    },
    {
      title: "Cada 4 semanas",
      subtitle: "Revisa cambios y contexto del último periodo de 28 días.",
      tasks: [
        {
          label: "Peso y tendencia",
          done: monthlyTrend != null,
          detail:
            monthlyTrend == null
              ? undefined
              : `${monthlyTrend > 0 ? "+" : ""}${formatDecimal(monthlyTrend)} kg en 28 días`,
          target: "Peso" as Section,
        },
        { label: "Cintura", done: recentWaist, target: "Medidas" as Section },
        {
          label: "Fotografías",
          done: pastPhotos.some((item) => isWithinDays(item.taken_at, 28)),
          target: "Fotos" as Section,
        },
        {
          label: "Composición corporal",
          done: monthlyWeights.some((item) => compositionFields.some(([key]) => item[key] != null)),
          target: "Composición" as Section,
        },
        {
          label: "Síntomas y tolerancia",
          done: symptoms.some(
            (entry) =>
              isWithinDays(entry.occurred_at, 28) &&
              ((Array.isArray(entry.data.results) && (entry.data.results as CatalogResult[]).length > 0) ||
                entry.data.tolerance != null),
          ),
          target: "Síntomas" as Section,
        },
        {
          label: "Dosis actual y tiempo desde el primer registro",
          done: Boolean(currentDose),
          detail: currentDose && doseStartedAt ? `${formatDecimal(doseDays / 7)} semanas según registros` : undefined,
          target: "Medicación" as Section,
        },
        {
          label: "Revisión de objetivos",
          done: pastEntries.some((entry) => entry.module === "goals" && isWithinDays(entry.occurred_at, 28)),
          target: "Objetivos" as Section,
        },
      ],
    },
    {
      title: "Periódicamente, según indicación clínica",
      subtitle: "La frecuencia y las pruebas se acuerdan con tu profesional de salud.",
      tasks: [
        { label: "Laboratorios según situación clínica", done: hasPeriodicLabs, target: "Laboratorios" as Section },
        {
          label: "Revisión reciente del tratamiento (3 meses)",
          done: hasRecentTreatmentReview,
          target: "Revisiones" as Section,
        },
      ],
    },
  ]
  const recommendation = !currentDose
    ? {
        title: "Seguimiento de dosis",
        message:
          "Aún no hay dosis registradas. Añade tus registros para mostrar un resumen descriptivo de tiempo y tolerancia.",
        caution: false,
      }
    : concerningSymptoms.length
      ? {
          title: "Precaución",
          message: `${hasGastrointestinalSymptoms ? "Se registraron síntomas gastrointestinales" : `Hay ${concerningSymptoms.length === 1 ? "un registro" : `${concerningSymptoms.length} registros`} de síntomas`} durante el periodo de la dosis actual con intensidad de 5/10 o más, o tolerancia percibida con molestias moderadas/importantes. ${monthlyTrendSummary} Conviene revisar tolerancia, hidratación y evolución con un profesional de salud antes de considerar cualquier cambio.`,
          caution: true,
        }
      : doseDays >= 28 && goodToleranceRecorded
        ? {
            title: "Revisión de dosis",
            message: `La misma dosis aparece registrada desde hace ${formatDecimal(doseDays / 7)} semanas. Se registró tolerancia percibida como buena y no aparecen síntomas de intensidad 5/10 o más en este periodo. ${monthlyTrendSummary} Considera revisar la respuesta y la tolerancia con tu profesional de salud antes de realizar cualquier cambio de dosis.`,
            caution: false,
          }
        : doseDays >= 28
          ? {
              title: "Revisión de seguimiento",
              message: `La misma dosis aparece en los registros desde hace ${formatDecimal(doseDays / 7)} semanas. La tolerancia no está documentada como buena; la ausencia de síntomas registrados no confirma que no los haya. ${monthlyTrendSummary} Considera revisar respuesta y tolerancia con tu profesional de salud antes de cualquier cambio.`,
              caution: false,
            }
          : {
              title: "Seguimiento de dosis",
              message: `Hay ${formatDecimal(doseDays / 7)} semanas entre el primer registro disponible de esta dosis y hoy. Estos datos son descriptivos y no indican cuándo cambiarla; revisa cualquier decisión con tu profesional de salud.`,
              caution: false,
            }

  return (
    <section className="module-page">
      <div className="module-heading">
        <div>
          <div className="eyebrow">RESUMEN DESCRIPTIVO</div>
          <h1>Análisis</h1>
        </div>
      </div>
      <p className="module-hint">
        Comparaciones basadas en tus registros. El checklist orienta qué datos podrías revisar con tu equipo de salud;
        no determina si estás listo para iniciar o cambiar un tratamiento.
      </p>
      <div className="metric-grid analysis-metrics">
        <MetricCard
          label="REGISTROS DE PESO"
          icon={<Scale size={18} />}
          value={String(pastWeights.length)}
          unit=""
          foot="Lecturas guardadas"
          accent="green"
        />
        <MetricCard
          label="PROMEDIO · 7 DÍAS"
          icon={<LineChart size={18} />}
          value={average == null ? "—" : formatDecimal(average)}
          unit={average == null ? "" : "kg"}
          foot={`${recent.length} ${recent.length === 1 ? "registro" : "registros"} recientes`}
          accent="blue"
        />
        <MetricCard
          label="CAMBIO SEMANAL ESTIMADO"
          icon={<TrendingDown size={18} />}
          value={weeklyChange == null ? "—" : `${weeklyChange > 0 ? "+" : ""}${formatDecimal(weeklyChange)}`}
          unit={weeklyChange == null ? "" : "kg/sem"}
          foot="Entre las dos lecturas más recientes"
          accent="purple"
        />
        <MetricCard
          label="ÚLTIMO PESO"
          icon={<Activity size={18} />}
          value={latest ? formatDecimal(latest.weight_kg) : "—"}
          unit={latest ? "kg" : ""}
          foot={latest ? formatDate(latest.measured_at, profile?.timezone) : "Aún no hay datos"}
          accent="amber"
        />
      </div>
      <section className="followup-section" aria-labelledby="followup-title">
        <div className="followup-heading">
          <div>
            <div className="eyebrow">ORGANIZA TU SEGUIMIENTO</div>
            <h2 id="followup-title">Checklist contextual</h2>
          </div>
          <span>El estado se actualiza con tus registros</span>
        </div>
        <div className="followup-grid">
          {checklistGroups.map((group) => (
            <article className="followup-card" key={group.title}>
              <div className="followup-card-heading">
                <div>
                  <h3>{group.title}</h3>
                  <p>{group.subtitle}</p>
                </div>
                <span className="followup-count">
                  {group.tasks.filter((task) => task.done).length}/{group.tasks.length}
                </span>
              </div>
              <ul className="followup-list">
                {group.tasks.map((task) => (
                  <li key={task.label} className={task.done ? "complete" : "pending"}>
                    {task.toggle ? (
                      <button
                        type="button"
                        className="followup-status followup-toggle"
                        aria-pressed={task.done}
                        aria-label={task.done ? "Marcar como pendiente" : "Marcar como confirmado"}
                        onClick={() => task.toggle?.(!task.done)}
                      >
                        {task.done ? <Check size={14} /> : <span />}
                      </button>
                    ) : (
                      <span className="followup-status" aria-label={task.done ? "Registrado" : "Pendiente"}>
                        {task.done ? <Check size={14} /> : <span />}
                      </span>
                    )}
                    <div className="followup-task-copy">
                      <strong>{task.label}</strong>
                      {task.detail && <small>{task.detail}</small>}
                    </div>
                    {!task.done && !task.toggle && (
                      <button type="button" className="followup-action" onClick={() => onNavigate(task.target)}>
                        Registrar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
      <aside className={`recommendation-card ${recommendation.caution ? "caution" : ""}`} aria-live="polite">
        <div className="recommendation-icon">
          {recommendation.caution ? <HeartPulse size={19} /> : <ShieldCheck size={19} />}
        </div>
        <div>
          <div className="eyebrow">SEGUIMIENTO INFORMATIVO</div>
          <h2>{recommendation.title}</h2>
          {currentDose && (
            <div className="recommendation-context">
              {doseMedication?.name ?? "Dosis registrada"} · {formatDecimal(currentDose.dose_mg)} mg · último registro{" "}
              {formatDate(currentDose.administered_at, profile?.timezone)}
            </div>
          )}
          <p>{recommendation.message}</p>
          <small>
            Resumen automático de los datos registrados; no diagnostica ni recomienda iniciar, suspender o cambiar
            dosis.
          </small>
        </div>
      </aside>
      <div className="panel analysis-chart-panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">SERIE TEMPORAL</div>
            <h2>Peso registrado</h2>
          </div>
          <span className="goal-caption">{pastWeights.length} lecturas</span>
        </div>
        {chart.length ? (
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ top: 20, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="analysisWeightFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6fb99c" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#6fb99c" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--line)" />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--muted)", fontSize: 11 }}
                  minTickGap={30}
                />
                <YAxis
                  domain={["dataMin - 2", "dataMax + 2"]}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--muted)", fontSize: 11 }}
                />
                <Tooltip formatter={(value) => [`${formatDecimal(Number(value))} kg`, "Peso"]} />
                <Area
                  type="monotone"
                  dataKey="peso"
                  stroke="#398766"
                  strokeWidth={2.7}
                  fill="url(#analysisWeightFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyModule text="Registra al menos un peso para ver su evolución." />
        )}
      </div>
      <h2 className="module-subheading">Cambio de composición entre las dos últimas lecturas</h2>
      {compositionChanges.length ? (
        <div className="composition-results">
          {compositionChanges.map(({ label, unit, current, change }) => (
            <div key={label}>
              <span>{label}</span>
              <strong>
                {formatDecimal(current)} {unit}
              </strong>
              <small className="analysis-delta">
                {change > 0 ? "+" : ""}
                {formatDecimal(change)} {unit}
              </small>
            </div>
          ))}
        </div>
      ) : (
        <EmptyModule text="Se necesitan dos lecturas con datos de composición para compararlas." />
      )}
    </section>
  )
}

function EmptyInline({ label, action, onClick }: { label: string; action?: string; onClick?: () => void }) {
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
function EmptyChart({ onAdd }: { onAdd: () => void }) {
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
const journalModuleBySection: Partial<Record<Section, JournalModule>> = {
  Síntomas: "symptoms",
  Actividad: "activity",
  Laboratorios: "labs",
  Objetivos: "goals",
  Revisiones: "reviews",
  Recordatorios: "reminders",
}
const journalDefinitions: Record<
  JournalModule,
  { title: string; fields: { key: string; label: string; type?: string; options?: string[] }[] }
> = {
  symptoms: {
    title: "check-in semanal",
    fields: [
      { key: "appetite", label: "Apetito", options: ["Menor", "Sin cambios", "Mayor"] },
      { key: "satiety", label: "Saciedad", options: ["Menor", "Sin cambios", "Mayor"] },
      { key: "hydration_l", label: "Hidratación aproximada (L)", type: "number" },
      {
        key: "tolerance",
        label: "Tolerancia percibida",
        options: ["Buena", "Con molestias leves", "Con molestias moderadas", "Con molestias importantes"],
      },
    ],
  },
  activity: {
    title: "actividad",
    fields: [
      { key: "entry_type", label: "Tipo de registro" },
      { key: "activity_type", label: "Actividad" },
      { key: "other_activity", label: "Otra actividad" },
      { key: "duration_min", label: "Duración (min)", type: "number" },
      { key: "distance_km", label: "Distancia (km)", type: "number" },
      { key: "calories_kcal", label: "Calorías (kcal)", type: "number" },
      { key: "intensity", label: "Intensidad", options: ["Suave", "Moderada", "Intensa"] },
      { key: "weekly_calories_kcal", label: "Calorías semanales (kcal)", type: "number" },
      { key: "weekly_steps", label: "Pasos semanales", type: "number" },
      { key: "weekly_distance_km", label: "Distancia semanal (km)", type: "number" },
    ],
  },
  labs: {
    title: "resultado de laboratorio",
    fields: [],
  },
  goals: {
    title: "objetivo",
    fields: [],
  },
  reviews: {
    title: "revisión",
    fields: [
      { key: "review_type", label: "Tipo de revisión", options: ["Tratamiento", "Seguimiento general"] },
      { key: "provider", label: "Profesional / centro" },
      { key: "relevant_history", label: "Antecedentes relevantes", type: "text" },
      { key: "follow_up_date", label: "Seguimiento", type: "date" },
      { key: "topics", label: "Temas tratados" },
    ],
  },
  reminders: {
    title: "recordatorio",
    fields: [
      { key: "reminder_at", label: "Fecha y hora", type: "datetime-local" },
      { key: "repeat", label: "Repetición", options: ["No repetir", "Diario", "Semanal", "Mensual"] },
      { key: "enabled", label: "Activo", options: ["Sí", "No"] },
    ],
  },
}
const journalSectionLabels: Record<JournalModule, Section> = {
  symptoms: "Síntomas",
  activity: "Actividad",
  labs: "Laboratorios",
  goals: "Objetivos",
  reviews: "Revisiones",
  reminders: "Recordatorios",
}

function ModuleWorkspace(props: {
  section: Section
  token: string
  weights: WeightEntry[]
  doses: DoseEntry[]
  measurements: BodyMeasurementEntry[]
  medications: Medication[]
  entries: JournalEntry[]
  photos: PhotoEntry[]
  profile: Profile | null
  onNavigate: (target: Section) => void
  onRefresh: () => Promise<void>
  onError: (message: string) => void
  onNewWeight: () => void
  onNewDose: (medication: Medication) => void
  onEditWeight: (entry: WeightEntry) => void
  onEditDose: (entry: DoseEntry) => void
  onEditMedication: (entry: Medication) => void
  onDelete: (path: string) => Promise<void>
}) {
  const { section, token, weights, doses, measurements, medications, entries, photos } = props
  const userTimezone = props.profile?.timezone ?? "America/Bogota"
  const module = journalModuleBySection[section]
  const compositionWeights = [...weights]
    .sort((a, b) => b.measured_at.localeCompare(a.measured_at) || b.id - a.id)
    .filter((item) => compositionFields.some(([key]) => item[key] != null))
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null)
  const [showEntryForm, setShowEntryForm] = useState(false)
  const [editingMeasurement, setEditingMeasurement] = useState<BodyMeasurementEntry | null>(null)
  const [showMeasurementForm, setShowMeasurementForm] = useState(false)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoCaption, setPhotoCaption] = useState("")
  const [photoDate, setPhotoDate] = useState(() => dateTimeInputValue(new Date().toISOString(), userTimezone))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [showNewMedication, setShowNewMedication] = useState(false)
  const [telegram, setTelegram] = useState<TelegramConnection | null>(null)
  const [pairingUrl, setPairingUrl] = useState("")
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [showCatalogEntryForm, setShowCatalogEntryForm] = useState(false)
  const [editingCatalogEntry, setEditingCatalogEntry] = useState<JournalEntry | null>(null)
  const [editingThresholdsItem, setEditingThresholdsItem] = useState<CatalogItem | null>(null)
  const catalogCategory: CatalogCategory | undefined =
    section === "Síntomas"
      ? "symptom"
      : section === "Objetivos"
        ? "goal"
        : section === "Laboratorios"
          ? "lab"
          : undefined
  const catalogModule: JournalModule | undefined =
    catalogCategory === "symptom"
      ? "symptoms"
      : catalogCategory === "goal"
        ? "goals"
        : catalogCategory === "lab"
          ? "labs"
          : undefined
  const orderedCatalog =
    catalogCategory === "lab"
      ? [...catalog].sort(
          (a, b) =>
            Number(b.is_blood_pressure) - Number(a.is_blood_pressure) ||
            a.sort_order - b.sort_order ||
            a.name.localeCompare(b.name),
        )
      : catalog

  useEffect(() => {
    if (!catalogCategory) return
    let active = true
    void api<CatalogItem[]>(`/catalog/${catalogCategory}`, token)
      .then((items) => {
        if (active) setCatalog(items)
      })
      .catch((reason: Error) => props.onError(reason.message))
    return () => {
      active = false
    }
  }, [catalogCategory, token, props.onError])

  async function addCatalogItem(
    name: string,
    unit: string,
    symptomCategory?: "Gastrointestinal" | "Otro",
    thresholds?: { normal_min: number | null; normal_max: number | null },
  ) {
    if (!catalogCategory) return
    const created = await api<CatalogItem>("/catalog", token, {
      method: "POST",
      body: JSON.stringify({
        category: catalogCategory,
        name,
        unit: unit || null,
        symptom_category: symptomCategory ?? null,
        normal_min: thresholds?.normal_min ?? null,
        normal_max: thresholds?.normal_max ?? null,
      }),
    })
    setCatalog((current) => [...current, created])
  }

  async function updateCatalogThresholds(
    item: CatalogItem,
    normalMin: number | null,
    normalMax: number | null,
    diastolicMin: number | null,
    diastolicMax: number | null,
  ) {
    const updated = await api<CatalogItem>(`/catalog/${item.id}/thresholds`, token, {
      method: "PATCH",
      body: JSON.stringify({
        normal_min: normalMin,
        normal_max: normalMax,
        diastolic_normal_min: item.is_blood_pressure ? diastolicMin : null,
        diastolic_normal_max: item.is_blood_pressure ? diastolicMax : null,
      }),
    })
    setCatalog((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)))
  }

  async function moveCatalogItem(item: CatalogItem, direction: "up" | "down") {
    if (!catalogCategory) return
    const orderable = orderedCatalog.filter((entry) => !entry.is_blood_pressure)
    const index = orderable.findIndex((entry) => entry.id === item.id)
    const targetIndex = direction === "up" ? index - 1 : index + 1
    if (index < 0 || targetIndex < 0 || targetIndex >= orderable.length) return
    const reordered = [...orderable]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(targetIndex, 0, moved)
    const bloodPressureItem = orderedCatalog.find((entry) => entry.is_blood_pressure)
    const fullOrder = bloodPressureItem ? [bloodPressureItem, ...reordered] : reordered
    setCatalog(fullOrder.map((entry, sortOrder) => ({ ...entry, sort_order: sortOrder })))
    try {
      const updated = await api<CatalogItem[]>(`/catalog/${catalogCategory}/order`, token, {
        method: "PUT",
        body: JSON.stringify({ item_ids: fullOrder.map((entry) => entry.id) }),
      })
      setCatalog(updated)
    } catch (reason) {
      props.onError(reason instanceof Error ? reason.message : "No se pudo reordenar la lista")
    }
  }

  async function removeCatalogItem(item: CatalogItem) {
    if (!window.confirm(`¿Quitar "${item.name}" de tu lista? No afecta a los registros ya guardados.`)) return
    try {
      await api<void>(`/catalog/${item.id}`, token, { method: "DELETE" })
      setCatalog((current) => current.filter((entry) => entry.id !== item.id))
    } catch (reason) {
      props.onError(reason instanceof Error ? reason.message : "No se pudo quitar el elemento")
    }
  }

  async function saveCatalogEntry(payload: Omit<JournalEntry, "id" | "created_at" | "updated_at">) {
    await api(editingCatalogEntry ? `/entries/${editingCatalogEntry.id}` : "/entries", token, {
      method: editingCatalogEntry ? "PUT" : "POST",
      body: JSON.stringify(payload),
    })
    await props.onRefresh()
    setShowCatalogEntryForm(false)
    setEditingCatalogEntry(null)
  }

  async function toggleMedicationsReviewed(reviewed: boolean) {
    try {
      await api<Profile>("/profile/medications-review", token, {
        method: "PATCH",
        body: JSON.stringify({ reviewed }),
      })
      await props.onRefresh()
    } catch (reason) {
      props.onError(reason instanceof Error ? reason.message : "No se pudo actualizar la revisión de medicamentos")
    }
  }

  useEffect(() => {
    if (section !== "Recordatorios") return
    let active = true
    void api<TelegramConnection>("/telegram/connection", token)
      .then((status) => {
        if (active) setTelegram(status)
      })
      .catch((reason: Error) => props.onError(reason.message))
    return () => {
      active = false
    }
  }, [section, token, props.onError])

  useEffect(() => {
    if (!pairingUrl || telegram?.linked) return
    const timer = window.setInterval(() => {
      void api<TelegramConnection>("/telegram/connection", token)
        .then(setTelegram)
        .catch(() => undefined)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [pairingUrl, telegram?.linked, token])

  async function linkTelegram() {
    try {
      const pairing = await api<TelegramPairing>("/telegram/connection", token, { method: "POST" })
      setPairingUrl(pairing.start_url)
    } catch (reason) {
      props.onError(reason instanceof Error ? reason.message : "No se pudo generar el enlace de Telegram")
    }
  }

  async function unlinkTelegram() {
    if (!window.confirm("¿Desvincular Telegram de esta cuenta? Dejarás de recibir avisos por ese chat.")) return
    try {
      await api<void>("/telegram/connection", token, { method: "DELETE" })
      setPairingUrl("")
      setTelegram((current) => (current ? { ...current, linked: false } : current))
    } catch (reason) {
      props.onError(reason instanceof Error ? reason.message : "No se pudo desconectar Telegram")
    }
  }

  async function saveJournal(payload: Omit<JournalEntry, "id" | "created_at" | "updated_at">) {
    await api(editingEntry ? `/entries/${editingEntry.id}` : "/entries", token, {
      method: editingEntry ? "PUT" : "POST",
      body: JSON.stringify(payload),
    })
    await props.onRefresh()
    setShowEntryForm(false)
    setEditingEntry(null)
  }
  async function setReminderEnabled(entry: JournalEntry, enabled: boolean) {
    try {
      await api<JournalEntry>(`/entries/${entry.id}/enabled`, token, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      })
      await props.onRefresh()
    } catch (reason) {
      props.onError(reason instanceof Error ? reason.message : "No se pudo actualizar el recordatorio")
    }
  }
  async function saveMeasurement(payload: Record<string, unknown>) {
    await api(editingMeasurement ? `/body-measurements/${editingMeasurement.id}` : "/body-measurements", token, {
      method: editingMeasurement ? "PUT" : "POST",
      body: JSON.stringify(payload),
    })
    await props.onRefresh()
    setShowMeasurementForm(false)
    setEditingMeasurement(null)
  }
  async function submitPhoto(event: FormEvent) {
    event.preventDefault()
    if (!photoFile) return
    setBusy(true)
    setError("")
    try {
      await uploadPhoto(token, photoFile, photoCaption, localDateTimeToIso(photoDate, userTimezone))
      setPhotoFile(null)
      setPhotoCaption("")
      setPhotoDate(dateTimeInputValue(new Date().toISOString(), userTimezone))
      await props.onRefresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo cargar la foto")
    } finally {
      setBusy(false)
    }
  }
  async function createMedication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError("")
    try {
      await api("/medications", token, {
        method: "POST",
        body: JSON.stringify({
          name: String(form.get("name")),
          active: true,
          concentration_mg: Number(form.get("concentration_mg")),
          concentration_volume_ml: Number(form.get("concentration_volume_ml")),
          units_per_ml: form.get("units_per_ml") ? Number(form.get("units_per_ml")) : null,
        }),
      })
      setShowNewMedication(false)
      await props.onRefresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="module-page">
      {section !== "Análisis" && (
        <div className="module-heading">
          <div>
            <div className="eyebrow">TU ESPACIO PERSONAL</div>
            <h1>{section}</h1>
          </div>
          {section === "Peso" && (
            <button className="primary-button" onClick={props.onNewWeight}>
              <Plus size={16} /> Registrar peso
            </button>
          )}
          {section === "Composición" && (
            <button className="primary-button" onClick={props.onNewWeight}>
              <Plus size={16} /> Registrar lectura
            </button>
          )}
          {section === "Medicación" && (
            <button className="primary-button" onClick={() => setShowNewMedication(true)}>
              <Plus size={16} /> Añadir medicación
            </button>
          )}
          {section === "Medidas" && (
            <button
              className="primary-button"
              onClick={() => {
                setEditingMeasurement(null)
                setShowMeasurementForm(true)
              }}
            >
              <Plus size={16} /> Registrar medidas
            </button>
          )}
          {module && !catalogCategory && (
            <button
              className="primary-button"
              onClick={() => {
                setEditingEntry(null)
                setShowEntryForm(true)
              }}
            >
              <Plus size={16} /> Añadir {journalDefinitions[module].title}
            </button>
          )}
          {section === "Síntomas" && (
            <>
              <button
                className="primary-button"
                onClick={() => {
                  setEditingCatalogEntry(null)
                  setShowCatalogEntryForm(true)
                }}
              >
                <Plus size={16} /> Registrar síntoma
              </button>
              <button
                className="outline-button"
                onClick={() => {
                  setEditingEntry(null)
                  setShowEntryForm(true)
                }}
              >
                Check-in semanal
              </button>
            </>
          )}
          {(section === "Objetivos" || section === "Laboratorios") && (
            <button
              className="primary-button"
              onClick={() => {
                setEditingCatalogEntry(null)
                setShowCatalogEntryForm(true)
              }}
            >
              <Plus size={16} /> {section === "Objetivos" ? "Registrar objetivo" : "Registrar resultados"}
            </button>
          )}
        </div>
      )}

      {section === "Composición" && (
        <>
          <p className="module-hint">
            Lecturas de báscula; son estimaciones del dispositivo, no mediciones diagnósticas. Todos los campos de
            composición son opcionales.
          </p>
          <div className="record-list">
            {compositionWeights.map((item) => (
              <article className="record-card" key={item.id}>
                <div className="record-card-heading">
                  <div>
                    <strong>{formatDecimal(item.weight_kg)} kg</strong>
                    <time>{formatDateTime(item.measured_at, userTimezone)}</time>
                  </div>
                  <RecordActions
                    onEdit={() => props.onEditWeight(item)}
                    onDelete={() => void props.onDelete(`/weights/${item.id}`)}
                  />
                </div>
                <div className="composition-results">
                  {compositionFields
                    .filter(([key]) => item[key] != null)
                    .map(([key, label, unit]) => (
                      <div key={key}>
                        <span>{label}</span>
                        <strong>
                          {formatDecimal(Number(item[key]))} {unit}
                        </strong>
                      </div>
                    ))}
                </div>
                {item.notes && <p>{item.notes}</p>}
              </article>
            ))}
            {!compositionWeights.length && (
              <EmptyModule text="Registra una lectura con datos de composición para empezar." />
            )}
          </div>
        </>
      )}

      {section === "Análisis" && (
        <AnalysisWorkspace
          weights={weights}
          profile={props.profile}
          doses={doses}
          measurements={measurements}
          medications={medications}
          entries={entries}
          photos={photos}
          onNavigate={props.onNavigate}
          onToggleMedicationsReviewed={(reviewed) => void toggleMedicationsReviewed(reviewed)}
        />
      )}

      {section === "Peso" && (
        <div className="record-list">
          {weights.map((item) => (
            <article className="record-card" key={item.id}>
              <div className="record-card-heading">
                <div>
                  <strong>{formatDecimal(item.weight_kg)} kg</strong>
                  <time>{formatDateTime(item.measured_at, userTimezone)}</time>
                </div>
                <RecordActions
                  onEdit={() => props.onEditWeight(item)}
                  onDelete={() => void props.onDelete(`/weights/${item.id}`)}
                />
              </div>
              {item.notes && <p>{item.notes}</p>}
            </article>
          ))}
          {!weights.length && <EmptyModule text="Aún no hay registros de peso." />}
        </div>
      )}

      {section === "Medidas" && (
        <div className="record-list">
          {measurements.map((item) => (
            <article className="record-card" key={item.id}>
              <div className="record-card-heading">
                <strong>{formatDateTime(item.measured_at, userTimezone)}</strong>
                <RecordActions
                  onEdit={() => {
                    setEditingMeasurement(item)
                    setShowMeasurementForm(true)
                  }}
                  onDelete={() => void props.onDelete(`/body-measurements/${item.id}`)}
                />
              </div>
              <div className="composition-results">
                {bodyFields
                  .filter(([key]) => item[key] != null)
                  .map(([key, label, unit]) => (
                    <div key={key}>
                      <span>{label}</span>
                      <strong>
                        {formatDecimal(Number(item[key]))} {unit}
                      </strong>
                    </div>
                  ))}
              </div>
              {item.notes && <p>{item.notes}</p>}
            </article>
          ))}
          {!measurements.length && <EmptyModule text="Registra medidas corporales para ver su evolución." />}
        </div>
      )}

      {section === "Medicación" && (
        <>
          <div className="record-list">
            {medications.map((item) => (
              <article className="record-card" key={item.id}>
                <div className="record-card-heading">
                  <div>
                    <strong>{item.name}</strong>
                    <span className={`record-status ${item.active ? "active" : ""}`}>
                      {item.active ? "Activa" : "Archivada"}
                    </span>
                    <p>
                      {item.concentration_mg} mg / {item.concentration_volume_ml} mL
                      {item.units_per_ml ? ` · U-${item.units_per_ml}` : ""}
                    </p>
                  </div>
                  <div className="record-actions">
                    {item.active && (
                      <button className="small-action" onClick={() => props.onNewDose(item)}>
                        <Plus size={13} /> Registrar dosis
                      </button>
                    )}
                    <button
                      className="small-action"
                      onClick={() => {
                        props.onEditMedication(item)
                      }}
                    >
                      Editar
                    </button>
                    {item.active ? (
                      <button
                        className="small-action danger"
                        onClick={() =>
                          api(`/medications/${item.id}`, token, { method: "DELETE" })
                            .then(props.onRefresh)
                            .catch((e: Error) => props.onError(e.message))
                        }
                      >
                        Archivar
                      </button>
                    ) : (
                      <button
                        className="small-action"
                        onClick={() =>
                          api(`/medications/${item.id}`, token, {
                            method: "PUT",
                            body: JSON.stringify({ ...item, active: true }),
                          })
                            .then(props.onRefresh)
                            .catch((e: Error) => props.onError(e.message))
                        }
                      >
                        Reactivar
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
            {!medications.length && <EmptyModule text="Añade una medicación para llevar su seguimiento." />}
          </div>
          <h2 className="module-subheading">Historial de dosis</h2>
          <div className="record-list">
            {doses.map((item) => (
              <article className="record-card" key={item.id}>
                <div className="record-card-heading">
                  <div>
                    <strong>
                      {item.dose_mg} mg · {item.calculated_volume_ml} mL
                    </strong>
                    <time>{formatDateTime(item.administered_at, userTimezone)}</time>
                  </div>
                  <RecordActions
                    onEdit={() => props.onEditDose(item)}
                    onDelete={() => void props.onDelete(`/doses/${item.id}`)}
                  />
                </div>
              </article>
            ))}
            {!doses.length && <EmptyModule text="Aún no hay dosis registradas." />}
          </div>
        </>
      )}

      {module && (!catalogCategory || module === "symptoms") && (
        <>
          {module === "reminders" && (
            <div className="telegram-panel">
              <div>
                <strong>{telegram?.linked ? "Telegram conectado" : "Recibe recordatorios por Telegram"}</strong>
                <p className="module-hint">
                  {telegram?.configured
                    ? "Vincula tu chat privado con un enlace de un solo uso que vence en 15 minutos."
                    : "Telegram aún no está configurado por el administrador de esta instalación."}
                </p>
                {telegram && !telegram.configured && (
                  <code className="telegram-config-hint">
                    TELEGRAM_BOT_TOKEN · TELEGRAM_BOT_USERNAME · TELEGRAM_WEBHOOK_SECRET
                  </code>
                )}
              </div>
              {telegram?.linked ? (
                <button className="small-action danger" onClick={() => void unlinkTelegram()}>
                  Desconectar
                </button>
              ) : (
                <button className="outline-button" disabled={!telegram?.configured} onClick={() => void linkTelegram()}>
                  Vincular Telegram
                </button>
              )}
              {pairingUrl && (
                <a className="telegram-link" href={pairingUrl} target="_blank" rel="noreferrer">
                  Abrir Telegram para confirmar la vinculación
                </a>
              )}
            </div>
          )}
          {module === "symptoms" && <h2 className="module-subheading">Check-ins semanales</h2>}
          <div className="record-list">
            {entries
              .filter(
                (entry) => entry.module === module && (module !== "symptoms" || !Array.isArray(entry.data.results)),
              )
              .map((entry) => (
                <article className="record-card" key={entry.id}>
                  <div className="record-card-heading">
                    <div>
                      <strong>{entry.title}</strong>
                      <time>{formatDateTime(entry.occurred_at, userTimezone)}</time>
                      {module === "reminders" && entry.data.auto_generated === true && (
                        <span className="record-status">Automático · basado en tu último registro</span>
                      )}
                      {module === "reminders" && typeof entry.data.last_sent_epoch === "number" && (
                        <span
                          className={`record-status ${entry.data.completed_reminder_epoch === entry.data.last_sent_epoch ? "active" : ""}`}
                        >
                          {entry.data.completed_reminder_epoch === entry.data.last_sent_epoch
                            ? "Cumplido desde Telegram"
                            : "Enviado · pendiente de confirmación"}
                        </span>
                      )}
                    </div>
                    {module === "reminders" && entry.data.auto_generated === true ? (
                      typeof entry.data.last_sent_epoch === "number" ? (
                        <span className="record-status active">
                          {entry.data.completed_reminder_epoch === entry.data.last_sent_epoch
                            ? "Cumplido desde Telegram"
                            : "Aviso enviado por Telegram"}
                        </span>
                      ) : (
                        <button
                          className={`small-action ${entry.data.enabled === "Sí" || entry.data.enabled === true ? "danger" : ""}`}
                          aria-pressed={entry.data.enabled === "Sí" || entry.data.enabled === true}
                          onClick={() =>
                            void setReminderEnabled(
                              entry,
                              !(entry.data.enabled === "Sí" || entry.data.enabled === true),
                            )
                          }
                        >
                          {entry.data.enabled === "Sí" || entry.data.enabled === true ? "Desactivar" : "Activar"}
                        </button>
                      )
                    ) : (
                      <RecordActions
                        onEdit={() => {
                          setEditingEntry(entry)
                          setShowEntryForm(true)
                        }}
                        onDelete={() => void props.onDelete(`/entries/${entry.id}`)}
                      />
                    )}
                  </div>
                  <div className="composition-results">
                    {journalDefinitions[module].fields
                      .filter(
                        ({ key }) =>
                          entry.data[key] !== undefined && entry.data[key] !== null && entry.data[key] !== "",
                      )
                      .map(({ key, label }) => (
                        <div key={key}>
                          <span>
                            {module === "reminders" && key === "reminder_at"
                              ? entry.data.last_sent_epoch != null
                                ? "Aviso enviado"
                                : entry.data.auto_generated === true && entry.data.enabled === "No"
                                  ? "Aviso desactivado para"
                                  : "Próximo aviso"
                              : label}
                          </span>
                          <strong>
                            {module === "reminders" && key === "reminder_at"
                              ? formatDateTime(String(entry.data[key]), userTimezone)
                              : module === "activity" && key === "entry_type"
                                ? entry.data.entry_type === "weekly"
                                  ? "Estadísticas semanales"
                                  : "Actividad individual"
                                : String(entry.data[key])}
                          </strong>
                        </div>
                      ))}
                  </div>
                  {entry.notes && <p>{entry.notes}</p>}
                </article>
              ))}
            {!entries.some(
              (entry) => entry.module === module && (module !== "symptoms" || !Array.isArray(entry.data.results)),
            ) && (
              <EmptyModule
                text={`Aún no hay registros de ${module === "symptoms" ? "check-ins semanales" : section.toLowerCase()}.`}
              />
            )}
          </div>
        </>
      )}

      {catalogCategory && catalogModule && (
        <>
          {catalog.length > 0 && (
            <div className="catalog-chip-list">
              {orderedCatalog.map((item) => {
                const orderableIndex =
                  catalogCategory === "lab" && !item.is_blood_pressure
                    ? orderedCatalog
                        .filter((entry) => !entry.is_blood_pressure)
                        .findIndex((entry) => entry.id === item.id)
                    : -1
                const orderableCount = orderedCatalog.filter((entry) => !entry.is_blood_pressure).length
                return (
                  <span className="catalog-chip" key={item.id}>
                    {item.name}
                    {orderableIndex >= 0 && (
                      <>
                        <button
                          type="button"
                          aria-label={`Subir ${item.name}`}
                          disabled={orderableIndex === 0}
                          onClick={() => void moveCatalogItem(item, "up")}
                        >
                          <ChevronUp size={11} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Bajar ${item.name}`}
                          disabled={orderableIndex === orderableCount - 1}
                          onClick={() => void moveCatalogItem(item, "down")}
                        >
                          <ChevronDown size={11} />
                        </button>
                      </>
                    )}
                    {catalogCategory === "lab" && (
                      <button
                        type="button"
                        aria-label={`Definir rango normal de ${item.name}`}
                        onClick={() => setEditingThresholdsItem(item)}
                      >
                        <Settings size={11} />
                      </button>
                    )}
                    {!item.is_blood_pressure && (
                      <button
                        type="button"
                        aria-label={`Quitar ${item.name}`}
                        onClick={() => void removeCatalogItem(item)}
                      >
                        <X size={11} />
                      </button>
                    )}
                  </span>
                )
              })}
            </div>
          )}
          {section === "Laboratorios" && (
            <LabEvolutionCharts
              entries={entries.filter((entry) => entry.module === "labs")}
              catalog={catalog}
              timezone={userTimezone}
            />
          )}
          {section === "Síntomas" && <h2 className="module-subheading">Síntomas registrados</h2>}
          <div className="record-list">
            {entries
              .filter((entry) => entry.module === catalogModule && Array.isArray(entry.data.results))
              .map((entry) => (
                <article className="record-card" key={entry.id}>
                  <div className="record-card-heading">
                    <div>
                      <strong>{entry.title}</strong>
                      <time>{formatDateTime(entry.occurred_at, userTimezone)}</time>
                    </div>
                    <RecordActions
                      onEdit={() => {
                        setEditingCatalogEntry(entry)
                        setShowCatalogEntryForm(true)
                      }}
                      onDelete={() => void props.onDelete(`/entries/${entry.id}`)}
                    />
                  </div>
                  <div className="composition-results">
                    {(entry.data.results as CatalogResult[]).map((result) => {
                      const catalogItem = catalog.find((listed) => listed.id === result.catalog_item_id)
                      const outOfRange =
                        catalogItem != null &&
                        result.value != null &&
                        ((catalogItem.normal_min != null && result.value < catalogItem.normal_min) ||
                          (catalogItem.normal_max != null && result.value > catalogItem.normal_max))
                      return (
                        <div key={result.catalog_item_id}>
                          <span>{result.name}</span>
                          <strong className={outOfRange ? "lab-out-of-range" : undefined}>
                            {outOfRange && <AlertTriangle size={12} aria-hidden="true" />}
                            {result.systolic != null
                              ? `${result.systolic}/${result.diastolic} mmHg (media ${result.mean})`
                              : result.value != null
                                ? `${formatDecimal(result.value)}${result.unit ? ` ${result.unit}` : ""}`
                                : result.text_value != null
                                  ? result.text_value
                                  : `${result.severity ?? result.intensity}/10`}
                          </strong>
                        </div>
                      )
                    })}
                  </div>
                  {typeof entry.data.tolerance === "string" && (
                    <p className="module-hint">Tolerancia percibida: {entry.data.tolerance}</p>
                  )}
                  {entry.notes && <p>{entry.notes}</p>}
                </article>
              ))}
            {!entries.some((entry) => entry.module === catalogModule && Array.isArray(entry.data.results)) && (
              <EmptyModule
                text={
                  catalogCategory === "symptom"
                    ? "Registra un síntoma seleccionándolo de tu lista."
                    : catalogCategory === "goal"
                      ? "Registra un objetivo seleccionándolo de tu lista."
                      : "Registra resultados de laboratorio seleccionándolos de tu lista."
                }
              />
            )}
          </div>
        </>
      )}

      {section === "Fotos" && (
        <>
          <form className="photo-upload-form" onSubmit={submitPhoto}>
            <label>
              Foto (JPEG, PNG o WebP; máximo 10 MB)
              <input
                required
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <label>
              Fecha y hora
              <input
                type="datetime-local"
                required
                value={photoDate}
                onChange={(event) => setPhotoDate(event.target.value)}
              />
            </label>
            <label>
              Descripción <span className="optional">opcional</span>
              <input value={photoCaption} onChange={(event) => setPhotoCaption(event.target.value)} />
            </label>
            <button className="primary-button" disabled={busy || !photoFile}>
              {busy ? "Cargando…" : "Guardar foto privada"}
            </button>
          </form>
          <div className="photo-grid">
            {photos.map((photo) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                token={token}
                timezone={userTimezone}
                onRefresh={props.onRefresh}
                onDelete={() => void props.onDelete(`/photos/${photo.id}`)}
              />
            ))}
          </div>
          {!photos.length && <EmptyModule text="Las fotos se almacenan de forma privada en tu cuenta." />}
        </>
      )}

      {section === "Historial" && (
        <div className="record-list">
          {[
            ...weights.map((item) => ({
              id: `w-${item.id}`,
              date: item.measured_at,
              title: `${item.weight_kg} kg`,
              label: "Peso",
              edit: () => props.onEditWeight(item),
              remove: () => props.onDelete(`/weights/${item.id}`),
            })),
            ...doses.map((item) => ({
              id: `d-${item.id}`,
              date: item.administered_at,
              title: `${item.dose_mg} mg`,
              label: "Dosis",
              edit: () => props.onEditDose(item),
              remove: () => props.onDelete(`/doses/${item.id}`),
            })),
            ...measurements.map((item) => ({
              id: `m-${item.id}`,
              date: item.measured_at,
              title: "Medidas corporales",
              label: "Medidas",
              edit: () => {
                setEditingMeasurement(item)
                setShowMeasurementForm(true)
              },
              remove: () => props.onDelete(`/body-measurements/${item.id}`),
            })),
            ...entries.map((item) => ({
              id: `e-${item.id}`,
              date: item.occurred_at,
              title: item.title,
              label: journalSectionLabels[item.module],
              edit: () => {
                setEditingEntry(item)
                setShowEntryForm(true)
              },
              remove: () => props.onDelete(`/entries/${item.id}`),
            })),
          ]
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((item) => (
              <article className="record-card history-card" key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <span>
                    {item.label} · {formatDateTime(item.date, userTimezone)}
                  </span>
                </div>
                <RecordActions onEdit={item.edit} onDelete={() => void item.remove()} />
              </article>
            ))}
        </div>
      )}

      {showEntryForm &&
        module &&
        (module === "activity" ? (
          <ActivityEntryEditor
            entry={editingEntry ?? undefined}
            timezone={userTimezone}
            onClose={() => {
              setShowEntryForm(false)
              setEditingEntry(null)
            }}
            onSave={saveJournal}
          />
        ) : (
          <JournalEntryEditor
            module={module}
            entry={editingEntry ?? undefined}
            timezone={userTimezone}
            onClose={() => {
              setShowEntryForm(false)
              setEditingEntry(null)
            }}
            onSave={saveJournal}
          />
        ))}
      {showCatalogEntryForm && catalogCategory && (
        <CatalogEntryEditor
          category={catalogCategory}
          catalog={orderedCatalog}
          entry={editingCatalogEntry ?? undefined}
          timezone={userTimezone}
          onClose={() => {
            setShowCatalogEntryForm(false)
            setEditingCatalogEntry(null)
          }}
          onSave={saveCatalogEntry}
          onAddCatalogItem={addCatalogItem}
        />
      )}
      {editingThresholdsItem && (
        <CatalogThresholdsEditor
          item={editingThresholdsItem}
          onClose={() => setEditingThresholdsItem(null)}
          onSave={(normalMin, normalMax, diastolicMin, diastolicMax) =>
            updateCatalogThresholds(editingThresholdsItem, normalMin, normalMax, diastolicMin, diastolicMax)
          }
        />
      )}
      {showMeasurementForm && (
        <BodyMeasurementEditor
          entry={editingMeasurement ?? undefined}
          timezone={userTimezone}
          onClose={() => {
            setShowMeasurementForm(false)
            setEditingMeasurement(null)
          }}
          onSave={saveMeasurement}
        />
      )}
      {showNewMedication && (
        <Modal
          title="Añadir medicación"
          subtitle="Configura concentración para conversiones informativas."
          onClose={() => setShowNewMedication(false)}
        >
          <form className="entry-form" onSubmit={createMedication}>
            <label>
              Nombre
              <input name="name" required maxLength={120} />
            </label>
            <div className="form-two-columns">
              <label>
                Concentración
                <input name="concentration_mg" required type="number" min="0.01" step="0.01" />
              </label>
              <label>
                Volumen (mL)
                <input name="concentration_volume_ml" required type="number" min="0.01" step="0.01" />
              </label>
            </div>
            <label>
              Unidades/mL <span className="optional">opcional</span>
              <input name="units_per_ml" type="number" min="0.01" step="0.01" />
            </label>
            {error && <div className="error-banner">{error}</div>}
            <div className="form-actions">
              <button type="button" className="cancel-button" onClick={() => setShowNewMedication(false)}>
                Cancelar
              </button>
              <button className="primary-button" disabled={busy}>
                {busy ? "Guardando…" : "Añadir"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
    </section>
  )
}

const bodyFields = [
  ["waist_cm", "Cintura", "cm"],
  ["neck_cm", "Cuello", "cm"],
  ["chest_cm", "Pecho", "cm"],
  ["abdomen_cm", "Abdomen", "cm"],
  ["hip_cm", "Cadera", "cm"],
  ["arm_cm", "Brazo", "cm"],
  ["thigh_cm", "Muslo", "cm"],
] as const

function RecordActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
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

function EmptyModule({ text }: { text: string }) {
  return (
    <div className="module-empty">
      <Activity size={20} />
      <span>{text}</span>
    </div>
  )
}

function ActivityEntryEditor({
  entry,
  timezone,
  onClose,
  onSave,
}: {
  entry?: JournalEntry
  timezone: string
  onClose: () => void
  onSave: (payload: Omit<JournalEntry, "id" | "created_at" | "updated_at">) => Promise<void>
}) {
  const isLegacyEntry = Boolean(entry && !("entry_type" in entry.data))
  const [entryType, setEntryType] = useState<"single" | "weekly">(() =>
    entry?.data.entry_type === "weekly" ? "weekly" : "single",
  )
  const [activityType, setActivityType] = useState<ActivityType>(() => {
    const savedType = entry?.data.activity_type
    return activityTypes.includes(savedType as ActivityType)
      ? (savedType as ActivityType)
      : isLegacyEntry
        ? "Otro"
        : "Caminata"
  })
  const [otherActivity, setOtherActivity] = useState(() =>
    String(entry?.data.other_activity ?? (isLegacyEntry ? entry?.title : "")),
  )
  const [occurredAt, setOccurredAt] = useState(() =>
    dateTimeInputValue(entry?.occurred_at ?? new Date().toISOString(), timezone),
  )
  const [weekStart, setWeekStart] = useState(() => occurredAt.split("T")[0])
  const [duration, setDuration] = useState(() => String(entry?.data.duration_min ?? ""))
  const [distance, setDistance] = useState(() => String(entry?.data.distance_km ?? ""))
  const [calories, setCalories] = useState(() => String(entry?.data.calories_kcal ?? ""))
  const [intensity, setIntensity] = useState(() => String(entry?.data.intensity ?? ""))
  const [weeklyCalories, setWeeklyCalories] = useState(() => String(entry?.data.weekly_calories_kcal ?? ""))
  const [weeklySteps, setWeeklySteps] = useState(() => String(entry?.data.weekly_steps ?? ""))
  const [weeklyDistance, setWeeklyDistance] = useState(() => String(entry?.data.weekly_distance_km ?? ""))
  const [notes, setNotes] = useState(entry?.notes ?? "")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const measurements =
      entryType === "weekly" ? [weeklyCalories, weeklySteps, weeklyDistance] : [duration, distance, calories]
    if (!measurements.some((value) => value.trim() !== "")) {
      setError(
        entryType === "weekly"
          ? "Ingresa al menos un total semanal."
          : "Ingresa al menos una medida de esta actividad.",
      )
      return
    }
    if (entryType === "single" && activityType === "Otro" && !otherActivity.trim()) {
      setError("Describe la actividad seleccionada como Otro.")
      return
    }

    const numberOrNull = (value: string) => (value.trim() === "" ? null : Number(value))
    const data =
      entryType === "weekly"
        ? {
            entry_type: "weekly",
            weekly_calories_kcal: numberOrNull(weeklyCalories),
            weekly_steps: numberOrNull(weeklySteps),
            weekly_distance_km: numberOrNull(weeklyDistance),
          }
        : {
            entry_type: "single",
            activity_type: activityType,
            other_activity: activityType === "Otro" ? otherActivity.trim() : null,
            duration_min: numberOrNull(duration),
            distance_km: numberOrNull(distance),
            calories_kcal: numberOrNull(calories),
            intensity: intensity || null,
          }

    setBusy(true)
    setError("")
    try {
      await onSave({
        module: "activity",
        title:
          entryType === "weekly" ? "Resumen semanal" : activityType === "Otro" ? otherActivity.trim() : activityType,
        occurred_at: localDateTimeToIso(entryType === "weekly" ? `${weekStart}T00:00` : occurredAt, timezone),
        notes: notes || null,
        data,
      })
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar la actividad.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={entry ? "Editar actividad" : "Registrar actividad"}
      subtitle="Guarda una actividad individual o los totales de una semana."
      onClose={onClose}
    >
      <form className="entry-form" onSubmit={(event) => void submit(event)}>
        <div className="range-select" role="group" aria-label="Tipo de registro">
          <button
            type="button"
            className={entryType === "single" ? "selected" : ""}
            onClick={() => setEntryType("single")}
          >
            Actividad individual
          </button>
          <button
            type="button"
            className={entryType === "weekly" ? "selected" : ""}
            onClick={() => setEntryType("weekly")}
          >
            Estadísticas semanales
          </button>
        </div>

        {entryType === "single" ? (
          <>
            <label>
              Actividad
              <select value={activityType} onChange={(event) => setActivityType(event.target.value as ActivityType)}>
                {activityTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            {activityType === "Otro" && (
              <label>
                ¿Qué actividad?
                <input
                  maxLength={120}
                  required
                  value={otherActivity}
                  onChange={(event) => setOtherActivity(event.target.value)}
                />
              </label>
            )}
            <label>
              Fecha y hora
              <input
                required
                type="datetime-local"
                value={occurredAt}
                onChange={(event) => setOccurredAt(event.target.value)}
              />
            </label>
            <div className="form-two-columns">
              <label>
                Duración (min)
                <input
                  type="number"
                  min="0"
                  max="1440"
                  step="1"
                  value={duration}
                  onChange={(event) => setDuration(event.target.value)}
                />
              </label>
              <label>
                Distancia (km)
                <input
                  type="number"
                  min="0"
                  max="1000"
                  step="0.01"
                  value={distance}
                  onChange={(event) => setDistance(event.target.value)}
                />
              </label>
              <label>
                Calorías (kcal)
                <input
                  type="number"
                  min="0"
                  max="100000"
                  step="0.01"
                  value={calories}
                  onChange={(event) => setCalories(event.target.value)}
                />
              </label>
              <label>
                Intensidad
                <select value={intensity} onChange={(event) => setIntensity(event.target.value)}>
                  <option value="">Sin especificar</option>
                  <option>Suave</option>
                  <option>Moderada</option>
                  <option>Intensa</option>
                </select>
              </label>
            </div>
          </>
        ) : (
          <>
            <label>
              Semana iniciada el
              <input required type="date" value={weekStart} onChange={(event) => setWeekStart(event.target.value)} />
            </label>
            <div className="form-two-columns">
              <label>
                Calorías (kcal)
                <input
                  type="number"
                  min="0"
                  max="200000"
                  step="0.01"
                  value={weeklyCalories}
                  onChange={(event) => setWeeklyCalories(event.target.value)}
                />
              </label>
              <label>
                Pasos
                <input
                  type="number"
                  min="0"
                  max="2000000"
                  step="1"
                  value={weeklySteps}
                  onChange={(event) => setWeeklySteps(event.target.value)}
                />
              </label>
              <label>
                Distancia (km)
                <input
                  type="number"
                  min="0"
                  max="10000"
                  step="0.01"
                  value={weeklyDistance}
                  onChange={(event) => setWeeklyDistance(event.target.value)}
                />
              </label>
            </div>
          </>
        )}
        <label>
          Notas <span className="optional">opcional</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="cancel-button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Guardando…" : entry ? "Guardar cambios" : "Guardar registro"}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function JournalEntryEditor({
  module,
  entry,
  timezone,
  onClose,
  onSave,
}: {
  module: JournalModule
  entry?: JournalEntry
  timezone: string
  onClose: () => void
  onSave: (payload: Omit<JournalEntry, "id" | "created_at" | "updated_at">) => Promise<void>
}) {
  const [title, setTitle] = useState(entry?.title ?? (module === "symptoms" ? "Seguimiento semanal" : ""))
  const [occurredAt, setOccurredAt] = useState(() =>
    dateTimeInputValue(entry?.occurred_at ?? new Date().toISOString(), timezone),
  )
  const [notes, setNotes] = useState(entry?.notes ?? "")
  const [data, setData] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      journalDefinitions[module].fields.map(({ key }) => [
        key,
        entry?.data[key] == null
          ? ""
          : key === "reminder_at"
            ? dateTimeInputValue(String(entry.data[key]), timezone)
            : String(entry.data[key]),
      ]),
    ),
  )
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    const parsed = Object.fromEntries(
      journalDefinitions[module].fields.map(({ key, type }) => [
        key,
        data[key] === ""
          ? null
          : type === "number"
            ? Number(data[key])
            : key === "reminder_at"
              ? localDateTimeToIso(data[key], timezone)
              : data[key],
      ]),
    )
    try {
      await onSave({
        module,
        title,
        occurred_at:
          module === "reminders" && data.reminder_at
            ? localDateTimeToIso(data.reminder_at, timezone)
            : localDateTimeToIso(occurredAt, timezone),
        notes: notes || null,
        data: parsed,
      })
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={`${entry ? "Editar" : "Añadir"} ${journalDefinitions[module].title}`}
      subtitle="Se completa con la fecha y hora actuales; puedes cambiarlas."
      onClose={onClose}
    >
      <form className="entry-form" onSubmit={submit}>
        {module !== "symptoms" && (
          <label>
            {journalDefinitions[module].title}
            <input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
        )}
        <label>
          Fecha y hora
          <input
            required
            type="datetime-local"
            value={occurredAt}
            onChange={(event) => setOccurredAt(event.target.value)}
          />
        </label>
        {journalDefinitions[module].fields.map(({ key, label, type, options }) => (
          <label key={key}>
            {label}
            {options ? (
              <select
                value={data[key] ?? ""}
                onChange={(event) => setData((current) => ({ ...current, [key]: event.target.value }))}
              >
                <option value="">Seleccionar…</option>
                {options.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            ) : (
              <input
                type={type ?? "text"}
                min={type === "number" ? "0" : undefined}
                step={type === "number" ? "0.01" : undefined}
                value={data[key] ?? ""}
                onChange={(event) => setData((current) => ({ ...current, [key]: event.target.value }))}
              />
            )}
          </label>
        ))}
        <label>
          Notas <span className="optional">opcional</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-actions">
          <button type="button" className="cancel-button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Guardando…" : entry ? "Guardar cambios" : "Guardar registro"}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function CatalogThresholdsEditor({
  item,
  onClose,
  onSave,
}: {
  item: CatalogItem
  onClose: () => void
  onSave: (
    normalMin: number | null,
    normalMax: number | null,
    diastolicMin: number | null,
    diastolicMax: number | null,
  ) => Promise<void>
}) {
  const [normalMin, setNormalMin] = useState(item.normal_min != null ? String(item.normal_min) : "")
  const [normalMax, setNormalMax] = useState(item.normal_max != null ? String(item.normal_max) : "")
  const [diastolicMin, setDiastolicMin] = useState(
    item.diastolic_normal_min != null ? String(item.diastolic_normal_min) : "",
  )
  const [diastolicMax, setDiastolicMax] = useState(
    item.diastolic_normal_max != null ? String(item.diastolic_normal_max) : "",
  )
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const min = normalMin.trim() === "" ? null : Number(normalMin)
    const max = normalMax.trim() === "" ? null : Number(normalMax)
    const dMin = item.is_blood_pressure && diastolicMin.trim() !== "" ? Number(diastolicMin) : null
    const dMax = item.is_blood_pressure && diastolicMax.trim() !== "" ? Number(diastolicMax) : null
    if (min != null && max != null && min > max) {
      setError(
        item.is_blood_pressure
          ? "El mínimo sistólico debe ser menor o igual al máximo."
          : "El mínimo normal debe ser menor o igual al máximo.",
      )
      return
    }
    if (dMin != null && dMax != null && dMin > dMax) {
      setError("El mínimo diastólico debe ser menor o igual al máximo.")
      return
    }
    setBusy(true)
    setError("")
    try {
      await onSave(min, max, dMin, dMax)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar el rango normal.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Rango normal · ${item.name}`}
      subtitle="Se aplica a los próximos registros y a la gráfica de evolución."
      onClose={onClose}
    >
      <form className="entry-form" onSubmit={submit}>
        <div className="form-two-columns">
          <label>
            {item.is_blood_pressure ? "Sistólica normal desde" : "Normal desde"}{" "}
            <span className="optional">opcional</span>
            <input type="number" step="0.01" value={normalMin} onChange={(event) => setNormalMin(event.target.value)} />
          </label>
          <label>
            {item.is_blood_pressure ? "Sistólica normal hasta" : "Normal hasta"}{" "}
            <span className="optional">opcional</span>
            <input type="number" step="0.01" value={normalMax} onChange={(event) => setNormalMax(event.target.value)} />
          </label>
        </div>
        {item.is_blood_pressure && (
          <div className="form-two-columns">
            <label>
              Diastólica normal desde <span className="optional">opcional</span>
              <input
                type="number"
                step="0.01"
                value={diastolicMin}
                onChange={(event) => setDiastolicMin(event.target.value)}
              />
            </label>
            <label>
              Diastólica normal hasta <span className="optional">opcional</span>
              <input
                type="number"
                step="0.01"
                value={diastolicMax}
                onChange={(event) => setDiastolicMax(event.target.value)}
              />
            </label>
          </div>
        )}
        <p className="module-hint">
          Define solo el valor "hasta" para un máximo, solo "desde" para un mínimo, o ambos para un rango. Déjalos
          vacíos para quitar el umbral.
        </p>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-actions">
          <button type="button" className="cancel-button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Guardando…" : "Guardar rango"}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function CatalogEntryEditor({
  category,
  catalog,
  entry,
  timezone,
  onClose,
  onSave,
  onAddCatalogItem,
}: {
  category: CatalogCategory
  catalog: CatalogItem[]
  entry?: JournalEntry
  timezone: string
  onClose: () => void
  onSave: (payload: Omit<JournalEntry, "id" | "created_at" | "updated_at">) => Promise<void>
  onAddCatalogItem: (
    name: string,
    unit: string,
    symptomCategory?: "Gastrointestinal" | "Otro",
    thresholds?: { normal_min: number | null; normal_max: number | null },
  ) => Promise<void>
}) {
  const existingResults = Array.isArray(entry?.data.results) ? (entry!.data.results as CatalogResult[]) : []
  const [occurredAt, setOccurredAt] = useState(() =>
    dateTimeInputValue(entry?.occurred_at ?? new Date().toISOString(), timezone),
  )
  const [notes, setNotes] = useState(entry?.notes ?? "")
  const [tolerance, setTolerance] = useState(String(entry?.data.tolerance ?? ""))
  const [phase, setPhase] = useState(String(entry?.data.phase ?? ""))
  const [laboratory, setLaboratory] = useState(String(entry?.data.laboratory ?? ""))
  const [selections, setSelections] = useState<
    Record<number, { checked: boolean; value: string; systolic: string; diastolic: string }>
  >(() =>
    Object.fromEntries(
      catalog.map((item) => {
        const existing = existingResults.find((result) => result.catalog_item_id === item.id)
        return [
          item.id,
          {
            checked: Boolean(existing),
            value:
              existing?.value != null
                ? String(existing.value)
                : existing?.text_value != null
                  ? existing.text_value
                  : existing?.severity != null
                    ? String(existing.severity)
                    : existing?.intensity != null
                      ? String(existing.intensity)
                      : "",
            systolic: existing?.systolic != null ? String(existing.systolic) : "",
            diastolic: existing?.diastolic != null ? String(existing.diastolic) : "",
          },
        ]
      }),
    ),
  )
  const [newItemName, setNewItemName] = useState("")
  const [newItemUnit, setNewItemUnit] = useState("")
  const [newItemNormalMin, setNewItemNormalMin] = useState("")
  const [newItemNormalMax, setNewItemNormalMax] = useState("")
  const [newItemSymptomCategory, setNewItemSymptomCategory] = useState<"Gastrointestinal" | "Otro">("Otro")
  const [addingItem, setAddingItem] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  function toggle(itemId: number) {
    setSelections((current) => ({
      ...current,
      [itemId]: { ...current[itemId], checked: !current[itemId]?.checked },
    }))
  }
  function updateField(itemId: number, field: "value" | "systolic" | "diastolic", value: string) {
    setSelections((current) => ({
      ...current,
      [itemId]: {
        ...(current[itemId] ?? { checked: true, value: "", systolic: "", diastolic: "" }),
        [field]: value,
      },
    }))
  }

  async function submitNewItem() {
    if (!newItemName.trim()) return
    setBusy(true)
    setError("")
    try {
      await onAddCatalogItem(
        newItemName.trim(),
        newItemUnit.trim(),
        category === "symptom" ? newItemSymptomCategory : undefined,
        category === "lab"
          ? {
              normal_min: newItemNormalMin.trim() === "" ? null : Number(newItemNormalMin),
              normal_max: newItemNormalMax.trim() === "" ? null : Number(newItemNormalMax),
            }
          : undefined,
      )
      setNewItemName("")
      setNewItemUnit("")
      setNewItemNormalMin("")
      setNewItemNormalMax("")
      setAddingItem(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo añadir el elemento")
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    const results: CatalogResult[] = []
    for (const item of catalog) {
      const selection = selections[item.id]
      if (!selection?.checked) continue
      if (item.is_blood_pressure) {
        if (!selection.systolic || !selection.diastolic) continue
        const systolic = Number(selection.systolic)
        const diastolic = Number(selection.diastolic)
        results.push({
          catalog_item_id: item.id,
          name: item.name,
          unit: item.unit,
          value: null,
          text_value: null,
          severity: null,
          intensity: null,
          systolic,
          diastolic,
          mean: Math.round(((systolic + diastolic) / 2) * 100) / 100,
          category: null,
        })
      } else {
        const raw = selection.value.trim()
        if (raw === "") continue
        const labIsNumeric = category === "lab" && isNumericString(raw)
        const numeric = category === "lab" ? (labIsNumeric ? Number(raw) : null) : Number(raw)
        results.push({
          catalog_item_id: item.id,
          name: item.name,
          unit: item.unit,
          value: category === "lab" ? numeric : null,
          text_value: category === "lab" && !labIsNumeric ? raw : null,
          severity: category === "symptom" ? numeric : null,
          intensity: category === "goal" ? numeric : null,
          systolic: null,
          diastolic: null,
          mean: null,
          category: item.symptom_category ?? null,
        })
      }
    }
    if (!results.length) {
      setError("Selecciona al menos un elemento e indica su valor")
      setBusy(false)
      return
    }
    const module: JournalModule = category === "symptom" ? "symptoms" : category === "goal" ? "goals" : "labs"
    const title =
      category === "lab"
        ? laboratory.trim() || "Resultados de laboratorio"
        : category === "goal"
          ? "Registro de objetivos"
          : results.map((result) => result.name).join(", ")
    const data: Record<string, unknown> = { results }
    if (category === "symptom" && tolerance) data.tolerance = tolerance
    if (category === "lab") {
      if (phase) data.phase = phase
      if (laboratory) data.laboratory = laboratory
    }
    try {
      await onSave({
        module,
        title,
        occurred_at: localDateTimeToIso(occurredAt, timezone),
        notes: notes || null,
        data,
      })
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar")
    } finally {
      setBusy(false)
    }
  }

  const intensityLabel = category === "symptom" ? "Intensidad (0–10)" : "Progreso (0–10)"

  return (
    <Modal
      title={`${entry ? "Editar" : "Registrar"} ${
        category === "symptom" ? "síntomas" : category === "goal" ? "objetivos" : "resultados de laboratorio"
      }`}
      subtitle="Selecciona los elementos de tu lista que correspondan y define su valor."
      onClose={onClose}
      size="wide"
    >
      <form className="entry-form" onSubmit={submit}>
        <label>
          Fecha y hora
          <input
            required
            type="datetime-local"
            value={occurredAt}
            onChange={(event) => setOccurredAt(event.target.value)}
          />
        </label>
        {category === "lab" && (
          <>
            <div className="form-two-columns">
              <label>
                Contexto
                <select value={phase} onChange={(event) => setPhase(event.target.value)}>
                  <option value="">Seleccionar…</option>
                  <option>Basal</option>
                  <option>Seguimiento</option>
                </select>
              </label>
              <label>
                Laboratorio <span className="optional">opcional</span>
                <input value={laboratory} onChange={(event) => setLaboratory(event.target.value)} />
              </label>
            </div>
            <p className="module-hint">
              El valor puede ser numérico o texto (por ejemplo, "Negativo"). Solo los valores numéricos se grafican.
            </p>
          </>
        )}
        {category === "symptom" && (
          <label>
            Tolerancia percibida <span className="optional">opcional</span>
            <select value={tolerance} onChange={(event) => setTolerance(event.target.value)}>
              <option value="">Seleccionar…</option>
              <option>Buena</option>
              <option>Con molestias leves</option>
              <option>Con molestias moderadas</option>
              <option>Con molestias importantes</option>
            </select>
          </label>
        )}
        <div className="catalog-selection-list">
          {catalog.map((item) => {
            const selection = selections[item.id] ?? { checked: false, value: "", systolic: "", diastolic: "" }
            return (
              <div className="catalog-selection-row" key={item.id}>
                <label className={`catalog-selection-checkbox${selection.checked ? " selected" : ""}`}>
                  <input type="checkbox" checked={selection.checked} onChange={() => toggle(item.id)} />
                  {item.name}
                  {item.unit ? ` (${item.unit})` : ""}
                </label>
                {selection.checked &&
                  (item.is_blood_pressure ? (
                    <div className="catalog-selection-values">
                      <input
                        type="number"
                        step="1"
                        min="0"
                        placeholder="Sistólica"
                        value={selection.systolic}
                        onChange={(event) => updateField(item.id, "systolic", event.target.value)}
                      />
                      <input
                        type="number"
                        step="1"
                        min="0"
                        placeholder="Diastólica"
                        value={selection.diastolic}
                        onChange={(event) => updateField(item.id, "diastolic", event.target.value)}
                      />
                    </div>
                  ) : (
                    <input
                      className="catalog-selection-values"
                      type={category === "lab" ? "text" : "number"}
                      step={category === "lab" ? undefined : "1"}
                      min={category === "lab" ? undefined : "0"}
                      max={category === "lab" ? undefined : "10"}
                      placeholder={category === "lab" ? "Valor numérico o texto" : intensityLabel}
                      value={selection.value}
                      onChange={(event) => updateField(item.id, "value", event.target.value)}
                    />
                  ))}
              </div>
            )
          })}
          {!catalog.length && (
            <p className="module-hint">Aún no tienes elementos en tu lista. Añade el primero abajo.</p>
          )}
        </div>
        {addingItem ? (
          <div className="catalog-new-item">
            <input
              placeholder="Nombre"
              maxLength={120}
              value={newItemName}
              onChange={(event) => setNewItemName(event.target.value)}
            />
            {category === "lab" && (
              <input
                placeholder="Unidad (opcional)"
                maxLength={40}
                value={newItemUnit}
                onChange={(event) => setNewItemUnit(event.target.value)}
              />
            )}
            {category === "lab" && (
              <>
                <input
                  type="number"
                  step="0.01"
                  placeholder="Normal desde (opcional)"
                  value={newItemNormalMin}
                  onChange={(event) => setNewItemNormalMin(event.target.value)}
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="Normal hasta (opcional)"
                  value={newItemNormalMax}
                  onChange={(event) => setNewItemNormalMax(event.target.value)}
                />
              </>
            )}
            {category === "symptom" && (
              <select
                value={newItemSymptomCategory}
                onChange={(event) => setNewItemSymptomCategory(event.target.value as "Gastrointestinal" | "Otro")}
              >
                <option>Otro</option>
                <option>Gastrointestinal</option>
              </select>
            )}
            <button type="button" className="small-action" disabled={busy} onClick={() => void submitNewItem()}>
              Guardar en la lista
            </button>
            <button type="button" className="small-action" onClick={() => setAddingItem(false)}>
              Cancelar
            </button>
          </div>
        ) : (
          <button type="button" className="outline-button" onClick={() => setAddingItem(true)}>
            <Plus size={14} /> Añadir elemento nuevo a la lista
          </button>
        )}
        <label>
          Notas <span className="optional">opcional</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-actions">
          <button type="button" className="cancel-button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Guardando…" : entry ? "Guardar cambios" : "Guardar registro"}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function LabEvolutionCharts({
  entries,
  catalog,
  timezone,
}: {
  entries: JournalEntry[]
  catalog: CatalogItem[]
  timezone: string
}) {
  const series = catalog
    .map((item) => {
      const points = entries
        .filter((entry) => Array.isArray(entry.data.results))
        .flatMap((entry) => {
          const result = (entry.data.results as CatalogResult[]).find((row) => row.catalog_item_id === item.id)
          if (!result || (!item.is_blood_pressure && result.value == null)) return []
          return [
            {
              date: formatDate(entry.occurred_at, timezone),
              occurred_at: entry.occurred_at,
              value: result.value,
              systolic: result.systolic,
              diastolic: result.diastolic,
              mean: result.mean,
            },
          ]
        })
        .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
      return { item, points }
    })
    .filter((series) => series.points.length > 0)

  if (!series.length) {
    return <EmptyModule text="Registra resultados numéricos para ver la evolución de cada prueba." />
  }

  const rangeText = (min: number | null, max: number | null, unit: string | null) => {
    if (min != null && max != null) return `${formatDecimal(min)}–${formatDecimal(max)}${unit ? ` ${unit}` : ""}`
    if (max != null) return `hasta ${formatDecimal(max)}${unit ? ` ${unit}` : ""}`
    if (min != null) return `desde ${formatDecimal(min)}${unit ? ` ${unit}` : ""}`
    return null
  }
  const normalRangeLabel = (item: CatalogItem) => {
    if (item.is_blood_pressure) {
      const systolic = rangeText(item.normal_min, item.normal_max, item.unit)
      const diastolic = rangeText(item.diastolic_normal_min, item.diastolic_normal_max, item.unit)
      const parts = [
        systolic && `Sistólica normal: ${systolic}`,
        diastolic && `Diastólica normal: ${diastolic}`,
      ].filter(Boolean)
      return parts.length ? parts.join(" · ") : null
    }
    const value = rangeText(item.normal_min, item.normal_max, item.unit)
    return value ? `Normal: ${value}` : null
  }
  const normalRangeGuides = (min: number | null, max: number | null, color: string) => {
    if (min != null && max != null) {
      return (
        <ReferenceArea
          y1={min}
          y2={max}
          fill={color}
          fillOpacity={0.08}
          stroke={color}
          strokeOpacity={0.3}
          strokeDasharray="4 3"
        />
      )
    }
    if (min != null) return <ReferenceLine y={min} stroke={color} strokeDasharray="4 3" />
    if (max != null) return <ReferenceLine y={max} stroke={color} strokeDasharray="4 3" />
    return null
  }

  return (
    <div className="lab-charts-grid">
      {series.map(({ item, points }) => (
        <div className="panel analysis-chart-panel" key={item.id}>
          <div className="panel-heading">
            <div>
              <div className="eyebrow">EVOLUCIÓN</div>
              <h2>{item.name}</h2>
            </div>
            <span className="goal-caption">
              {points.length} {points.length === 1 ? "registro" : "registros"}
            </span>
          </div>
          {normalRangeLabel(item) && <p className="module-hint">{normalRangeLabel(item)}</p>}
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsLineChart data={points} margin={{ top: 20, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--line)" />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--muted)", fontSize: 11 }}
                  minTickGap={30}
                />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
                <Tooltip />
                {item.is_blood_pressure ? (
                  <>
                    {normalRangeGuides(item.normal_min, item.normal_max, "#c0554d")}
                    {normalRangeGuides(item.diastolic_normal_min, item.diastolic_normal_max, "#3d6fb4")}
                  </>
                ) : (
                  normalRangeGuides(item.normal_min, item.normal_max, "#398766")
                )}
                {item.is_blood_pressure ? (
                  <>
                    <Legend />
                    <Line type="monotone" dataKey="systolic" name="Sistólica" stroke="#c0554d" strokeWidth={2.4} dot />
                    <Line
                      type="monotone"
                      dataKey="diastolic"
                      name="Diastólica"
                      stroke="#3d6fb4"
                      strokeWidth={2.4}
                      dot
                    />
                    <Line
                      type="monotone"
                      dataKey="mean"
                      name="Media"
                      stroke="#7a54bf"
                      strokeWidth={2.4}
                      strokeDasharray="4 3"
                      dot
                    />
                  </>
                ) : (
                  <Line type="monotone" dataKey="value" name={item.name} stroke="#398766" strokeWidth={2.4} dot />
                )}
              </RechartsLineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ))}
    </div>
  )
}

function BodyMeasurementEditor({
  entry,
  timezone,
  onClose,
  onSave,
}: {
  entry?: BodyMeasurementEntry
  timezone: string
  onClose: () => void
  onSave: (payload: Record<string, unknown>) => Promise<void>
}) {
  const [date, setDate] = useState(() => dateTimeInputValue(entry?.measured_at ?? new Date().toISOString(), timezone))
  const [notes, setNotes] = useState(entry?.notes ?? "")
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(bodyFields.map(([key]) => [key, entry?.[key] == null ? "" : String(entry[key])])),
  )
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      await onSave({
        measured_at: localDateTimeToIso(date, timezone),
        notes: notes || null,
        ...Object.fromEntries(bodyFields.map(([key]) => [key, values[key] ? Number(values[key]) : null])),
      })
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={entry ? "Editar medidas" : "Registrar medidas"}
      subtitle="Incluye una o más medidas corporales."
      onClose={onClose}
      size="wide"
    >
      <form className="entry-form" onSubmit={submit}>
        <label>
          Fecha y hora
          <input required type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <div className="composition-input-grid">
          {bodyFields.map(([key, label]) => (
            <label key={key}>
              {label} (cm)
              <input
                type="number"
                min="0.1"
                max="300"
                step="0.01"
                value={values[key]}
                onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
              />
            </label>
          ))}
        </div>
        <label>
          Notas <span className="optional">opcional</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-actions">
          <button type="button" className="cancel-button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function PhotoCard({
  photo,
  token,
  timezone,
  onRefresh,
  onDelete,
}: {
  photo: PhotoEntry
  token: string
  timezone: string
  onRefresh: () => Promise<void>
  onDelete: () => void
}) {
  const [src, setSrc] = useState("")
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    let url = ""
    void loadPhoto(token, photo.id)
      .then((value) => {
        url = value
        setSrc(value)
      })
      .catch(() => undefined)
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [token, photo.id])
  return (
    <>
      <article className="photo-card">
        {src ? (
          <img src={src} alt={photo.caption ?? "Foto privada de seguimiento"} />
        ) : (
          <div className="photo-loading">Cargando foto…</div>
        )}
        <div>
          <strong>{photo.caption || "Registro fotográfico"}</strong>
          <time>{formatDateTime(photo.taken_at, timezone)}</time>
          <button className="small-action" onClick={() => setEditing(true)}>
            Editar
          </button>
          <button className="small-action danger" onClick={onDelete}>
            Eliminar
          </button>
        </div>
      </article>
      {editing && (
        <PhotoEditor
          photo={photo}
          token={token}
          timezone={timezone}
          onClose={() => setEditing(false)}
          onSave={async () => {
            await onRefresh()
            setEditing(false)
          }}
        />
      )}
    </>
  )
}

function PhotoEditor({
  photo,
  token,
  timezone,
  onClose,
  onSave,
}: {
  photo: PhotoEntry
  token: string
  timezone: string
  onClose: () => void
  onSave: () => Promise<void>
}) {
  const [caption, setCaption] = useState(photo.caption ?? "")
  const [takenAt, setTakenAt] = useState(dateTimeInputValue(photo.taken_at, timezone))
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      await api(`/photos/${photo.id}`, token, {
        method: "PUT",
        body: JSON.stringify({ caption: caption || null, taken_at: localDateTimeToIso(takenAt, timezone) }),
      })
      await onSave()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Editar foto" subtitle="La imagen queda privada en tu cuenta." onClose={onClose}>
      <form className="entry-form" onSubmit={submit}>
        <label>
          Descripción
          <input value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={300} />
        </label>
        <label>
          Fecha y hora
          <input required type="datetime-local" value={takenAt} onChange={(event) => setTakenAt(event.target.value)} />
        </label>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-actions">
          <button type="button" className="cancel-button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function QuickModal({
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
function WeightModal({
  onClose,
  onSubmit,
  entry,
  timezone,
}: {
  onClose: () => void
  onSubmit: (
    weight: number,
    notes: string,
    dateTime: string,
    composition: CompositionValues,
    id?: number,
  ) => Promise<void>
  entry?: WeightEntry
  timezone: string
}) {
  const [weight, setWeight] = useState(entry ? String(entry.weight_kg) : "")
  const [notes, setNotes] = useState(entry?.notes ?? "")
  const [dateTime, setDateTime] = useState(() =>
    dateTimeInputValue(entry?.measured_at ?? new Date().toISOString(), timezone),
  )
  const [composition, setComposition] = useState<Record<string, string>>(() =>
    Object.fromEntries(compositionFields.map(([key]) => [key, entry?.[key] == null ? "" : String(entry[key])])),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      const metrics = Object.fromEntries(
        compositionFields.map(([key]) => [key, composition[key] === "" ? null : Number(composition[key])]),
      ) as CompositionValues
      await onSubmit(Number(weight), notes, dateTime, metrics, entry?.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar el registro")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={entry ? "Editar registro de peso" : "Registrar peso"}
      subtitle="La fecha y hora se completan automáticamente; puedes cambiar todos los valores."
      onClose={onClose}
    >
      <form className="entry-form" onSubmit={submit}>
        <label>
          Peso actual{" "}
          <div className="input-with-unit">
            <input
              autoFocus
              required
              type="number"
              min="1"
              max="500"
              step="0.01"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="0.0"
            />
            <span>kg</span>
          </div>
        </label>
        <label>
          Fecha y hora
          <input
            required
            type="datetime-local"
            value={dateTime}
            onChange={(event) => setDateTime(event.target.value)}
          />
        </label>
        <details className="composition-fields">
          <summary>
            Composición corporal <span className="optional">opcional · datos de la báscula</span>
          </summary>
          <div className="composition-input-grid">
            {compositionFields.map(([key, label, unit, max, step]) => (
              <label key={key}>
                {label} <span className="optional">{unit}</span>
                <input
                  type="number"
                  min="0"
                  max={max}
                  step={step}
                  value={composition[key]}
                  onChange={(event) => setComposition((current) => ({ ...current, [key]: event.target.value }))}
                />
              </label>
            ))}
          </div>
        </details>
        <label>
          Nota <span className="optional">opcional</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Por ejemplo, por la mañana" />
        </label>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-actions">
          <button type="button" className="cancel-button" onClick={onClose}>
            Cancelar
          </button>
          <button disabled={busy} className="primary-button">
            {busy ? "Guardando…" : entry ? "Guardar cambios" : "Guardar peso"}
          </button>
        </div>
      </form>
    </Modal>
  )
}
function DoseModal({
  onClose,
  medication,
  onSubmit,
  entry,
  timezone,
}: {
  onClose: () => void
  onSubmit: (mg: number, site: string, dateTime: string, id?: number, medicationId?: number) => Promise<void>
  entry?: DoseEntry
  medication: Medication | undefined
  timezone: string
}) {
  const [dose, setDose] = useState(entry ? String(entry.dose_mg) : "")
  const [site, setSite] = useState(entry?.injection_site ?? "")
  const [dateTime, setDateTime] = useState(() =>
    dateTimeInputValue(entry?.administered_at ?? new Date().toISOString(), timezone),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const mg = Number(dose)
  const volume = medication && mg > 0 ? mg / (medication.concentration_mg / medication.concentration_volume_ml) : null
  const units = volume !== null && medication?.units_per_ml ? volume * medication.units_per_ml : null
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      await onSubmit(mg, site, dateTime, entry?.id, medication?.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar el registro")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={entry ? "Editar registro de dosis" : "Registrar dosis"}
      subtitle="Las equivalencias se calculan desde tu concentración configurada."
      onClose={onClose}
    >
      <form className="entry-form" onSubmit={submit}>
        <label>
          Dosis registrada{" "}
          <div className="input-with-unit">
            <input
              autoFocus
              required
              type="number"
              min="0.01"
              max="1000"
              step="0.01"
              value={dose}
              onChange={(e) => setDose(e.target.value)}
              placeholder="0.0"
            />
            <span>mg</span>
          </div>
        </label>
        {volume !== null && (
          <div className="dose-calculation">
            <div>
              <span>Dose</span>
              <strong>{mg} mg</strong>
            </div>
            <div>
              <span>Volume</span>
              <strong>{volume.toFixed(3)} mL</strong>
            </div>
            {units !== null && (
              <div>
                <span>U-100 units</span>
                <strong>{units.toFixed(1)} U</strong>
              </div>
            )}
          </div>
        )}
        <label>
          Fecha y hora
          <input
            required
            type="datetime-local"
            value={dateTime}
            onChange={(event) => setDateTime(event.target.value)}
          />
        </label>
        <label>
          Lugar de inyección <span className="optional">opcional</span>
          <select value={site} onChange={(e) => setSite(e.target.value)}>
            <option value="">Seleccionar…</option>
            <option>Abdomen</option>
            <option>Muslo izquierdo</option>
            <option>Muslo derecho</option>
            <option>Parte superior del brazo</option>
            <option>Otro</option>
          </select>
        </label>
        <p className="medical-note">
          Cálculo matemático informativo. Confirma cualquier decisión de tratamiento con tu profesional de salud.
        </p>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-actions">
          <button type="button" className="cancel-button" onClick={onClose}>
            Cancelar
          </button>
          <button disabled={busy || !medication} className="primary-button">
            {busy ? "Guardando…" : entry ? "Guardar cambios" : "Guardar dosis"}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function MedicationModal({
  onClose,
  medication,
  onSubmit,
}: {
  onClose: () => void
  medication: Medication
  onSubmit: (
    medication: Medication,
    name: string,
    concentrationMg: number,
    volumeMl: number,
    unitsPerMl: number | null,
  ) => Promise<void>
}) {
  const [name, setName] = useState(medication.name)
  const [concentrationMg, setConcentrationMg] = useState(String(medication.concentration_mg))
  const [volumeMl, setVolumeMl] = useState(String(medication.concentration_volume_ml))
  const [unitsPerMl, setUnitsPerMl] = useState(medication.units_per_ml === null ? "" : String(medication.units_per_ml))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      await onSubmit(
        medication,
        name,
        Number(concentrationMg),
        Number(volumeMl),
        unitsPerMl.trim() ? Number(unitsPerMl) : null,
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar la concentración")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Configurar medicación" subtitle="Las conversiones usarán estos valores guardados." onClose={onClose}>
      <form className="entry-form" onSubmit={submit}>
        <label>
          Medicamento
          <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="config-fields">
          <label>
            Concentración{" "}
            <div className="input-with-unit">
              <input
                required
                type="number"
                min="0.001"
                step="0.01"
                value={concentrationMg}
                onChange={(event) => setConcentrationMg(event.target.value)}
              />
              <span>mg</span>
            </div>
          </label>
          <label>
            Volumen{" "}
            <div className="input-with-unit">
              <input
                required
                type="number"
                min="0.001"
                step="0.01"
                value={volumeMl}
                onChange={(event) => setVolumeMl(event.target.value)}
              />
              <span>mL</span>
            </div>
          </label>
        </div>
        <label>
          Unidades por mL <span className="optional">opcional · 100 para U-100</span>
          <div className="input-with-unit">
            <input
              type="number"
              min="0.001"
              step="0.01"
              value={unitsPerMl}
              onChange={(event) => setUnitsPerMl(event.target.value)}
              placeholder="Dejar vacío para desactivar"
            />
            <span>U/mL</span>
          </div>
        </label>
        <p className="medical-note">
          Verifica la concentración en el envase con tu profesional de salud. La aplicación no valida ni recomienda una
          dosis.
        </p>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-actions">
          <button type="button" className="cancel-button" onClick={onClose}>
            Cancelar
          </button>
          <button disabled={busy} className="primary-button">
            {busy ? "Guardando…" : "Guardar configuración"}
          </button>
        </div>
      </form>
    </Modal>
  )
}
function Modal({
  title,
  subtitle,
  onClose,
  children,
  size = "default",
}: {
  title: string
  subtitle: string
  onClose: () => void
  children: React.ReactNode
  size?: "default" | "wide"
}) {
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [onClose])
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className={`modal-card ${size === "wide" ? "modal-card-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-heading">
          <div>
            <h2 id="modal-title">{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Cerrar">
            <X size={19} />
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}
