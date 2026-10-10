/** Make it a spell: one of the character's bullets as a spell of yours. */
import { useState, useEffect } from 'react'
import type { EnemyView, EnemySpellResult, BrowseRow } from '../../../shared/api.ts'
import { call } from '../../lib/ipc.ts'
import { useUi, InActiveWindow } from '../../shared/ui.tsx'
import { plainName } from '../names.ts'
import { ModalShell } from '../../shared/Modal.tsx'

export function SpellDialog({
  view,
  bullet,
  onClose,
  onDone,
}: {
  view: EnemyView
  bullet: number
  onClose: () => void
  onDone: (r: EnemySpellResult) => void
}) {
  const ui = useUi()
  const spell = view.spells.find((s) => s.bullet === bullet)!
  const [bases, setBases] = useState<BrowseRow[]>([])
  const [base, setBase] = useState<number>(4000)
  useEffect(() => {
    call('browse:list', { kind: 'spells', query: '', onlyProject: false, limit: 500 })
      .then((l) => setBases(l.filter((r) => r.param === 'Magic').sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => {})
  }, [])
  const label = plainName(spell.name) || `Bullet ${bullet}`
  const [name, setName] = useState(`${view.name}’s ${label}`)
  const [description, setDescription] = useState(`${view.name}’s ${label}, learned at last.`)
  const [effectSize, setEffectSize] = useState<'enemy' | 'player'>('enemy')
  const make = async () => {
    const r = await ui.run(`Making ${name}`, () =>
      call('enemy:makeSpell', { chr: view.chr, bullet, baseSpell: base, name, description, effectSize }),
    )
    if (r) onDone(r)
  }
  return (
    <InActiveWindow>
      <ModalShell onClose={onClose} className="enemy-dialog">
        <header>
          <h2 className="grow">
            Make {view.name}’s {label} a spell
          </h2>
        </header>
        <div className="body">
          <div className="dim">
            A copy of one of your spells (its casting, FP cost and requirements) firing {view.name}’s bullet, with its
            effects, attack and sounds brought over.
          </div>
          <div className="form-grid">
            <label>Cast it like</label>
            <select value={base} onChange={(e) => setBase(Number(e.target.value))}>
              {!bases.some((b) => b.id === base) && <option value={base}>Glintstone Pebble (4000)</option>}
              {bases.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.id})
                </option>
              ))}
            </select>
            <label>Spell name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <label>Description</label>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="enemy-options">
            <label className="row">
              <input type="radio" checked={effectSize === 'enemy'} onChange={() => setEffectSize('enemy')} />
              <span>
                {view.name}’s size <span className="faint">(as big as in the fight)</span>
              </span>
            </label>
            <label className="row">
              <input type="radio" checked={effectSize === 'player'} onChange={() => setEffectSize('player')} />
              <span>Your size</span>
            </label>
          </div>
        </div>
        <footer>
          <span className="grow" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!name.trim()} onClick={make}>
            Make the spell
          </button>
        </footer>
      </ModalShell>
    </InActiveWindow>
  )
}
