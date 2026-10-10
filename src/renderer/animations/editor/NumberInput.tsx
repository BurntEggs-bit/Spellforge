/** A number field that commits on Enter or when it loses focus (Escape takes the edit back). */
import { useState, useEffect } from 'react'

export function NumberInput({
  value,
  float,
  narrow,
  onCommit,
}: {
  value: number
  float?: boolean
  narrow?: boolean
  onCommit: (v: number) => void
}) {
  const show = (v: number) => (float ? String(+v.toPrecision(7)) : String(v))
  const [text, setText] = useState(show(value))
  useEffect(() => setText(show(value)), [value])
  const commit = () => {
    const v = Number(text)
    if (text.trim() === '' || !Number.isFinite(v)) {
      setText(show(value))
      return
    }
    if (v !== value) onCommit(float ? v : Math.round(v))
  }
  return (
    <input
      className="mono"
      style={narrow ? { width: 110, flex: 'none' } : undefined}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setText(show(value))
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}
