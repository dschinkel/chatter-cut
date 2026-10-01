import { useState, type CSSProperties } from 'react'
import { getRemovedVoiceSegments, getVocalEnergyReduction, getVoiceComparisonLevels, type VoiceSegment } from '@/voice-segments'

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
  const [view, setView] = useState<'remaining' | 'removed'>('remaining')
  const [overlayOriginal, setOverlayOriginal] = useState(false)
  if (!duration) return <div className="rounded-xl border bg-muted/20 px-4 py-4 text-sm text-muted-foreground">{title} will appear after the audio is analyzed.</div>

  const waiting = pending || !levels.length
  const removed = original && !waiting ? getRemovedVoiceSegments(original.segments, segments) : []
  const reduction = original && !waiting ? getVocalEnergyReduction(original.levels, levels) : null
  const comparison = original ? getVoiceComparisonLevels(levels, original.levels) : []
  const contains = (regions: VoiceSegment[], time: number) => regions.some(region => time >= region.start && time < region.end)
  const summary = original
    ? `${reduction == null ? `${removed.length} removed` : `${reduction}% detected vocal energy removed`} · ${segments.length} region${segments.length === 1 ? '' : 's'} above detection threshold`
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
    {original && !waiting && <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border p-0.5 text-xs" aria-label="Voice waveform view">
          <button type="button" aria-pressed={view === 'remaining'} onClick={()=>setView('remaining')} className={`rounded px-3 py-1.5 ${view === 'remaining'?'bg-muted text-foreground':'text-muted-foreground'}`}>Remaining voice</button>
          <button type="button" aria-pressed={view === 'removed'} onClick={()=>setView('removed')} className={`rounded px-3 py-1.5 ${view === 'removed'?'bg-muted text-foreground':'text-muted-foreground'}`}>Removed voice</button>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={overlayOriginal} onChange={event=>setOverlayOriginal(event.target.checked)}/>Overlay original</label>
      </div>
      <p className="text-xs text-muted-foreground">{view === 'remaining'?'Solid bars show voice left after processing.':'Colored bars show the reduction in detected voice level.'} Both timelines use the same scale.</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground" aria-label="Timeline legend">
        <li className="flex items-center gap-2"><span className={`${view === 'remaining'?'voice-key-remaining':'voice-key-removed'} h-2.5 w-5 rounded-sm`} aria-hidden="true"/>{view === 'remaining'?'Remaining voice':'Removed voice'}</li>
        <li className="flex items-center gap-2"><span className="voice-key-removed h-0.5 w-5" aria-hidden="true"/>Colored strip marks removed intervals</li>
        {overlayOriginal&&<li className="flex items-center gap-2"><span className="h-2.5 w-5 rounded-sm border border-white/30" aria-hidden="true"/>Original outline</li>}
      </ul>
    </div>}
    {waiting ? <div className="h-20 animate-pulse rounded-md bg-muted" /> : <>
      <div className="relative h-20 cursor-pointer overflow-hidden rounded-md border bg-background" onClick={event => {
        const bounds = event.currentTarget.getBoundingClientRect()
        onSeek(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * duration)
      }}>
        <div className="absolute inset-0 flex items-center px-1" style={{ columnGap: `min(1px, ${30 / levels.length}%)` }} aria-hidden="true">
          {levels.map((level, index) => {
            const time = index / levels.length * duration
            const remaining = contains(segments, time)
            const kind = original ? view : remaining ? 'detected' : 'silent'
            const plotted = original ? comparison[index][view] : level
            const height = Math.min(100, Math.max(0, plotted * 82))
            return <span key={index} className="relative flex h-full items-center justify-center" style={{flex:'1 1 0',minWidth:0}}>
              {original&&overlayOriginal&&<span className="absolute inset-x-0 rounded-sm border border-white/20" style={{height:`${Math.min(100,comparison[index].original*82)}%`}}/>}
              <span className={`voice-timeline-bar relative w-full ${kind === 'detected' ? 'bg-primary' : kind === 'silent' ? 'bg-muted-foreground/20' : ''}`}
                data-voice={kind}
                style={{height:`${height}%`,borderRadius:2,'--voice-hue':index/levels.length*360} as CSSProperties}/>
            </span>
          })}
        </div>
        {regions.map((region, index) => {
          const label = region.kind === 'removed' ? 'Voice removed' : region.kind === 'remaining' ? 'Voice remaining' : 'Voice'
          return <button key={index} type="button"
            aria-label={`${label} ${formatTime(region.start)} to ${formatTime(region.end)}`}
            title={`${label}: ${formatTime(region.start)}–${formatTime(region.end)}`}
            className={`voice-timeline-region absolute border-x ${original?'bottom-0 h-1':'inset-y-0'} ${region.kind === 'detected' ? 'border-primary/30 bg-primary/5 hover:bg-primary/10' : ''}`}
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
