/**
 * The Enemies page's viewer: the move on the character, or fitted to you
 * (mirrored, upright, its travel), and making it a skill.
 */
import type { SimAction } from '../../../shared/api.ts'
import { CharacterView } from '../../viewer/CharacterView.tsx'
import { HelpersPanel } from '../../viewer/HelpersPanel.tsx'
import { LightingPanel } from '../../viewer/LightingPanel.tsx'
import type { EquipPrefs } from '../../viewer/prefs.ts'
import { Transport } from '../../viewer/Transport.tsx'
import { useEnemies } from '../pageContext.ts'

/** On its own character: nothing worn or held, its own model as it is. */
const NO_EQUIPMENT: EquipPrefs = {
  female: false,
  head: null,
  body: null,
  arms: null,
  legs: null,
  right: null,
  left: null,
}

/** Fitted to you: no actions simulated (one array, so the viewer sees no change between renders). */
const NO_ACTIONS: SimAction[] = []

export function ViewerPanel() {
  const p = useEnemies()
  const { clipStatus, view } = p
  const enemyName = view?.name ?? 'them'
  const status = !p.move
    ? 'No move'
    : clipStatus.loading
      ? 'Loading the animation…'
      : clipStatus.error
        ? clipStatus.error
        : clipStatus.clip
          ? `${p.on === 'you' ? `${enemyName}’s ${p.move}, fitted to you` : clipStatus.clip.hkx}, ${clipStatus.clip.duration.toFixed(2)} s${clipStatus.clip.root ? ', with root motion' : ''}`
          : ''
  const equipment = p.on === 'you' ? p.you : NO_EQUIPMENT
  return (
    <div className="anim-viewport">
      <Transport
        clock={p.clock}
        clip={clipStatus.clip}
        status={status}
        panel={p.panel}
        onPanel={(x) => p.setPanel(x === 'equipment' ? null : x)}
        focus={p.focus}
        onFocus={p.setFocus}
        sound={!!p.helpers.sound}
        onSound={(on) => p.setHelpers({ ...p.helpers, sound: on })}
      />
      <div className="enemy-viewer-bar">
        <div className="seg small" role="tablist">
          <button
            className={p.on === 'them' ? 'active' : ''}
            onClick={() => p.setOn('them')}
            title={`Play the move on ${enemyName}, with its hits, bullets and effects`}
          >
            On {enemyName}
          </button>
          <button
            className={p.on === 'you' ? 'active' : ''}
            onClick={() => p.setOn('you')}
            disabled={!p.move}
            title="The move fitted to your character: what a skill made from it looks like"
          >
            On you
          </button>
        </div>
        {p.on === 'you' && (
          <>
            <label
              className="row dim"
              title="Swap left and right: a move made with the left hand, done with your weapon hand"
            >
              <input
                type="checkbox"
                checked={p.fit.mirror}
                onChange={(e) => p.setFit({ ...p.fit, mirror: e.target.checked })}
              />
              Mirror
            </label>
            <label
              className="row dim"
              title={`Keep your spine, neck and head upright instead of stooping like ${enemyName}`}
            >
              <input
                type="checkbox"
                checked={p.fit.upright}
                onChange={(e) => p.setFit({ ...p.fit, upright: e.target.checked })}
              />
              Stand upright
            </label>
            <label className="row dim" title="How far the move carries you">
              Travel
              <select value={p.fit.travel} onChange={(e) => p.setFit({ ...p.fit, travel: Number(e.target.value) })}>
                <option value={1}>for your size</option>
                <option value={1.5}>×1.5</option>
                <option value={2}>×2</option>
              </select>
            </label>
          </>
        )}
        <span className="grow" />
        <button
          className="primary"
          disabled={!p.current || p.current.kind === 'other'}
          onClick={() => p.setDialog('skill')}
          title="Turn this move into a skill of one of your weapons"
        >
          Make it a skill…
        </button>
      </div>
      <div className="anim-viewport-body">
        {p.chr && equipment && (
          <CharacterView
            key={p.on === 'you' ? 'you' : p.chr}
            chr={p.on === 'you' ? 'c0000' : p.chr}
            animation={p.move}
            retarget={p.on === 'you' && p.move ? { chr: p.chr, ...p.fit } : null}
            masks={p.on === 'them' ? p.masks : null}
            clock={p.clock}
            equipment={equipment}
            helpers={p.helpers}
            lighting={p.lighting}
            actions={p.on === 'them' ? p.actions : NO_ACTIONS}
            focus={p.on === 'you' ? p.focus : null}
            onFocusEnd={() => p.setFocus(null)}
            onStatus={p.setClipStatus}
          />
        )}
        {!p.chr && <div className="empty">No move selected.</div>}
        {p.panel === 'helpers' && <HelpersPanel value={p.helpers} onChange={p.setHelpers} />}
        {p.panel === 'lighting' && <LightingPanel value={p.lighting} onChange={p.setLighting} />}
      </div>
    </div>
  )
}
