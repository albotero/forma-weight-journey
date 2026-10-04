import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import {
  Activity,
  UserRoundCog,
  ArrowRight,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileText,
  Gauge,
  Home,
  LineChart,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  Pill,
  Plus,
  Ruler,
  Scale,
  Settings,
  ShieldCheck,
  Syringe,
  TrendingDown,
  UserRound,
  X,
} from "lucide-react"
import {
  api,
  logoutSession,
  refreshSession,
  type BodyMeasurementEntry,
  type Account,
  type CatalogItem,
  type CatalogResult,
  type DoseEntry,
  type JournalEntry,
  type Medication,
  type PhotoEntry,
  type Profile,
  type WeightEntry,
} from "./api"
import { localDateTimeToIso } from "./dateTime.js"
import { buildNotifications, pendingBrowserNotifications } from "./notifications.js"
import type { Section, ModalType, CompositionValues } from "./lib/types"
import {
  WEB_NOTIFICATIONS_ENABLED_KEY,
  NOTIFIED_REMINDERS_KEY,
  sectionPaths,
  pathSections,
  navigation,
} from "./lib/navigation"
import { formatDate, formatDecimal, formatDoseUnit, niceAxis, formatAxisTick, formatDateTime } from "./lib/format"
import { bmiRangeAreas, BmiRangeLegend } from "./components/charts/BmiRange"
import { estimatedNextDose, weeklyActivityChecklistDate, loadAllRecords, compositionFields } from "./lib/records"
import { MetricCard } from "./components/common/MetricCard"
import { AccountSettings } from "./components/settings/AccountSettings"
import { AuthScreen } from "./components/auth/AuthScreen"
import { EmailVerificationScreen } from "./components/auth/EmailVerificationScreen"
import { EmptyInline, EmptyChart } from "./components/common/Empty"
import { journalSectionLabels } from "./components/modules/journalDefinitions"
import { ModuleWorkspace } from "./components/modules/ModuleWorkspace"
import { bodyFields, summarizeBodyMeasurements } from "./components/modules/bodyMeasurements"
import { QuickModal } from "./components/modals/QuickModal"
import { WeightModal } from "./components/modals/WeightModal"
import { DoseModal } from "./components/modals/DoseModal"
import { MedicationModal } from "./components/modals/MedicationModal"

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
  const [goalCatalog, setGoalCatalog] = useState<CatalogItem[]>([])
  const [photos, setPhotos] = useState<PhotoEntry[]>([])
  const [editingWeight, setEditingWeight] = useState<WeightEntry | null>(null)
  const [editingDose, setEditingDose] = useState<DoseEntry | null>(null)
  const [doseMedicationId, setDoseMedicationId] = useState<number | null>(null)
  const [editingMedication, setEditingMedication] = useState<Medication | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [modal, setModal] = useState<ModalType>(null)
  const [pendingQuickSection, setPendingQuickSection] = useState<Section | null>(null)
  const [dark, setDark] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [range, setRange] = useState("90 días")
  const [homeMedicationIndex, setHomeMedicationIndex] = useState(0)
  const medicationCarouselRef = useRef<HTMLDivElement>(null)

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
        goalCatalogData,
        ...moduleEntries
      ] = await Promise.all([
        api<Profile>("/profile", authToken),
        api<Account>("/account", authToken),
        loadAllRecords<WeightEntry>("/weights", authToken),
        api<Medication[]>("/medications", authToken),
        loadAllRecords<DoseEntry>("/doses", authToken),
        loadAllRecords<BodyMeasurementEntry>("/body-measurements", authToken),
        api<PhotoEntry[]>("/photos", authToken),
        api<CatalogItem[]>("/catalog/goal", authToken),
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
      setGoalCatalog(goalCatalogData)
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
  const userTimezone = profile?.timezone ?? "America/Bogota"
  const accountInitial = account?.email.trim().charAt(0).toLocaleUpperCase("es-CO") || "?"
  const activeMedications = medications
    .filter((item) => item.active)
    .sort((first, second) => Number(second.is_primary) - Number(first.is_primary))
  const activeMedication = activeMedications[0]
  const visibleMedicationIndex = Math.min(homeMedicationIndex, Math.max(0, activeMedications.length - 1))
  function navigateHomeMedication(index: number) {
    const nextIndex = Math.max(0, Math.min(activeMedications.length - 1, index))
    setHomeMedicationIndex(nextIndex)
    medicationCarouselRef.current?.scrollTo({
      left: nextIndex * medicationCarouselRef.current.clientWidth,
      behavior: "smooth",
    })
  }
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
  const weightAxis = niceAxis(
    chartData.map((item) => item.peso),
    2,
  )
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

  const recordedWithin = (date: string, days: number) => {
    const elapsed = Date.now() - new Date(date).getTime()
    return elapsed >= 0 && elapsed <= days * 86400000
  }
  const recentSymptoms = journalEntries.filter(
    (entry) => entry.module === "symptoms" && recordedWithin(entry.occurred_at, 7),
  )
  const weeklyWeights = sortedWeights.filter((item) => recordedWithin(item.measured_at, 7))
  const weeklyCheckIn = recentSymptoms.some((entry) => entry.data.appetite != null && entry.data.satiety != null)
  const weeklyChecklist = [
    doses.some((item) => recordedWithin(item.administered_at, 7)),
    journalEntries.some(
      (entry) =>
        entry.module === "labs" &&
        recordedWithin(entry.occurred_at, 7) &&
        Array.isArray(entry.data.results) &&
        (entry.data.results as CatalogResult[]).some((result) => result.systolic != null),
    ),
    weeklyCheckIn,
    recentSymptoms.some(
      (entry) =>
        (Array.isArray(entry.data.results) && (entry.data.results as CatalogResult[]).length > 0) ||
        entry.data.tolerance != null,
    ),
    recentSymptoms.some((entry) => entry.data.hydration_l != null),
    journalEntries.some(
      (entry) => entry.module === "activity" && recordedWithin(weeklyActivityChecklistDate(entry), 7),
    ),
    weeklyWeights.some((item) => compositionFields.some(([key]) => item[key] != null)),
  ]
  const monthlyWeights = sortedWeights.filter((item) => recordedWithin(item.measured_at, 28))
  const monthlyChecklist = [
    monthlyWeights.length >= 2,
    bodyMeasurements.some(
      (item) => recordedWithin(item.measured_at, 28) && bodyFields.some(([key]) => item[key] != null),
    ),
    photos.some((item) => recordedWithin(item.taken_at, 28)),
    journalEntries.some(
      (entry) =>
        entry.module === "symptoms" &&
        recordedWithin(entry.occurred_at, 28) &&
        ((Array.isArray(entry.data.results) && (entry.data.results as CatalogResult[]).length > 0) ||
          entry.data.tolerance != null),
    ),
    doses.some((item) => new Date(item.administered_at).getTime() <= Date.now()),
    ...(goalCatalog.length
      ? [journalEntries.some((entry) => entry.module === "goals" && recordedWithin(entry.occurred_at, 28))]
      : []),
  ]
  const homeChecklist = [
    {
      label: "Cada día",
      summary:
        latestWeightEntry && recordedWithin(latestWeightEntry.measured_at, 1)
          ? `Peso ${formatDecimal(latestWeightEntry.weight_kg)} kg`
          : "Peso pendiente",
      completed: latestWeightEntry && recordedWithin(latestWeightEntry.measured_at, 1) ? 1 : 0,
      total: 1,
    },
    {
      label: "Cada semana",
      summary: "Seguimiento semanal",
      completed: weeklyChecklist.filter(Boolean).length,
      total: weeklyChecklist.length,
    },
    {
      label: "Cada 4 semanas",
      summary: "Seguimiento mensual",
      completed: monthlyChecklist.filter(Boolean).length,
      total: monthlyChecklist.length,
    },
  ]
  const recentJournalEntries = journalEntries.filter((entry) => entry.module !== "reminders")

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

  async function submitDose(
    amount: number,
    unit: DoseEntry["dose_unit"],
    injectionSite: string,
    dateTime: string,
    id?: number,
    medicationId?: number,
  ) {
    const targetMedicationId = medicationId ?? activeMedication?.id
    if (!token || !targetMedicationId) return
    await api(id ? `/doses/${id}` : "/doses", token, {
      method: id ? "PUT" : "POST",
      body: JSON.stringify({
        medication_id: targetMedicationId,
        dose_amount: amount,
        dose_unit: unit,
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
    route: Medication["route"],
    concentrationMg: number | null,
    volumeMl: number | null,
    unitsPerMl: number | null,
    dosingInterval: Medication["dosing_interval"],
  ) {
    if (!token) return
    await api(`/medications/${medication.id}`, token, {
      method: "PUT",
      body: JSON.stringify({
        name,
        active: medication.active,
        route,
        concentration_mg: concentrationMg,
        concentration_volume_ml: volumeMl,
        units_per_ml: unitsPerMl,
        dosing_interval: dosingInterval,
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
                          {bmiRangeAreas(profile?.height_cm, weightAxis.domain)}
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
                            domain={weightAxis.domain}
                            ticks={weightAxis.ticks}
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: "var(--muted)", fontSize: 11 }}
                            tickFormatter={(value) => formatAxisTick(Number(value))}
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
                  {profile && <BmiRangeLegend />}
                </div>
                <div className="panel medication-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="eyebrow">TRATAMIENTO</div>
                      <h2>Medicación</h2>
                    </div>
                    <div className="medication-panel-actions">
                      {activeMedications.length > 1 && (
                        <div className="medication-carousel-controls" aria-label="Cambiar medicamento">
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Medicamento anterior"
                            disabled={visibleMedicationIndex === 0}
                            onClick={() => navigateHomeMedication(visibleMedicationIndex - 1)}
                          >
                            <ChevronLeft size={16} />
                          </button>
                          <span aria-live="polite">
                            {visibleMedicationIndex + 1}/{activeMedications.length}
                          </span>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Medicamento siguiente"
                            disabled={visibleMedicationIndex >= activeMedications.length - 1}
                            onClick={() => navigateHomeMedication(visibleMedicationIndex + 1)}
                          >
                            <ChevronRight size={16} />
                          </button>
                        </div>
                      )}
                      <button
                        className="dots-button"
                        aria-label="Ver y editar medicamentos"
                        onClick={() => setSection("Medicación")}
                      >
                        <Settings size={17} />
                      </button>
                    </div>
                  </div>
                  {activeMedications.length > 0 ? (
                    <div
                      className="medication-carousel"
                      role="region"
                      aria-label="Medicamentos activos"
                      tabIndex={activeMedications.length > 1 ? 0 : undefined}
                      ref={medicationCarouselRef}
                      onScroll={(event) => {
                        const width = event.currentTarget.clientWidth
                        if (width > 0) {
                          const index = Math.min(
                            activeMedications.length - 1,
                            Math.round(event.currentTarget.scrollLeft / width),
                          )
                          setHomeMedicationIndex((current) => (current === index ? current : index))
                        }
                      }}
                    >
                      {activeMedications.map((medication) => {
                        const medicationDose = doses.find(
                          (item) =>
                            item.medication_id === medication.id &&
                            new Date(item.administered_at).getTime() <= Date.now(),
                        )
                        const nextDoseAt = estimatedNextDose(medication, doses)
                        return (
                          <article className="medication-slide" key={medication.id}>
                            <div className="medication-name">
                              <div className="medication-symbol">
                                {medication.route === "oral" ? <Pill size={21} /> : <Syringe size={21} />}
                              </div>
                              <div>
                                <strong>{medication.name}</strong>
                                <span>En seguimiento</span>
                              </div>
                              <span className="med-active">{medication.is_primary ? "Principal" : "Activo"}</span>
                            </div>
                            <div className="dose-highlight">
                              <span>ÚLTIMO REGISTRO</span>
                              <strong>
                                {medicationDose ? (
                                  <>
                                    <span>{formatDecimal(medicationDose.dose_amount)}</span>{" "}
                                    <small>
                                      {formatDoseUnit(medicationDose.dose_amount, medicationDose.dose_unit)}
                                    </small>
                                  </>
                                ) : (
                                  "—"
                                )}
                              </strong>
                              <p>
                                {medicationDose
                                  ? formatDate(medicationDose.administered_at, userTimezone)
                                  : "Sin dosis registradas"}
                              </p>
                            </div>
                            <div className="dose-details">
                              {medication.route === "injectable" && (
                                <>
                                  <span>Concentración</span>
                                  <strong>
                                    {medication.concentration_mg} mg / {medication.concentration_volume_ml} mL
                                  </strong>
                                  <span>Equivalencia</span>
                                  <strong>
                                    {medication.concentration_mg != null && medication.concentration_volume_ml != null
                                      ? `${(medication.concentration_mg / medication.concentration_volume_ml).toFixed(1)} mg/mL`
                                      : "Configurar concentración"}
                                    {medication.units_per_ml ? " · U-100 habilitado" : ""}
                                  </strong>
                                </>
                              )}
                              {medication.route === "oral" && (
                                <>
                                  <span>Vía</span>
                                  <strong>Oral</strong>
                                </>
                              )}
                              <span>Próxima dosis estimada</span>
                              <strong>
                                {nextDoseAt
                                  ? `${new Date(nextDoseAt).getTime() < Date.now() ? "Pendiente desde " : ""}${formatDateTime(nextDoseAt, userTimezone)}`
                                  : "Configura la frecuencia y registra una dosis"}
                              </strong>
                            </div>
                            <button
                              className="outline-button full-button"
                              onClick={() => {
                                setEditingDose(null)
                                setDoseMedicationId(medication.id)
                                setModal("dose")
                              }}
                            >
                              <Plus size={16} /> Registrar dosis
                            </button>
                          </article>
                        )
                      })}
                    </div>
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
                  <div className="recent-checklist" aria-label="Checklist contextual">
                    {homeChecklist.map(({ label, summary, completed, total }) => (
                      <button key={label} type="button" onClick={() => setSection("Análisis")}>
                        <span>
                          <strong>{label}</strong>
                          <small>{summary}</small>
                        </span>
                        <span className="followup-count">
                          {completed}/{total}
                        </span>
                      </button>
                    ))}
                  </div>
                  {sortedWeights.length ||
                  doses.length ||
                  bodyMeasurements.length ||
                  recentJournalEntries.length ||
                  photos.length ? (
                    <div className="activity-list">
                      {[
                        ...sortedWeights.map((item) => ({
                          id: `w${item.id}`,
                          icon: Scale,
                          kind: "weight",
                          date: item.measured_at,
                          text: `${formatDecimal(item.weight_kg)} kg`,
                          sub: "Peso",
                        })),
                        ...doses.map((item) => ({
                          id: `d${item.id}`,
                          icon:
                            medications.find((medication) => medication.id === item.medication_id)?.route === "oral"
                              ? Pill
                              : Syringe,
                          kind: "dose",
                          date: item.administered_at,
                          text: `${medications.find((medication) => medication.id === item.medication_id)?.name ?? "Medicamento"} · ${formatDecimal(item.dose_amount)} ${formatDoseUnit(item.dose_amount, item.dose_unit)}`,
                          sub: "Medicación",
                        })),
                        ...bodyMeasurements.map((item) => ({
                          id: `m${item.id}`,
                          icon: Ruler,
                          kind: "measurements",
                          date: item.measured_at,
                          text: summarizeBodyMeasurements(item),
                          sub: "Medidas",
                        })),
                        ...photos.map((item) => ({
                          id: `p${item.id}`,
                          icon: UserRound,
                          kind: "photos",
                          date: item.taken_at,
                          text: item.caption?.trim() || "Foto registrada",
                          sub: "Fotos",
                        })),
                        ...recentJournalEntries.map((item) => ({
                          id: `e${item.id}`,
                          icon:
                            navigation.find(({ label }) => label === journalSectionLabels[item.module])?.icon ??
                            FileText,
                          kind: item.module,
                          date: item.occurred_at,
                          text: Array.isArray(item.data.results)
                            ? (item.data.results as CatalogResult[]).length
                              ? `${(item.data.results as CatalogResult[])
                                  .slice(0, 2)
                                  .map(
                                    (result) =>
                                      `${result.name}: ${result.systolic != null ? `${result.systolic}/${result.diastolic}` : result.value != null ? formatDecimal(result.value) : (result.text_value ?? `${result.severity ?? result.intensity}/10`)}${result.unit ? ` ${result.unit}` : ""}`,
                                  )
                                  .join(
                                    " · ",
                                  )}${item.data.results.length > 2 ? ` · +${item.data.results.length - 2} más` : ""}`
                              : item.title
                            : item.module === "activity"
                              ? [
                                  item.title,
                                  item.data.weekly_steps != null
                                    ? `${formatDecimal(Number(item.data.weekly_steps))} pasos`
                                    : item.data.duration_min != null
                                      ? `${formatDecimal(Number(item.data.duration_min))} min`
                                      : item.data.weekly_calories_kcal != null
                                        ? `${formatDecimal(Number(item.data.weekly_calories_kcal))} kcal`
                                        : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")
                              : item.module === "symptoms"
                                ? [
                                    item.title,
                                    item.data.appetite ? `Apetito: ${item.data.appetite}` : null,
                                    item.data.tolerance ? `Tolerancia: ${item.data.tolerance}` : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")
                                : item.module === "reviews"
                                  ? [item.title, item.data.review_type, item.data.provider].filter(Boolean).join(" · ")
                                  : item.title,
                          sub: journalSectionLabels[item.module],
                        })),
                      ]
                        .sort((a, b) => b.date.localeCompare(a.date))
                        .slice(0, 4)
                        .map((item) => (
                          <div className="activity-row" key={item.id}>
                            <div className={`activity-icon ${item.kind}`}>
                              <item.icon size={16} />
                            </div>
                            <div className="activity-copy">
                              <strong title={item.text}>
                                {item.text.length > 72 ? `${item.text.slice(0, 69).trimEnd()}…` : item.text}
                              </strong>
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
              hasGoals={goalCatalog.length > 0}
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
              autoOpenEntry={pendingQuickSection === section}
              onAutoOpenHandled={() => setPendingQuickSection(null)}
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
          { label: "Análisis" as Section, icon: LineChart },
          { label: "Registrar" as const, icon: Plus },
          { label: "Historial" as Section, icon: Clock3 },
          { label: "Más" as const, icon: MoreHorizontal },
        ].map(({ label, icon: Icon }) => (
          <button
            key={label}
            className={label === "Registrar" ? "register-action" : section === label ? "active" : ""}
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
              setPendingQuickSection(target.section)
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
