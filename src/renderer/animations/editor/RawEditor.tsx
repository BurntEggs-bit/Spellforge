/** The parameter bytes of an event type the template doesn't describe, as hex. */
import { useState, useEffect } from 'react'

export function RawEditor({ raw, onApply }: { raw: string; onApply: (hex: string) => void }) {
  const [text, setText] = useState(raw.replace(/(..)/g, '$1 ').trim())
  useEffect(() => setText(raw.replace(/(..)/g, '$1 ').trim()), [raw])
  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="faint" style={{ fontSize: 12 }}>
        Not in DS Anim Studio’s template: its {raw.length / 2} parameter bytes.
      </div>
      <textarea
        className="mono raw-hex"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      <div className="row">
        <button onClick={() => onApply(text)} disabled={text.replace(/\s/g, '') === raw}>
          Apply bytes
        </button>
      </div>
    </div>
  )
}
