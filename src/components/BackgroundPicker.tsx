import { Contrast, Palette } from 'lucide-react'

export type BackgroundStyle = 'color' | 'mono'

export function BackgroundPicker({ value, onChange }: {
  value: BackgroundStyle
  onChange: (value: BackgroundStyle) => void
}) {
  return (
    <div className="background-picker" role="group" aria-label="Background style">
      <button type="button" aria-pressed={value === 'color'} onClick={() => onChange('color')}>
        <Palette aria-hidden="true" />
        Color
      </button>
      <button type="button" aria-pressed={value === 'mono'} onClick={() => onChange('mono')}>
        <Contrast aria-hidden="true" />
        Black &amp; white
      </button>
    </div>
  )
}
