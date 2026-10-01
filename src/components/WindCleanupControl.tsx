import { useId } from 'react'
import { Wind } from 'lucide-react'

type WindCleanupControlProps = {
  enabled: boolean
  onChange: (enabled: boolean) => void
}

export function WindCleanupControl({ enabled, onChange }: WindCleanupControlProps) {
  const titleId = useId()
  const descriptionId = useId()

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClick={() => onChange(!enabled)}
      className={`w-full cursor-pointer rounded-lg border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${enabled ? 'border-primary bg-primary/10' : 'bg-background/30 hover:border-primary/60 hover:bg-muted/40'}`}
    >
      <span className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-3">
          <Wind className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <span id={titleId} className="text-sm font-semibold">Wind detection &amp; removal</span>
        </span>
        <span className="flex shrink-0 items-center gap-3" aria-hidden="true">
          <span className={`text-sm font-semibold ${enabled ? 'text-primary' : 'text-muted-foreground'}`}>{enabled ? 'On' : 'Off'}</span>
          <span className={`inline-flex h-7 w-12 items-center rounded-full border p-0.5 transition ${enabled ? 'border-primary bg-primary' : 'border-muted-foreground/60 bg-muted'}`}>
            <span className={`h-5 w-5 rounded-full shadow-sm transition-transform ${enabled ? 'translate-x-5 bg-primary-foreground' : 'translate-x-0 bg-foreground'}`} />
          </span>
        </span>
      </span>
      <span id={descriptionId} className="mt-2 block text-xs leading-relaxed text-muted-foreground">
        {enabled ? 'Enabled: detect wind gusts and reduce low-frequency rumble when you process the video.' : 'Click to enable wind detection and reduce low-frequency rumble when you process the video.'}
        {' '}Strong wind or distortion may remain.
      </span>
    </button>
  )
}
