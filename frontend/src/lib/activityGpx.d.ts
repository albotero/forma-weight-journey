import type { RecordedActivity } from "../components/editors/ActivityRecorder"
export const maxGpxBytes: number
export type GpxPoint = {
  latitude: number
  longitude: number
  timestamp: number
  altitude: number | null
}
export type GpxImport = { activity: RecordedActivity; filteredPoints: number }
export function parseActivityGpx(xml: string, activityType: string): GpxImport
export function importActivityGpxSegments(segments: GpxPoint[][], activityType: string): GpxImport
