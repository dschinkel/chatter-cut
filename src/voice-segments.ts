export type VoiceSegment = { start: number; end: number }

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
