export type ScreenWakeLockStatus = "requesting" | "active" | "released" | "unavailable"

export function keepScreenAwake(
  onChange: (status: ScreenWakeLockStatus) => void,
  environment?: {
    wakeLock?: Pick<WakeLock, "request"> | null
    visibility?: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">
  },
): () => void