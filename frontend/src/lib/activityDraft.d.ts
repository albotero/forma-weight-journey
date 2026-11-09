import type { ActivityTrack } from "./activityTracking.js"
import type { RecordedActivity } from "../components/editors/ActivityRecorder"
export type ActivityDraft = {
  version: 1
  activityType: string
  intensity: string
  startedAt: string
  elapsedMs: number
  track: ActivityTrack
  finished: boolean
}
export function readActivityDraft(storage: Pick<Storage, "getItem">, key?: string): ActivityDraft | null
export function writeActivityDraft(storage: Pick<Storage, "setItem">, key: string | undefined, draft: ActivityDraft): void
export function recordedActivity(draft: ActivityDraft): RecordedActivity
