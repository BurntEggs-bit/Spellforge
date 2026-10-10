/** The Animations page's viewer panel: its toolbar, the character viewer, and the viewer's side panels. */
import { useRef } from 'react'
import { downloadBytes } from '../lib/files.ts'
import { useUi } from '../shared/ui.tsx'
import { CharacterView } from '../viewer/CharacterView.tsx'
import { withBareHead, fitEquipment } from '../viewer/equipment.ts'
import { EquipmentPanel } from '../viewer/EquipmentPanel.tsx'
import type { ViewportExport } from '../viewer/exportGlb.ts'
import { HelpersPanel } from '../viewer/HelpersPanel.tsx'
import { LightingPanel } from '../viewer/LightingPanel.tsx'
import { Transport } from '../viewer/Transport.tsx'
import { useAnimations } from './pageContext.ts'

export function ViewportDock() {
  const a = useAnimations()
  const ui = useUi()
  const { clipStatus, view, equipment, panel } = a
  const exportRef = useRef<ViewportExport | null>(null)
  const doExport = (what: 'model' | 'skeleton') =>
    ui.run('Exporting', async () => {
      const r = await exportRef.current?.glb(what)
      if (!r) throw new Error('The viewport isn’t ready yet')
      downloadBytes(r.name, r.data, 'model/gltf-binary')
      ui.toast(
        `Exported ${r.name}: the character mirrored to right-handed axes as it shows here, with the animation as one clip.`,
      )
    })
  // Only what this project has: another project's weapon would fail to load (the outfit is saved for every project).
  const shownEquipment = equipment && a.lists ? withBareHead(fitEquipment(equipment, a.lists), a.lists) : null
  return (
    <div className="anim-viewport">
      <Transport
        clock={a.clock}
        clip={clipStatus.clip}
        status={
          clipStatus.loading
            ? 'Loading animation…'
            : clipStatus.error
              ? clipStatus.error
              : clipStatus.clip
                ? a.entireSpell
                  ? `${a.entireSpell.name}: ${a.entireSpell.steps.map((x) => `${x.what} ${x.animation.slice(5)}`).join(' → ')}${a.entireSpell.catalyst ? `, with ${a.entireSpell.catalyst.name}` : ''}`
                  : a.comboPlaying && a.comboResolved
                    ? `Combo: ${a.comboResolved.steps.map((x) => x.animation).join(' → ')} (F8 stops)`
                    : `${clipStatus.clip.hkx} in ${clipStatus.clip.binder.replace(/^chr\//, '')}${clipStatus.clip.root ? ', with root motion' : ''}`
                : view
                  ? ''
                  : 'No animation'
        }
        panel={panel}
        onPanel={a.setPanel}
        focus={a.focus}
        onFocus={a.setFocus}
        onExport={doExport}
        sound={!!a.helpers.sound}
        onSound={(on) => a.setHelpers({ ...a.helpers, sound: on })}
        spells={a.categorySpells}
        entireSpell={a.entireSpell?.name ?? null}
        onEntireSpell={(spell) => (spell === null ? a.stopEntireSpell() : void a.startEntireSpell(spell))}
        gizmo={{ mode: a.gizmoMode, snap: a.gizmoSnap, available: a.gizmoAvailable && !a.sequencePlaying }}
        onGizmo={a.setGizmoMode}
        onGizmoSnap={a.setGizmoSnap}
      />
      <div className="anim-viewport-body">
        {shownEquipment && (
          <CharacterView
            animation={view?.name ?? null}
            clock={a.clock}
            equipment={shownEquipment}
            helpers={a.helpers}
            lighting={a.lighting}
            actions={a.sequencePlaying ? (a.comboActions?.actions ?? []) : a.shownActions}
            effects={a.sequencePlaying ? (a.comboActions?.effects ?? null) : a.effects}
            combo={a.sequencePlaying ? (a.comboResolved?.steps ?? null) : null}
            onCombo={a.setComboStarts}
            exportRef={exportRef}
            buffs={a.buffs}
            focus={a.focus}
            onFocusEnd={() => a.setFocus(null)}
            placements={a.placements}
            onStatus={a.setClipStatus}
            gizmo={a.sequencePlaying ? null : a.gizmo}
            onGizmo={a.onGizmo}
          />
        )}
        {panel === 'equipment' && equipment && (
          <EquipmentPanel
            lists={a.lists}
            value={a.lists ? withBareHead(equipment, a.lists) : equipment}
            onChange={a.setEquipment}
            placements={a.placements}
            onOpenRow={a.onOpenRow}
          />
        )}
        {panel === 'helpers' && <HelpersPanel value={a.helpers} onChange={a.setHelpers} />}
        {panel === 'lighting' && <LightingPanel value={a.lighting} onChange={a.setLighting} />}
      </div>
    </div>
  )
}
