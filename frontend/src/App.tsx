import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  CircleHelp,
  Clock3,
  Dna,
  FileText,
  Footprints,
  Gauge,
  HeartPulse,
  Home,
  LineChart,
  LogOut,
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
  UserRound,
  X,
} from "lucide-react"
import {
  api,
  authenticate,
  loadPhoto,
  logoutSession,
  refreshSession,
  uploadPhoto,
  type BodyMeasurementEntry,
  type DoseEntry,
  type JournalEntry,
  type JournalModule,
  type Medication,
  type PhotoEntry,
  type Profile,
  type WeightEntry,
} from "./api"

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
type AuthMode = "login" | "register"
type ModalType = "weight" | "dose" | "body" | "quick" | "medication" | null
type CompositionValues = Omit<WeightEntry, "id" | "measured_at" | "weight_kg" | "source" | "notes">
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
]
const formatDate = (date: string, timeZone = "America/Bogota") =>
  new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone }).format(new Date(date))
const currentLocalDateTime = () => {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
const dateTimeInputValue = (value: string) => {
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
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
  ["bmr_kcal", "Metabolismo basal", "kcal", 20000, 1],
  ["metabolic_age", "Edad metabólica", "años", 150, 1],
] as const

export default function App() {
  const [token, setToken] = useState<string | null>(null)
  const [restoringSession, setRestoringSession] = useState(true)
  const [section, setSection] = useState<Section>("Inicio")
  const [profile, setProfile] = useState<Profile | null>(null)
  const [weights, setWeights] = useState<WeightEntry[]>([])
  const [medications, setMedications] = useState<Medication[]>([])
  const [doses, setDoses] = useState<DoseEntry[]>([])
  const [bodyMeasurements, setBodyMeasurements] = useState<BodyMeasurementEntry[]>([])
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([])
  const [photos, setPhotos] = useState<PhotoEntry[]>([])
  const [editingWeight, setEditingWeight] = useState<WeightEntry | null>(null)
  const [editingDose, setEditingDose] = useState<DoseEntry | null>(null)
  const [editingMedication, setEditingMedication] = useState<Medication | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [modal, setModal] = useState<ModalType>(null)
  const [dark, setDark] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [range, setRange] = useState("90 días")

  const refresh = useCallback(async (authToken: string) => {
    setLoading(true)
    setError("")
    try {
      const [profileData, weightData, medicationData, doseData, measurementData, photoData, ...moduleEntries] =
        await Promise.all([
          api<Profile>("/profile", authToken),
          api<WeightEntry[]>("/weights?limit=300", authToken),
          api<Medication[]>("/medications", authToken),
          api<DoseEntry[]>("/doses?limit=100", authToken),
          api<BodyMeasurementEntry[]>("/body-measurements?limit=100", authToken),
          api<PhotoEntry[]>("/photos", authToken),
          ...(["symptoms", "activity", "labs", "goals", "reviews", "reminders"] as const).map((module) =>
            api<JournalEntry[]>(`/entries/${module}`, authToken),
          ),
        ])
      setProfile(profileData)
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
  const currentWeight = sortedWeights.at(-1)?.weight_kg
  const startingWeight = profile?.initial_weight_kg ?? 106
  const loss = currentWeight === undefined ? 0 : startingWeight - currentWeight
  const lossPercent = currentWeight === undefined ? 0 : (loss / startingWeight) * 100
  const bmiNow = currentWeight && profile ? currentWeight / (profile.height_cm / 100) ** 2 : null
  const currentDose = doses[0]
  const userTimezone = profile?.timezone ?? "America/Bogota"
  const activeMedication = medications.find((item) => item.active)
  const chartData = useMemo(() => {
    const days =
      range === "30 días" ? 30 : range === "90 días" ? 90 : range === "6 meses" ? 183 : range === "1 año" ? 365 : 10000
    const cutoff = Date.now() - days * 86400000
    return sortedWeights
      .filter((item) => new Date(item.measured_at).getTime() >= cutoff)
      .map((item) => ({ date: formatDate(item.measured_at, userTimezone), peso: item.weight_kg }))
  }, [sortedWeights, range, userTimezone])
  const average7 = useMemo(() => {
    const recent = sortedWeights.filter((item) => Date.now() - new Date(item.measured_at).getTime() <= 7 * 86400000)
    return recent.length ? recent.reduce((sum, item) => sum + item.weight_kg, 0) / recent.length : null
  }, [sortedWeights])
  const goals = [5, 10, 15, 20].map((percent) => ({ percent, weight: startingWeight * (1 - percent / 100) }))
  const progress = (goal: number) =>
    Math.max(0, Math.min(100, ((startingWeight - (currentWeight ?? startingWeight)) / (startingWeight - goal)) * 100))

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
        measured_at: new Date(dateTime).toISOString(),
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
        administered_at: new Date(dateTime).toISOString(),
        injection_site: injectionSite || null,
      }),
    })
    await refresh(token)
    setModal(null)
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
          {navigation.map(({ label, icon: Icon }) => (
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
          <div className="profile-chip">
            <div className="avatar">T</div>
            <div>
              <strong>Tu seguimiento</strong>
              <p>Espacio personal</p>
            </div>
            <MoreHorizontal size={20} className="profile-more" />
          </div>
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
            <button className="icon-button notification-button" aria-label="Notificaciones">
              <Bell size={19} />
              <i />
            </button>
            <div className="top-avatar">T</div>
          </div>
        </header>
        <div className="page-content">
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button onClick={() => token && void refresh(token)}>Reintentar</button>
            </div>
          )}
          {section === "Inicio" || section === "Peso" || section === "Análisis" ? (
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
                  value={currentWeight ? currentWeight.toFixed(1) : "—"}
                  unit="kg"
                  foot={
                    currentWeight
                      ? `Último registro · ${formatDate(sortedWeights.at(-1)!.measured_at, userTimezone)}`
                      : "Aún no hay registros"
                  }
                  accent="green"
                />
                <MetricCard
                  label="CAMBIO TOTAL"
                  icon={<TrendingDown size={18} />}
                  value={currentWeight ? `${loss > 0 ? "−" : "+"}${Math.abs(loss).toFixed(1)}` : "—"}
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
                  value={average7 ? average7.toFixed(1) : "—"}
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
                            formatter={(value) => [`${Number(value).toFixed(1)} kg`, "Peso"]}
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
                            <strong>{weight.toFixed(1)} kg</strong>
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
                          text: `${item.weight_kg.toFixed(1)} kg`,
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
          ) : (
            <ModuleWorkspace
              section={section}
              token={token}
              weights={sortedWeights}
              doses={doses}
              measurements={bodyMeasurements}
              medications={medications}
              entries={journalEntries}
              photos={photos}
              profile={profile}
              onRefresh={() => refresh(token)}
              onError={setError}
              onNewWeight={() => setModal("weight")}
              onNewDose={() => setModal("dose")}
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
          onClose={() => {
            setModal(null)
            setEditingDose(null)
          }}
          medication={medications.find((item) => item.id === editingDose?.medication_id) ?? activeMedication}
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

function AuthScreen({ onAuthenticated }: { onAuthenticated: (token: string) => void }) {
  const [mode, setMode] = useState<AuthMode>("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      onAuthenticated(await authenticate(email, password, mode === "register"))
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
          <h2>{mode === "login" ? "Qué bueno tenerte de vuelta." : "Crea tu espacio seguro."}</h2>
          <p>
            {mode === "login"
              ? "Inicia sesión para ver tu seguimiento personal."
              : "Tu cuenta es privada y solo tú puedes acceder."}
          </p>
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
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
          {mode === "register" && (
            <small className="password-hint">
              Usa al menos 12 caracteres. La contraseña se almacena con hash seguro.
            </small>
          )}
          <button className="primary-button auth-submit" disabled={busy}>
            {busy ? "Un momento…" : mode === "login" ? "Iniciar sesión" : "Crear cuenta"} <ArrowRight size={17} />
          </button>
          <div className="auth-switch">
            {mode === "login" ? "¿Primera vez aquí?" : "¿Ya tienes una cuenta?"}{" "}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login")
                setError("")
              }}
            >
              {mode === "login" ? "Crear cuenta" : "Iniciar sesión"}
            </button>
          </div>
          <div className="auth-security">
            <ShieldCheck size={15} /> Contraseña con hash seguro · Sin anuncios ni rastreo
          </div>
        </form>
      </div>
    </div>
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
    title: "síntoma",
    fields: [
      { key: "severity", label: "Intensidad (0–10)", type: "number" },
      { key: "duration", label: "Duración" },
      { key: "triggers", label: "Posibles factores" },
    ],
  },
  activity: {
    title: "actividad",
    fields: [
      { key: "duration_min", label: "Duración (min)", type: "number" },
      { key: "distance_km", label: "Distancia (km)", type: "number" },
      { key: "intensity", label: "Intensidad", options: ["Suave", "Moderada", "Intensa"] },
    ],
  },
  labs: {
    title: "resultado",
    fields: [
      { key: "value", label: "Resultado" },
      { key: "unit", label: "Unidad" },
      { key: "reference_range", label: "Rango de referencia" },
      { key: "laboratory", label: "Laboratorio" },
    ],
  },
  goals: {
    title: "objetivo",
    fields: [
      { key: "target_value", label: "Meta" },
      { key: "unit", label: "Unidad" },
      { key: "due_date", label: "Fecha objetivo", type: "date" },
      { key: "status", label: "Estado", options: ["En progreso", "Completado", "En pausa"] },
    ],
  },
  reviews: {
    title: "revisión",
    fields: [
      { key: "provider", label: "Profesional / centro" },
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
  onRefresh: () => Promise<void>
  onError: (message: string) => void
  onNewWeight: () => void
  onNewDose: () => void
  onEditWeight: (entry: WeightEntry) => void
  onEditDose: (entry: DoseEntry) => void
  onEditMedication: (entry: Medication) => void
  onDelete: (path: string) => Promise<void>
}) {
  const { section, token, weights, doses, measurements, medications, entries, photos } = props
  const module = journalModuleBySection[section]
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null)
  const [showEntryForm, setShowEntryForm] = useState(false)
  const [editingMeasurement, setEditingMeasurement] = useState<BodyMeasurementEntry | null>(null)
  const [showMeasurementForm, setShowMeasurementForm] = useState(false)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoCaption, setPhotoCaption] = useState("")
  const [photoDate, setPhotoDate] = useState(currentLocalDateTime)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [showNewMedication, setShowNewMedication] = useState(false)

  async function saveJournal(payload: Omit<JournalEntry, "id" | "created_at" | "updated_at">) {
    await api(editingEntry ? `/entries/${editingEntry.id}` : "/entries", token, {
      method: editingEntry ? "PUT" : "POST",
      body: JSON.stringify(payload),
    })
    await props.onRefresh()
    setShowEntryForm(false)
    setEditingEntry(null)
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
      await uploadPhoto(token, photoFile, photoCaption, photoDate)
      setPhotoFile(null)
      setPhotoCaption("")
      setPhotoDate(currentLocalDateTime())
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
        {module && (
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
      </div>

      {section === "Composición" && (
        <>
          <p className="module-hint">
            Lecturas de báscula; son estimaciones del dispositivo, no mediciones diagnósticas. Todos los campos de
            composición son opcionales.
          </p>
          <div className="record-list">
            {weights
              .filter((item) => compositionFields.some(([key]) => item[key] != null))
              .map((item) => (
                <article className="record-card" key={item.id}>
                  <div className="record-card-heading">
                    <div>
                      <strong>{item.weight_kg.toFixed(1)} kg</strong>
                      <time>{formatDateTime(item.measured_at)}</time>
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
                            {item[key]} {unit}
                          </strong>
                        </div>
                      ))}
                  </div>
                  {item.notes && <p>{item.notes}</p>}
                </article>
              ))}
            {!weights.length && <EmptyModule text="Registra una lectura de tu báscula para empezar." />}
          </div>
        </>
      )}

      {section === "Peso" && (
        <div className="record-list">
          {weights.map((item) => (
            <article className="record-card" key={item.id}>
              <div className="record-card-heading">
                <div>
                  <strong>{item.weight_kg.toFixed(1)} kg</strong>
                  <time>{formatDateTime(item.measured_at)}</time>
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
                <strong>{formatDateTime(item.measured_at)}</strong>
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
                        {item[key]} {unit}
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
                    <time>{formatDateTime(item.administered_at)}</time>
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

      {module && (
        <>
          {module === "reminders" && (
            <p className="module-hint">
              Los recordatorios quedan guardados aquí. Las notificaciones automáticas fuera de la aplicación requieren
              configurar un canal y todavía no se envían.
            </p>
          )}
          <div className="record-list">
            {entries
              .filter((entry) => entry.module === module)
              .map((entry) => (
                <article className="record-card" key={entry.id}>
                  <div className="record-card-heading">
                    <div>
                      <strong>{entry.title}</strong>
                      <time>{formatDateTime(entry.occurred_at)}</time>
                    </div>
                    <RecordActions
                      onEdit={() => {
                        setEditingEntry(entry)
                        setShowEntryForm(true)
                      }}
                      onDelete={() => void props.onDelete(`/entries/${entry.id}`)}
                    />
                  </div>
                  <div className="composition-results">
                    {journalDefinitions[module].fields
                      .filter(
                        ({ key }) =>
                          entry.data[key] !== undefined && entry.data[key] !== null && entry.data[key] !== "",
                      )
                      .map(({ key, label }) => (
                        <div key={key}>
                          <span>{label}</span>
                          <strong>{String(entry.data[key])}</strong>
                        </div>
                      ))}
                  </div>
                  {entry.notes && <p>{entry.notes}</p>}
                </article>
              ))}
            {!entries.some((entry) => entry.module === module) && (
              <EmptyModule text={`Aún no hay registros de ${section.toLowerCase()}.`} />
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
                    {item.label} · {formatDateTime(item.date)}
                  </span>
                </div>
                <RecordActions onEdit={item.edit} onDelete={() => void item.remove()} />
              </article>
            ))}
        </div>
      )}

      {showEntryForm && module && (
        <JournalEntryEditor
          module={module}
          entry={editingEntry ?? undefined}
          onClose={() => {
            setShowEntryForm(false)
            setEditingEntry(null)
          }}
          onSave={saveJournal}
        />
      )}
      {showMeasurementForm && (
        <BodyMeasurementEditor
          entry={editingMeasurement ?? undefined}
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

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
}

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

function JournalEntryEditor({
  module,
  entry,
  onClose,
  onSave,
}: {
  module: JournalModule
  entry?: JournalEntry
  onClose: () => void
  onSave: (payload: Omit<JournalEntry, "id" | "created_at" | "updated_at">) => Promise<void>
}) {
  const [title, setTitle] = useState(entry?.title ?? "")
  const [occurredAt, setOccurredAt] = useState(entry ? dateTimeInputValue(entry.occurred_at) : currentLocalDateTime)
  const [notes, setNotes] = useState(entry?.notes ?? "")
  const [data, setData] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      journalDefinitions[module].fields.map(({ key }) => [
        key,
        entry?.data[key] == null ? "" : String(entry.data[key]),
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
        data[key] === "" ? null : type === "number" ? Number(data[key]) : data[key],
      ]),
    )
    try {
      await onSave({
        module,
        title,
        occurred_at: new Date(occurredAt).toISOString(),
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
        <label>
          {module === "labs" ? "Prueba" : module === "symptoms" ? "Síntoma" : journalDefinitions[module].title}
          <input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
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
                step={type === "number" ? "any" : undefined}
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

function BodyMeasurementEditor({
  entry,
  onClose,
  onSave,
}: {
  entry?: BodyMeasurementEntry
  onClose: () => void
  onSave: (payload: Record<string, unknown>) => Promise<void>
}) {
  const [date, setDate] = useState(entry ? dateTimeInputValue(entry.measured_at) : currentLocalDateTime)
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
        measured_at: new Date(date).toISOString(),
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
                step="0.1"
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
  onRefresh,
  onDelete,
}: {
  photo: PhotoEntry
  token: string
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
          <time>{formatDateTime(photo.taken_at)}</time>
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
  onClose,
  onSave,
}: {
  photo: PhotoEntry
  token: string
  onClose: () => void
  onSave: () => Promise<void>
}) {
  const [caption, setCaption] = useState(photo.caption ?? "")
  const [takenAt, setTakenAt] = useState(dateTimeInputValue(photo.taken_at))
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      await api(`/photos/${photo.id}`, token, {
        method: "PUT",
        body: JSON.stringify({ caption: caption || null, taken_at: new Date(takenAt).toISOString() }),
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
}: {
  onClose: () => void
  entry?: WeightEntry
  onSubmit: (
    weight: number,
    notes: string,
    dateTime: string,
    composition: CompositionValues,
    id?: number,
  ) => Promise<void>
}) {
  const [weight, setWeight] = useState(entry ? String(entry.weight_kg) : "")
  const [notes, setNotes] = useState(entry?.notes ?? "")
  const [dateTime, setDateTime] = useState(entry ? dateTimeInputValue(entry.measured_at) : currentLocalDateTime)
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
              step="0.1"
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
}: {
  onClose: () => void
  entry?: DoseEntry
  medication: Medication | undefined
  onSubmit: (mg: number, site: string, dateTime: string, id?: number, medicationId?: number) => Promise<void>
}) {
  const [dose, setDose] = useState(entry ? String(entry.dose_mg) : "")
  const [site, setSite] = useState(entry?.injection_site ?? "")
  const [dateTime, setDateTime] = useState(entry ? dateTimeInputValue(entry.administered_at) : currentLocalDateTime)
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
                step="any"
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
                step="any"
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
              step="any"
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
