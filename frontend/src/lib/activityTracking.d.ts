export type ActivityPosition = {
  latitude: number
  longitude: number
  accuracy: number
  timestamp: number
  speed?: number | null
  altitude: number | null
  altitudeAccuracy: number | null
}
export type ActivityRoutePoint = {
  latitude: number
  longitude: number
  altitude_m: number | null
  segment: number
  estimated?: boolean
}
export type ActivityTrack = {
  distanceM: number
  estimatedDistanceM: number
  ascentM: number | null
  descentM: number | null
  movingMs: number
  samples: number
  last: ActivityPosition | null
  gap: ActivityPosition | null
  sample: ActivityPosition | null
  altitude: ActivityPosition | null
  route: ActivityRoutePoint[]
}
export function emptyActivityTrack(): ActivityTrack
export function addActivityPosition(track: ActivityTrack, point: ActivityPosition, activityType: string): ActivityTrack
export function normalizeActivityRoute(route: ActivityRoutePoint[]): ActivityRoutePoint[]
export function reduceActivityRoute(route: ActivityRoutePoint[]): ActivityRoutePoint[]
export function routeElevation(route: ActivityRoutePoint[]): { ascentM: number | null; descentM: number | null }
