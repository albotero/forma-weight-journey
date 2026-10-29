export type ActivityPosition = {
  latitude: number
  longitude: number
  accuracy: number
  timestamp: number
  altitude: number | null
  altitudeAccuracy: number | null
}
export type ActivityTrack = {
  distanceM: number
  ascentM: number | null
  descentM: number | null
  samples: number
  last: ActivityPosition | null
  altitude: ActivityPosition | null
}
export function emptyActivityTrack(): ActivityTrack
export function addActivityPosition(track: ActivityTrack, point: ActivityPosition, activityType: string): ActivityTrack
