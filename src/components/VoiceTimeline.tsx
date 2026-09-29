import type { CSSProperties } from 'react'
import { getRemovedVoiceSegments, type VoiceSegment } from '@/voice-segments'

type VoiceTimelineProps = {
  title: string
  subtitle: string
  duration: number
  levels: number[]
  segments: VoiceSegment[]
  currentTime: number
  onSeek: (seconds: number) => void
  pending?: boolean
  original?: { levels: number[]; segments: VoiceSegment[] }
}

const formatTime = (seconds: number) => {
  const time = Math.max(0, Math.floor(seconds))
  return `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`
}

export function VoiceTimeline({ title, subtitle, duration, levels, segments, currentTime, onSeek, pending = false, original }: VoiceTimelineProps) {
  if (!duration) return <div className="rounded-xl border bg-muted/20 px-4 py-4 text-sm text-muted-foreground">{title} will appear after the audio is analyzed.</div>

  const waiting = pending || !levels.length
  const removed = original && !waiting ? getRemovedVoiceSegments(original.segments, segments) : []
  const contains = (regions: VoiceSegment[], time: number) => regions.some(region => time >= region.start && time < region.end)
  const summary = original
    ? `${removed.length} removed · ${segments.length} remaining`
    : `${segments.length} detected region${segments.length === 1 ? '' : 's'}`
  const regions = [
    ...segments.map(segment => ({ ...segment, kind: original ? 'remaining' : 'detected' })),
    ...removed.map(segment => ({ ...segment, kind: 'removed' })),
  ]

  return <section className="rounded-xl border bg-muted/20 p-3" aria-label={title}>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
      <div><span className="font-medium">{title}</span><span className="ml-2 text-xs text-muted-foreground">{waiting ? subtitle : `${summary} · ${subtitle}`}</span></div>
      {!waiting && <span className="tabular-nums text-muted-foreground">{formatTime(currentTime)} / {formatTime(duration)}</span>}
    </div>
    {original && <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground" aria-label="Timeline legend">
      <li className="flex items-center gap-2"><span className="voice-key-removed h-2.5 w-5 rounded-sm" aria-hidden="true" />Voice removed</li>
      <li className="flex items-center gap-2"><span className="voice-key-remaining h-2.5 w-5 rounded-sm" aria-hidden="true" />Voice remaining</li>
    </ul>}
    {waiting ? <div className="h-20 animate-pulse rounded-md bg-muted" /> : <>
      <div className="relative h-20 cursor-pointer overflow-hidden rounded-md border bg-background" onClick={event => {
        const bounds = event.currentTarget.getBoundingClientRect()
        onSeek(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * duration)
      }}>
        <div className="absolute inset-0 flex items-center px-1" style={{ columnGap: `min(1px, ${30 / levels.length}%)` }} aria-hidden="true">
          {levels.map((level, index) => {
            const time = index / levels.length * duration
            const remaining = contains(segments, time)
            const takenOut = contains(removed, time)
            const kind = remaining ? (original ? 'remaining' : 'detected') : takenOut ? 'removed' : 'silent'
            const originalIndex = original ? Math.min(original.levels.length - 1, Math.floor(index / levels.length * original.levels.length)) : 0
            const height = remaining || takenOut ? Math.max(10, Math.round((takenOut ? original?.levels[originalIndex] || 0 : level) * 82)) : 3
            return <span key={index} className={`voice-timeline-bar ${kind === 'detected' ? 'bg-primary' : kind === 'silent' && !original ? 'bg-muted-foreground/20' : ''}`}
              data-voice={kind}
              style={{ height: `${height}%`, flex: '1 1 0', minWidth: 0, borderRadius: 2, '--voice-hue': index / levels.length * 360 } as CSSProperties} />
          })}
        </div>
        {regions.map((region, index) => {
          const label = region.kind === 'removed' ? 'Voice removed' : region.kind === 'remaining' ? 'Voice remaining' : 'Voice'
          return <button key={index} type="button"
            aria-label={`${label} ${formatTime(region.start)} to ${formatTime(region.end)}`}
            title={`${label}: ${formatTime(region.start)}–${formatTime(region.end)}`}
            className={`voice-timeline-region absolute inset-y-0 border-x ${region.kind === 'detected' ? 'border-primary/30 bg-primary/5 hover:bg-primary/10' : ''}`}
            data-voice={region.kind}
            style={{ left: `${region.start / duration * 100}%`, width: `${Math.max(.15, (region.end - region.start) / duration * 100)}%`, '--voice-hue': region.start / duration * 360 } as CSSProperties}
            onClick={event => { event.stopPropagation(); onSeek(region.start) }} />
        })}
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${Math.min(100, currentTime / duration * 100)}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground"><span>0:00</span><span>{formatTime(duration / 2)}</span><span>{formatTime(duration)}</span></div>
    </>}
  </section>
}
