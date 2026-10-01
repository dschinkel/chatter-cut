export const FOREGROUND_RANGE_STORAGE_KEY = 'chatter-cut:foreground-range:v1'

export function parseSavedForegroundRange(value: string | null): number {
  if (value == null || !value.trim()) return 75
  const range = Number(value)
  return Number.isFinite(range) && range >= 0 && range <= 100 ? Math.round(range) : 75
}
