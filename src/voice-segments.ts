export type VoiceSegment = { start: number; end: number }

export function getVoiceComparisonLevels(remaining: number[], original: number[]) {
  return remaining.map((level, index) => {
    const before = original[Math.min(original.length - 1, Math.floor(index / remaining.length * original.length))] || 0
    return { remaining: Math.max(0, level), original: before, removed: Math.max(0, before - level) }
  })
}

export function getVocalEnergyReduction(original: number[], remaining: number[]): number | null {
  if (!original.length || !remaining.length) return null
  const energy = (levels: number[]) => levels.reduce((sum, value) => sum + value * value, 0) / levels.length
  const before = energy(original)
  if (!before) return null
  return Math.round(Math.max(0, Math.min(100, (1 - energy(remaining) / before) * 100)))
}

function mergeSegments(segments: VoiceSegment[]): VoiceSegment[] {
  const sorted = segments.filter(segment => segment.end > segment.start)
    .map(segment => ({ ...segment }))
    .sort((left, right) => left.start - right.start)
  const merged: VoiceSegment[] = []
  for (const segment of sorted) {
    const previous = merged.at(-1)
    if (previous && segment.start <= previous.end) previous.end = Math.max(previous.end, segment.end)
    else merged.push(segment)
  }
  return merged
}

export function getRemovedVoiceSegments(original: VoiceSegment[], remaining: VoiceSegment[]): VoiceSegment[] {
  const removed: VoiceSegment[] = []
  const kept = mergeSegments(remaining)
  for (const segment of mergeSegments(original)) {
    let start = segment.start
    for (const retained of kept) {
      if (retained.end <= start) continue
      if (retained.start >= segment.end) break
      if (retained.start > start) removed.push({ start, end: retained.start })
      start = Math.max(start, retained.end)
      if (start >= segment.end) break
    }
    if (start < segment.end) removed.push({ start, end: segment.end })
  }
  return removed
}
