const API_URL = import.meta.env.VITE_API_URL ?? "/api"

export type WeightEntry = {
  id: number
  measured_at: string
  weight_kg: number
  source?: string | null
  notes?: string | null
}
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
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...options.headers },
  })
  if (!response.ok) {
    const body: { detail?: string } = await response.json().catch(() => ({}))
    throw new ApiError(body.detail ?? "No se pudo completar la solicitud.", response.status)
  }
  return response.json() as Promise<T>
}

export async function authenticate(email: string, password: string, createAccount: boolean): Promise<string> {
  const response = await fetch(`${API_URL}/auth/${createAccount ? "register" : "login"}`, {
    method: "POST",
    headers: { "Content-Type": createAccount ? "application/json" : "application/x-www-form-urlencoded" },
    body: createAccount ? JSON.stringify({ email, password }) : new URLSearchParams({ username: email, password }),
  })
  const result: { access_token?: string; detail?: string } = await response.json().catch(() => ({}))
  if (!response.ok || !result.access_token) throw new Error(result.detail ?? "No se pudo iniciar sesión.")
  return result.access_token
}
