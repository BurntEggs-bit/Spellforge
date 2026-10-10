/** The viewer's toolbar: playback, speed and looping, sound, framing a weapon, its panels and export. */
import { useState, useEffect } from 'react'
import type { ClipView } from '../../shared/api.ts'
import {
  IconToStart,
  IconStepBack,
  IconPause,
  IconPlay,
  IconStepForward,
  IconToEnd,
  IconLoop,
  IconOnce,
  IconSound,
  IconMute,
  IconSpark,
  IconTarget,
  IconHelm,
  IconSun,
  IconAxes,
  IconMove,
  IconRotate,
  IconMagnet,
} from '../shared/icons.tsx'
import { MenuButton } from '../shared/menu.tsx'
import { ENTIRE_SPELL_TIP } from '../shared/spell.ts'
import type { PlayClock } from './PlayClock.ts'

export type ViewportPanel = 'equipment' | 'helpers' | 'lighting' | null

/** A held weapon the camera frames and follows, or none (the whole character). */
export type WeaponFocus = 'right' | 'left' | null

export function Transport({
  clock,
  clip,
  status,
  panel,
  onPanel,
  focus,
  onFocus,
  onExport,
  sound,
  onSound,
  spells,
  entireSpell,
  onEntireSpell,
  gizmo,
  onGizmo,
  onGizmoSnap,
}: {
  /** The move / rotate tool on the selected effect event: its mode, snapping, and whether an effect event is selected. */
  gizmo?: { mode: 'translate' | 'rotate' | null; snap: boolean; available: boolean }
  onGizmo?: (mode: 'translate' | 'rotate' | null) => void
  onGizmoSnap?: (snap: boolean) => void
  /** Sound events play during playback; the toggle beside Loop. */
  sound?: boolean
  onSound?: (on: boolean) => void
  /** Entire spell: the spells cast with this category's animations, the one playing (its name), and starting or stopping one. */
  spells?: { id: number; name: string }[]
  entireSpell?: string | null
  onEntireSpell?: (spell: number | null) => void
  clock: PlayClock
  clip: ClipView | null
  status: string
  panel: ViewportPanel
  onPanel: (p: ViewportPanel) => void
  focus: WeaponFocus
  onFocus: (f: WeaponFocus) => void
  /** Export the character and animation (.glb). */
  onExport?: (what: 'model' | 'skeleton') => void
}) {
  const [, force] = useState(0)
  useEffect(() => clock.subscribe(() => force((n) => (n + 1) & 0xffff)), [clock])
  const frame = clock.time / clock.frameDuration
  const total = clip ? clip.frames - 1 : 0
  return (
    <div className="vp-bar">
      <button className="ghost icon" title="Start (Home)" onClick={() => clock.set(0)}>
        <IconToStart size={15} />
      </button>
      <button className="ghost icon" title="Previous frame (←)" onClick={() => clock.step(-1)}>
        <IconStepBack size={15} />
      </button>
      <button
        className={`icon vp-play${clock.playing ? ' playing' : ''}`}
        title="Play / pause (Space)"
        onClick={() => clock.toggle()}
        disabled={!clip}
      >
        {clock.playing ? <IconPause size={15} /> : <IconPlay size={15} />}
      </button>
      <button className="ghost icon" title="Next frame (→)" onClick={() => clock.step(1)}>
        <IconStepForward size={15} />
      </button>
      <button className="ghost icon" title="End (End)" onClick={() => clock.set(clock.duration)}>
        <IconToEnd size={15} />
      </button>
      <span className="mono vp-time" title="Frame / last frame (30 fps), and the time">
        {frame.toFixed(1)} / {total}
        <span className="faint" style={{ marginLeft: 10 }}>
          {clock.time.toFixed(3)} s
        </span>
      </span>
      <select
        className="vp-speed"
        value={clock.speed}
        title="Playback speed"
        onChange={(e) => clock.setSpeed(Number(e.target.value))}
      >
        {[0.1, 0.25, 0.5, 1, 1.5, 2].map((s) => (
          <option key={s} value={s}>
            {s * 100}%
          </option>
        ))}
      </select>
      <button
        className={`ghost icon${clock.loop ? ' on' : ''}`}
        title={clock.loop ? 'Looping (click to play once)' : 'Playing once (click to loop)'}
        onClick={() => clock.setLoop(!clock.loop)}
      >
        {clock.loop ? <IconLoop size={14} /> : <IconOnce size={14} />}
        {clock.loop ? 'Loop' : 'Once'}
      </button>
      {onSound && (
        <button
          className={`ghost icon${sound ? ' on' : ''}`}
          title={sound ? 'Sounds play (click to mute; volume in Helpers)' : 'Muted (click to play the sounds)'}
          onClick={() => onSound(!sound)}
        >
          {sound ? <IconSound size={15} /> : <IconMute size={15} />}
        </button>
      )}
      {gizmo && onGizmo && onGizmoSnap && (
        <>
          <button
            className={`ghost icon${gizmo.mode === 'translate' ? ' on' : ''}`}
            disabled={!gizmo.available}
            onClick={() => onGizmo(gizmo.mode === 'translate' ? null : 'translate')}
            title="Move the selected effect event’s effect: drag the arrows (G)"
          >
            <IconMove size={15} />
          </button>
          <button
            className={`ghost icon${gizmo.mode === 'rotate' ? ' on' : ''}`}
            disabled={!gizmo.available}
            onClick={() => onGizmo(gizmo.mode === 'rotate' ? null : 'rotate')}
            title="Turn the selected effect event’s effect: drag the rings (R)"
          >
            <IconRotate size={15} />
          </button>
          <button
            className={`ghost icon${gizmo.snap ? ' on' : ''}`}
            onClick={() => onGizmoSnap(!gizmo.snap)}
            title={
              gizmo.snap
                ? 'Snapping: moves in 1 cm steps, turns in 15° steps, and an effect let go near a dummy poly moves to it (click to move freely)'
                : 'Moving freely (click to snap: 1 cm and 15° steps, and to a dummy poly let go near one)'
            }
          >
            <IconMagnet size={15} />
          </button>
        </>
      )}
      <span className="grow ellipsis faint vp-status" title={status}>
        {status}
      </span>
      {onEntireSpell &&
        (entireSpell ? (
          <button className="ghost icon on" onClick={() => onEntireSpell(null)} title={`Stop ${entireSpell}`}>
            <IconSpark size={15} />
            Entire spell
          </button>
        ) : spells && spells.length > 1 ? (
          <MenuButton
            label={
              <>
                <IconSpark size={15} />
                Entire spell ▾
              </>
            }
            className="ghost icon"
            title={ENTIRE_SPELL_TIP}
            width={260}
            items={spells.map((s) => ({ label: s.name, run: () => onEntireSpell(s.id) }))}
          />
        ) : spells && spells.length === 1 ? (
          <button
            className="ghost icon"
            onClick={() => onEntireSpell(spells[0].id)}
            title={`${ENTIRE_SPELL_TIP} (${spells[0].name})`}
          >
            <IconSpark size={15} />
            Entire spell
          </button>
        ) : null)}
      <button
        className={`ghost icon${focus ? ' on' : ''}`}
        onClick={() => onFocus(focus ? null : 'right')}
        title={
          focus
            ? 'Back to the whole character (F)'
            : 'Frame the right-hand weapon side-on and follow it, e.g. to see a grease or trail up close (F; Shift+F: left hand)'
        }
      >
        <IconTarget size={15} />
        Weapon
      </button>
      <button
        className={`ghost icon${panel === 'equipment' ? ' on' : ''}`}
        onClick={() => onPanel(panel === 'equipment' ? null : 'equipment')}
        title="Armor and weapons"
      >
        <IconHelm size={15} />
        Equipment
      </button>
      <button
        className={`ghost icon${panel === 'lighting' ? ' on' : ''}`}
        onClick={() => onPanel(panel === 'lighting' ? null : 'lighting')}
        title="In-game lighting"
      >
        <IconSun size={15} />
        Lighting
      </button>
      <button
        className={`ghost icon${panel === 'helpers' ? ' on' : ''}`}
        onClick={() => onPanel(panel === 'helpers' ? null : 'helpers')}
        title="Overlays and simulation"
      >
        <IconAxes size={15} />
        Helpers
      </button>
      {onExport && (
        <MenuButton
          label="⤓"
          className="ghost icon"
          title="Export the character and this animation for Blender and other tools (.glb)"
          width={330}
          items={[
            {
              label: 'Model, skeleton and this animation (.glb)',
              hint: 'Armour and weapons with their textures, skinned; root motion on the character',
              run: () => onExport('model'),
              disabled: !clip,
            },
            {
              label: 'Skeleton and this animation only (.glb)',
              hint: 'Just the bones and the motion, to retarget elsewhere',
              run: () => onExport('skeleton'),
              disabled: !clip,
            },
          ]}
        />
      )}
    </div>
  )
}
