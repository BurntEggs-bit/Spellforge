/** The Glow slider: the effect preview's and the viewer's Lighting panel's. */
import { useState } from 'react'
import { FX_ADDITIVE_GAIN } from './constants.ts'
import { fxAdditiveGain, setGlow } from './glow.ts'

/**
 * Brightness of glowing (additive) parts, shared with the animation viewport.
 * Game brightness varies by effect, so this lets you match what you see in game.
 */
export function GlowSlider({ width = 70 }: { width?: number }) {
  const [glow, setGlowState] = useState(fxAdditiveGain.value)
  return (
    <label
      className="row"
      title="Brightness of glowing (additive) parts. Raise it if a glow looks dimmer than in game; lower it if glows wash out. Shared with the animation viewport."
    >
      Glow
      <input
        type="range"
        min={0.25}
        max={8}
        step={0.25}
        value={glow}
        onChange={(e) => {
          const v = Number(e.target.value)
          setGlowState(v)
          setGlow(v)
        }}
        onDoubleClick={() => {
          setGlowState(FX_ADDITIVE_GAIN)
          setGlow(FX_ADDITIVE_GAIN)
        }}
        style={{ width }}
      />
      <span className="mono faint">×{glow}</span>
    </label>
  )
}
