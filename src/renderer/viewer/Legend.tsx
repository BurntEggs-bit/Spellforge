/** The viewer's legend: what its helper lines mean in game terms. */
import { useState } from 'react'
import { PREF_KEYS, readText, writeText } from '../lib/storage.ts'
import { AXIS_COLORS } from './palette.ts'
import type { HelperPrefs } from './prefs.ts'

/** What the helper lines mean in game terms. */
export function Legend({ helpers }: { helpers: HelperPrefs }) {
  // Closed until asked for (the ? button): the viewer shows the scene, not instructions.
  const [open, setOpenState] = useState(() => readText(PREF_KEYS.axesLegend) === 'open')
  const setOpen = (o: boolean) => {
    setOpenState(o)
    writeText(PREF_KEYS.axesLegend, o ? 'open' : 'closed')
  }
  if (!open)
    return (
      <button className="legend-toggle" onClick={() => setOpen(true)} title="What the lines mean">
        ?
      </button>
    )
  return (
    <div className="legend">
      <div className="legend-head">
        <b>Reading the axes</b>
        <button className="ghost icon" onClick={() => setOpen(false)} title="Hide">
          ✕
        </button>
      </div>
      {helpers.dummyAxes && (
        <>
          <div className="legend-sub">Dummy polys: how Elden Ring uses each point</div>
          <div className="legend-row">
            <i style={{ background: AXIS_COLORS.z }} />
            <span>
              <b>Blue arrow: forward.</b> Bullets fired from this point travel this way, and effects spawned here face
              it. For a forward attack or shot it should point where the character is facing.
            </span>
          </div>
          <div className="legend-row">
            <i style={{ background: AXIS_COLORS.y }} />
            <span>
              <b>Green: up.</b> Effects spawned here stand along it; for upright effects (pillars, flames) it should
              point up.
            </span>
          </div>
          <div className="legend-row">
            <i style={{ background: AXIS_COLORS.x }} />
            <span>
              <b>Red: side</b> (the point's right). Only matters for effects that are wider one way, like slashes and
              arcs.
            </span>
          </div>
        </>
      )}
      {helpers.hkxBones && (
        <div className="legend-row">
          <i style={{ background: helpers.colors.hkx }} />
          <span>
            <b>Bones:</b> red runs along the bone toward the next joint; green and blue are its bend axes.
          </span>
        </div>
      )}
      {helpers.rootTrail && (
        <div className="legend-row">
          <i style={{ background: helpers.colors.root }} />
          <span>
            <b>Facing arrow:</b> the way the character faces (its forward in the game). The faint one marks where the
            animation started; the line is the path root motion moves it.
          </span>
        </div>
      )}
    </div>
  )
}
