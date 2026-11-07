export function weightMovingAverageSeries<T extends { measured_at: string; weight_kg: number }>(
  weights: T[],
): (T & { moving_average_7d_kg: number })[]
export function weightAverageChangeBetweenWeeks(
  weights: { measured_at: string; weight_kg: number }[],
  now?: number | string,
): number | null
