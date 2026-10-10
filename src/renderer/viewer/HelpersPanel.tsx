/** The viewer's Helpers panel: DS Anim Studio's overlays, the simulation and root motion. */
import type { HelperPrefs } from './prefs.ts'

export function HelpersPanel({ value, onChange }: { value: HelperPrefs; onChange: (h: HelperPrefs) => void }) {
  const set = (patch: Partial<HelperPrefs>) => onChange({ ...value, ...patch })
  const color = (k: keyof HelperPrefs['colors']) => (
    <input
      type="color"
      value={value.colors[k]}
      title="This color"
      onChange={(e) => onChange({ ...value, colors: { ...value.colors, [k]: e.target.value } })}
    />
  )
  const box = (
    k: keyof Omit<HelperPrefs, 'colors'>,
    label: string,
    c?: keyof HelperPrefs['colors'],
    title?: string,
  ) => (
    <label className="vp-check" title={title}>
      <input
        type="checkbox"
        checked={!!value[k]}
        onChange={(e) => set({ [k]: e.target.checked } as Partial<HelperPrefs>)}
      />
      <span className="grow">{label}</span>
      {c && color(c)}
    </label>
  )
  const slider = (
    k: 'rootScaleXZ' | 'rootScaleY' | 'rootRotation' | 'boneAxisScale' | 'textScale',
    label: string,
    min: number,
    max: number,
    step: number,
    title?: string,
  ) => (
    <label className="vp-check" title={title}>
      <span className="grow">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value[k] ?? 1}
        onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<HelperPrefs>)}
      />
      <span
        className="mono"
        style={{ width: 34 }}
        onDoubleClick={() => set({ [k]: 1 } as Partial<HelperPrefs>)}
        title="Double-click: back to 1"
      >
        {(value[k] ?? 1).toFixed(2).replace(/\.?0+$/, '')}×
      </span>
    </label>
  )
  return (
    <div className="vp-panel vp-helpers">
      <div className="vp-col">
        <div className="vp-head">Master</div>
        {box('all', 'All helpers')}
        {box('text', 'Text labels (IDs, names)')}
        {box('xray', 'X-ray (draw helpers through the model)')}
        {box('legend', 'Legend: what the axes mean in game')}
        <label className="vp-check">
          <span className="grow">Line thickness</span>
          <input
            type="range"
            min={1}
            max={6}
            step={0.5}
            value={value.thickness}
            onChange={(e) => set({ thickness: Number(e.target.value) })}
          />
          <span className="mono" style={{ width: 28 }}>
            {value.thickness}
          </span>
        </label>
        <label className="vp-check">
          <span className="grow">Dummy poly axis size</span>
          <input
            type="range"
            min={0.5}
            max={3}
            step={0.25}
            value={value.axisScale}
            onChange={(e) => set({ axisScale: Number(e.target.value) })}
          />
          <span className="mono" style={{ width: 28 }}>
            {value.axisScale}×
          </span>
        </label>
        {slider('boneAxisScale', 'Bone axis size', 0.25, 4, 0.25)}
        {slider('textScale', 'Label size', 0.75, 2, 0.05)}
        {box('models', 'Models')}
        {box('grid', 'Grid')}
      </div>
      <div className="vp-col">
        <div className="vp-head">Dummy polys</div>
        {box('dummyIds', 'DummyPoly IDs', 'dummy')}
        {box('dummyAxes', 'DummyPoly transforms (X red, Y green, forward blue)')}
        {box('partDummies', 'Include equipment dummy polys (R:/L:/B:… prefixes)')}
        {box(
          'dummyEventIds',
          'Weapon dummy polys as events name them (10000 + n right, 20000 + n left)',
          undefined,
          'The numbers to type into an event’s DummyPolyID to use that point',
        )}
        <div className="vp-head">Bones</div>
        {box('flverBones', 'FLVER bone lines', 'flver')}
        {box('flverNames', 'FLVER bone names')}
        {box('flverAxes', 'FLVER bone transforms')}
        {box('flverBoxes', 'FLVER bone bounding boxes')}
        {box('hkxBones', 'HKX bone transforms', 'hkx')}
        {box('hkxNames', 'HKX bone names')}
        {box('glue', 'Bone glue joints', 'glue')}
        <div className="vp-head">Character</div>
        {box(
          'hitCapsule',
          'Hit capsule (now and at the start)',
          undefined,
          'The character’s collision capsule from NpcParam (hitRadius, hitHeight); the player’s is row 1, Human',
        )}
      </div>
      <div className="vp-col">
        <div className="vp-head">Simulation (during playback)</div>
        {box('simHits', 'Attack hitboxes while active')}
        {box('hitNames', 'Hit shape names (hit slot and attack)')}
        {box(
          'attackReach',
          'Attack reach from where the animation starts',
          undefined,
          'The farthest edge of any hit shape, along the ground, over the whole animation',
        )}
        {box('simBullets', 'Bullets: spawn point, flight and hit size')}
        {box('simEffects', 'Effect (FFX) spawn points')}
        {box('soundMarkers', 'Sounds: where each plays, and its name')}
        {box(
          'sound',
          'Play the sounds',
          undefined,
          'Each sound event plays as playback passes it: one of its sounds, picked as the game does, at its loudness and pitch from the game’s sound bank. No distance, panning or filters; floor and armour sounds play their default material. Wwise’s sounds are converted the way ww2ogg does it (BSD licence, Adam Gashlin; codebooks © Xiph.org).',
        )}
        <label className="vp-check" title="How loud the sounds play">
          <span className="grow">Sound volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={value.soundVolume ?? 0.6}
            onChange={(e) => set({ soundVolume: Number(e.target.value) })}
          />
          <span className="mono" style={{ width: 34 }}>
            {Math.round((value.soundVolume ?? 0.6) * 100)}%
          </span>
        </label>
        {box('simFx', 'Play the real effects (events, bullets, impacts)')}
        {box('bloom', 'Bloom (glow)')}
        <label className="vp-check">
          <span className="grow">Target for homing bullets</span>
          <input
            type="range"
            min={0}
            max={20}
            step={1}
            value={value.targetDistance}
            onChange={(e) => set({ targetDistance: Number(e.target.value) })}
          />
          <span className="mono" style={{ width: 36 }}>
            {value.targetDistance ? `${value.targetDistance} m` : 'off'}
          </span>
        </label>
        {box('simList', 'List of events active now')}
        <div
          className="faint"
          style={{ fontSize: 11 }}
          title="Uses the equipped weapons’ behaviour variations, like the game. Timeline bars light up while active."
        >
          With the equipped weapons’ behaviours
        </div>
        <div className="vp-head">Root motion</div>
        {box('rootMotion', 'Enable root motion')}
        {box('rootTrail', 'Root motion trail and transforms', 'root')}
        {box('followCamera', 'Camera follows root motion')}
        {box('followRotation', 'Camera turns with the character')}
        {slider(
          'rootScaleXZ',
          'Travel along the ground',
          0,
          3,
          0.05,
          'Multiplies root motion along the ground (DS Anim Studio’s multiplier); viewer only',
        )}
        {slider('rootScaleY', 'Travel up and down', 0, 3, 0.05)}
        {slider('rootRotation', 'Turning', 0, 3, 0.05)}
        <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>
          Left drag orbits; right drag pans (Ctrl: forward and back); the wheel zooms (Shift faster, Ctrl slower);
          middle click resets.
        </div>
      </div>
    </div>
  )
}
