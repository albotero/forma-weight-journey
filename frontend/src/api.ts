const API_URL = import.meta.env.VITE_API_URL ?? "/api"
let currentAccessToken: string | null = null
let pendingRefresh: Promise<string | null> | null = null

export type WeightEntry = {
  id: number
  measured_at: string
  weight_kg: number
  body_fat_percent: number | null
  fat_free_mass_kg: number | null
  subcutaneous_fat_percent: number | null
  visceral_fat_index: number | null
  body_water_percent: number | null
  skeletal_muscle_percent: number | null
  muscle_mass_kg: number | null
  bone_mass_kg: number | null
  protein_percent: number | null
  bmr_kcal: number | null
  metabolic_age: number | null
  source?: string | null
  notes?: string | null
}
export type BodyMeasurementEntry = {
  id: number
  measured_at: string
  waist_cm: number | null
  neck_cm: number | null
  chest_cm: number | null
  abdomen_cm: number | null
  hip_cm: number | null
  arm_cm: number | null
  thigh_cm: number | null
  notes: string | null
}
export type JournalModule = "symptoms" | "activity" | "labs" | "goals" | "reviews" | "reminders"
export type JournalEntry = {
  id: number
  module: JournalModule
  occurred_at: string
  title: string
  data: Record<string, string | number | boolean | null>
  notes: string | null
}
export type PhotoEntry = { id: number; caption: string | null; taken_at: string; created_at: string }
export type Medication = {
  id: number
  name: string
  active: boolean
  concentration_mg: number
  concentration_volume_ml: number
  units_per_ml: number | null
}
export type DoseEntry = {
  id: number
  medication_id: number
  administered_at: string
  dose_mg: number
  calculated_volume_ml: number
  calculated_u100_units: number | null
  injection_site?: string | null
  notes?: string | null
}
export type Profile = { id: number; height_cm: number; initial_weight_kg: number; timezone: string }

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function api<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const request = (accessToken: string) =>
    fetch(`${API_URL}${path}`, {
      ...options,
      credentials: "same-origin",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...options.headers },
    })
  let response = await request(currentAccessToken ?? token)
  if (response.status === 401 && path !== "/auth/refresh") {
    const newToken = await refreshSession()
    if (newToken) response = await request(newToken)
  }
  if (!response.ok) {
    const body: { detail?: string } = await response.json().catch(() => ({}))
    throw new ApiError(body.detail ?? "No se pudo completar la solicitud.", response.status)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function authenticate(email: string, password: string, createAccount: boolean): Promise<string> {
  const response = await fetch(`${API_URL}/auth/${createAccount ? "register" : "login"}`, {
    credentials: "same-origin",
    method: "POST",
    headers: { "Content-Type": createAccount ? "application/json" : "application/x-www-form-urlencoded" },
    body: createAccount ? JSON.stringify({ email, password }) : new URLSearchParams({ username: email, password }),
  })
  const result: { access_token?: string; detail?: string } = await response.json().catch(() => ({}))
  if (!response.ok || !result.access_token) throw new Error(result.detail ?? "No se pudo iniciar sesión.")
  currentAccessToken = result.access_token
  return result.access_token
}

export async function refreshSession(): Promise<string | null> {
  if (pendingRefresh) return pendingRefresh
  pendingRefresh = fetch(`${API_URL}/auth/refresh`, { method: "POST", credentials: "same-origin" })
    .then(async (response) => {
      if (!response.ok) return null
      const result: { access_token: string } = await response.json()
      currentAccessToken = result.access_token
      return result.access_token
    })
    .finally(() => {
      pendingRefresh = null
    })
  return pendingRefresh
}

export async function logoutSession(): Promise<void> {
  if (pendingRefresh) await pendingRefresh.catch(() => null)
  currentAccessToken = null
  try {
    await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "same-origin" })
  } catch {
    // Clear the local token even when the server cannot be reached.
  }
}

export async function uploadPhoto(token: string, file: File, caption: string, takenAt: string): Promise<PhotoEntry> {
  const form = new FormData()
  form.set("file", file)
  form.set("caption", caption)
  form.set("taken_at", new Date(takenAt).toISOString())
  const request = (accessToken: string) => fetch(`${API_URL}/photos`, {
    method: "POST",
    credentials: "same-origin",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  })
  let response = await request(currentAccessToken ?? token)
  if (response.status === 401) {
    const refreshed = await refreshSession()
    if (refreshed) response = await request(refreshed)
  }
  if (!response.ok) {
    const body: { detail?: string } = await response.json().catch(() => ({}))
    throw new ApiError(body.detail ?? "No se pudo guardar la foto.", response.status)
  }
  return response.json() as Promise<PhotoEntry>
}

export async function loadPhoto(token: string, photoId: number): Promise<string> {
  const request = (accessToken: string) => fetch(`${API_URL}/photos/${photoId}/image`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: "same-origin",
  })
  let response = await request(currentAccessToken ?? token)
  if (response.status === 401) {
    const refreshed = await refreshSession()
    if (refreshed) response = await request(refreshed)
  }
  if (!response.ok) throw new ApiError("No se pudo cargar la foto.", response.status)
  return URL.createObjectURL(await response.blob())
}
