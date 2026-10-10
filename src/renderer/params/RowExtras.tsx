/**
 * Parts of a row's Inspector for some params: a weapon's attack at each
 * upgrade level (at stats you type), and where the player gets an item.
 */
import { useEffect, useState } from 'react'
import type { WeaponLevelsView, WhereToGetView } from '../../shared/api.ts'
import { call } from '../lib/ipc.ts'

const STAT_LABELS = ['Str', 'Dex', 'Int', 'Fai', 'Arc']
const DAMAGE_LABELS = ['Physical', 'Magic', 'Fire', 'Lightning', 'Holy']

/** Items the player can get: the params "Where to get it" reads. */
export const ITEM_PARAMS = new Set([
  'EquipParamWeapon',
  'EquipParamGoods',
  'EquipParamProtector',
  'EquipParamAccessory',
  'EquipParamGem',
])

/** The menu's scaling letter for a percent (S 175 and up … E). */
function letter(p: number): string {
  return p >= 175 ? 'S' : p >= 140 ? 'A' : p >= 90 ? 'B' : p >= 60 ? 'C' : p >= 25 ? 'D' : p > 0 ? 'E' : '–'
}

/** A weapon's attack at each upgrade level, at the stats typed (its requirements to start). */
export function WeaponLevelsSection({ id, version }: { id: number; version: number }) {
  const [stats, setStats] = useState<number[] | null>(null)
  const [view, setView] = useState<{ id: number; v: WeaponLevelsView } | null>(null)
  useEffect(() => {
    let live = true
    call('weapon:levels', { id, stats: stats ?? [40, 40, 40, 40, 40] })
      .then((v) => {
        if (!live) return
        setView({ id, v })
        // First look: each stat at its requirement, or 40 when it's lower.
        if (!stats) setStats(v.requirements.map((r) => Math.max(r, 40)))
      })
      .catch(() => live && setView(null))
    return () => {
      live = false
    }
  }, [id, version, stats])
  const v = view?.id === id ? view.v : null
  if (!v || !v.levels.length) return null
  const shown = stats ?? [40, 40, 40, 40, 40]
  const used = [0, 1, 2, 3, 4].filter((d) => v.levels.some((l) => l.base[d] > 0))
  return (
    <section className="section">
      <header>
        <h3>Attack at each level</h3>
        <span className="faint">+0 to +{v.levels.length - 1}</span>
      </header>
      <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {STAT_LABELS.map((s, k) => (
            <label key={s} className="row" style={{ gap: 4 }} title={`Requirement ${v.requirements[k]}`}>
              <span className={shown[k] < v.requirements[k] ? 'warn' : 'dim'}>{s}</span>
              <input
                className="mono"
                style={{ width: 44 }}
                value={shown[k]}
                onChange={(e) => {
                  const n = Math.max(1, Math.min(99, Number(e.target.value.replace(/\D/g, '')) || 1))
                  setStats(shown.map((x, i) => (i === k ? n : x)))
                }}
              />
            </label>
          ))}
        </div>
        <table className="plan">
          <thead>
            <tr>
              <th>Level</th>
              {used.map((d) => (
                <th key={d}>{DAMAGE_LABELS[d]}</th>
              ))}
              <th>Total</th>
              <th title="Strength, dexterity, intelligence, faith, arcane">Scaling</th>
            </tr>
          </thead>
          <tbody>
            {v.levels.map((l) => (
              <tr key={l.level}>
                <td className="mono">+{l.level}</td>
                {used.map((d) => (
                  <td key={d} className="mono" title={`Base ${l.base[d]}`}>
                    {l.attack[d]}
                  </td>
                ))}
                <td className="mono">
                  <b>{l.total}</b>
                </td>
                <td className="mono">
                  {l.scaling.map((p, k) => (
                    <span key={k} title={`${STAT_LABELS[k]} ${p}%`} style={{ marginRight: 6 }}>
                      {letter(p)}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="field-hint">
          As the menu works it out: base × the level’s rate, plus each stat’s scaling by its curve; a stat below its
          requirement takes 40% off the damage it scales. In-game numbers are the game’s to confirm.
        </div>
      </div>
    </section>
  )
}

/** Where the player gets an item: lots (and who gives them) and shops. */
export function WhereToGetSection({
  param,
  id,
  version,
  onOpenRow,
}: {
  param: string
  id: number
  version: number
  onOpenRow: (param: string, id: number) => void
}) {
  const [got, setGot] = useState<{ key: string; v: WhereToGetView } | null>(null)
  const key = `${param}:${id}`
  useEffect(() => {
    let live = true
    call('item:whereToGet', { param, id })
      .then((v) => live && setGot({ key, v }))
      .catch(() => live && setGot(null))
    return () => {
      live = false
    }
  }, [param, id, version, key])
  const v = got?.key === key ? got.v : null
  if (!v) return null
  return (
    <section className="section">
      <header>
        <h3>Where to get it</h3>
        <span className="faint">{v.lots.length + v.shops.length || ''}</span>
      </header>
      <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
        {!v.lots.length && !v.shops.length && (
          <div className="faint">
            No item lot or shop gives it: a new item needs one (an item lot an event gives, or a shop row).
          </div>
        )}
        {v.lots.map((l) => (
          <div key={`${l.param}:${l.id}`} className="row" style={{ flexWrap: 'wrap' }}>
            <button className="ref-link" onClick={() => onOpenRow(l.param, l.id)}>
              {l.param === 'ItemLotParam_enemy' ? 'Enemy lot' : 'Item lot'} {l.id}
            </button>
            <span className="dim">
              {l.count > 1 ? `×${l.count}` : ''}
              {l.once ? ' once' : ''}
              {l.givenBy.length ? `, ${l.givenBy.join('; ')}` : l.name ? `, ${l.name}` : ''}
            </span>
          </div>
        ))}
        {v.shops.map((s) => (
          <div key={`${s.param}:${s.id}`} className="row" style={{ flexWrap: 'wrap' }}>
            <button className="ref-link" onClick={() => onOpenRow(s.param, s.id)}>
              Shop row {s.id}
            </button>
            <span className="dim">
              {s.price > 0 ? `${s.price} runes` : 'free'}
              {s.by ? `, sold by ${s.by}` : s.param === 'ShopLineupParam' ? ', in no shop’s range' : ''}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
