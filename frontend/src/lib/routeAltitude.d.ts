export type RouteAltitudePoint = { altitude_m: number | null; estimated?: boolean }
export type RouteAltitudeRange = { min: number; max: number }

export function routeAltitudeRange(points: RouteAltitudePoint[]): RouteAltitudeRange | null
export function routeAltitudeColor(altitude: number | null, range: RouteAltitudeRange | null): string