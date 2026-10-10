/** The viewer's Lighting panel: an area's light probes, time of day, exposure, glow, sun and shadows. */
import { useState, useEffect } from 'react'
import type { EnvironmentAreaView } from '../../shared/api.ts'
import { errorMessage } from '../../shared/errors.ts'
import { GlowSlider } from '../fx/GlowSlider.tsx'
import { loadAreas } from '../lib/envlight.ts'
import { type LightingPrefs, DEFAULT_LIGHTING } from './prefs.ts'

export function LightingPanel({ value, onChange }: { value: LightingPrefs; onChange: (l: LightingPrefs) => void }) {
  const [areas, setAreas] = useState<EnvironmentAreaView[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    loadAreas()
      .then(setAreas)
      .catch((e) => setError(errorMessage(e)))
  }, [])
  const area = areas.find((a) => a.id === value.area) ?? areas[0]
  const set = (patch: Partial<LightingPrefs>) => onChange({ ...value, ...patch })
  return (
    <div className="vp-panel">
      <div className="vp-head">In-game lighting (the area’s own light probes)</div>
      {error && <div className="error">{error}</div>}
      <div className="vp-slot" style={{ gridTemplateColumns: '96px 1fr' }}>
        <span className="dim">Area</span>
        <select value={area?.id ?? ''} onChange={(e) => set({ area: e.target.value, probe: 0 })}>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {area && area.times.length > 0 && (
          <>
            <span className="dim">Time of day</span>
            <select value={value.time} onChange={(e) => set({ time: Number(e.target.value) })}>
              {area.times.map((t) => (
                <option key={t.index} value={t.index}>
                  {t.label}
                </option>
              ))}
            </select>
          </>
        )}
        <span className="dim" title="Different spots in the area light differently">
          Probe spot
        </span>
        <span className="row">
          <button className="ghost icon" disabled={value.probe <= 0} onClick={() => set({ probe: value.probe - 1 })}>
            −
          </button>
          <span className="mono">{value.probe + 1}</span>
          <button className="ghost icon" onClick={() => set({ probe: value.probe + 1 })}>
            +
          </button>
        </span>
        <span className="dim">Exposure</span>
        <span className="row">
          <input
            type="range"
            min={-3}
            max={3}
            step={0.1}
            value={value.ev}
            onChange={(e) => set({ ev: Number(e.target.value) })}
            className="grow"
          />
          <span className="mono" style={{ width: 44 }}>
            {value.ev > 0 ? '+' : ''}
            {value.ev.toFixed(1)}
          </span>
        </span>
        <span className="dim" title="Brightness of glowing effects (additive). Shared with the effect preview.">
          Effect glow
        </span>
        <span className="row">
          <GlowSlider />
        </span>
        <span className="dim">Sun</span>
        <span className="row">
          <input
            type="range"
            min={0}
            max={3}
            step={0.05}
            value={value.sun}
            onChange={(e) => set({ sun: Number(e.target.value) })}
            className="grow"
          />
          <span className="mono" style={{ width: 44 }}>
            {value.sun.toFixed(2)}
          </span>
        </span>
      </div>
      <label className="vp-check">
        <input type="checkbox" checked={value.shadows} onChange={(e) => set({ shadows: e.target.checked })} />
        Shadows
      </label>
      <label className="vp-check">
        <input type="checkbox" checked={value.backdrop} onChange={(e) => set({ backdrop: e.target.checked })} />
        Show the area behind the character (blurred)
      </label>
      <button className="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => onChange(DEFAULT_LIGHTING)}>
        Reset lighting
      </button>
    </div>
  )
}
