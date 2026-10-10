/** The Enemies page's moves, bullets and effects of the character picked. */
import type { EnemyMove } from '../../../shared/api.ts'
import { useEnemies } from '../pageContext.ts'
import { plainName } from '../names.ts'
import { plural } from '../../../shared/format.ts'

export function MovesPanel() {
  const p = useEnemies()
  const { view } = p
  if (!view)
    return (
      <div className="panel">
        <div className="empty">No character selected.</div>
      </div>
    )
  const q = p.moveQuery.trim().toLowerCase()
  const moves = view.moves.filter(
    (m) => (!p.onlyActions || m.kind !== 'other') && (!q || m.name.includes(q) || m.summary.toLowerCase().includes(q)),
  )
  const effects = new Map<number, EnemyMove['effects'][number] & { moves: number }>()
  for (const m of view.moves)
    for (const e of m.effects) {
      const hit = effects.get(e.id)
      if (hit) hit.moves++
      else effects.set(e.id, { ...e, moves: 1 })
    }
  const variations = [...new Set(view.npcs.map((n) => n.variation).filter((v) => v > 0))]
  const spell = view.spells.find((s) => s.bullet === p.spell) ?? null
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="row">
          <b className="grow ellipsis">{view.name}</b>
          <span className="id">{view.chr}</span>
        </div>
        {variations.length > 1 && (
          <label
            className="row dim"
            style={{ fontSize: 12, gap: 6 }}
            title="Which of its NPC rows' behaviors the moves use (phases and variants differ)"
          >
            Behaviors of
            <select value={view.variation} onChange={(e) => p.setVariation(Number(e.target.value))}>
              {variations.map((v) => (
                <option key={v} value={v}>
                  {view.npcs.find((n) => n.variation === v)?.name ?? 'NPC'} ({v})
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="seg small" role="tablist">
          <button className={p.tab === 'moves' ? 'active' : ''} onClick={() => p.setTab('moves')}>
            Moves ({view.moves.filter((m) => m.kind !== 'other').length})
          </button>
          <button className={p.tab === 'spells' ? 'active' : ''} onClick={() => p.setTab('spells')}>
            Bullets ({view.spells.length})
          </button>
          <button className={p.tab === 'effects' ? 'active' : ''} onClick={() => p.setTab('effects')}>
            Effects ({effects.size})
          </button>
        </div>
        {p.tab === 'moves' && (
          <>
            <input placeholder="Search moves" value={p.moveQuery} onChange={(e) => p.setMoveQuery(e.target.value)} />
            <label
              className="row dim"
              style={{ fontSize: 12 }}
              title="Hide animations that neither hit nor fire anything (walking, reactions, idles)"
            >
              <input type="checkbox" checked={p.onlyActions} onChange={(e) => p.setOnlyActions(e.target.checked)} />
              Only moves that hit or fire something
            </label>
          </>
        )}
        {p.tab === 'spells' && spell && (
          <div className="enemy-pick">
            <div>
              <b>{plainName(spell.name) || `Bullet ${spell.bullet}`}</b> <span className="id">{spell.bullet}</span>
            </div>
            <div className="dim" style={{ fontSize: 12 }}>
              {spell.effect
                ? `Effect ${spell.effect}${spell.effectName ? `: ${spell.effectName}` : ''}`
                : 'No effect of its own'}
              {spell.attack ? `, attack ${spell.attack}` : ''}, fired by {plural(spell.moves.length, 'move')}
            </div>
            <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <button className="primary" onClick={() => p.setDialog('spell')}>
                Make it a spell…
              </button>
              <button onClick={() => p.pickMove(spell.moves[0])}>Watch it</button>
              <button onClick={() => p.onOpenRow('Bullet', spell.bullet)}>Open the bullet</button>
            </div>
          </div>
        )}
      </div>
      <div className="panel-body">
        {p.tab === 'moves' &&
          moves.map((m) => (
            <div
              key={m.name}
              className={`list-item enemy-move${p.move === m.name ? ' selected' : ''}`}
              onClick={() => p.pickMove(m.name)}
            >
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span className="mono">{m.name}</span>
                  {m.kind !== 'other' && <span className="badge kind">{m.kind === 'spell' ? 'fires' : 'hits'}</span>}
                  {m.hand && (
                    <span className="faint" style={{ fontSize: 11 }}>
                      {m.hand} hand
                    </span>
                  )}
                </div>
                <div className="faint ellipsis" style={{ fontSize: 11 }}>
                  {m.summary || 'No hits, bullets or effects'}
                </div>
              </div>
            </div>
          ))}
        {p.tab === 'moves' && !moves.length && <div className="empty">No move matches.</div>}
        {p.tab === 'spells' &&
          view.spells.map((s) => (
            <div
              key={s.bullet}
              className={`list-item${p.spell === s.bullet ? ' selected' : ''}`}
              onClick={() => p.setSpell(s.bullet)}
            >
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="ellipsis">{plainName(s.name) || `Bullet ${s.bullet}`}</div>
                <div className="faint ellipsis" style={{ fontSize: 11 }}>
                  {s.effectName || (s.effect ? `effect ${s.effect}` : 'no effect')}, {plural(s.moves.length, 'move')}
                </div>
              </div>
              <span className="id">{s.bullet}</span>
            </div>
          ))}
        {p.tab === 'spells' && !view.spells.length && <div className="empty">{view.name} fires no bullets.</div>}
        {p.tab === 'effects' &&
          [...effects.values()].map((e) => (
            <div
              key={e.id}
              className="list-item"
              onClick={() => p.onOpenEffect(e.id)}
              title="Open it in Params & effects (where it can be copied into the common effects)"
            >
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="ellipsis">{e.name || `Effect ${e.id}`}</div>
                <div className="faint" style={{ fontSize: 11 }}>
                  {e.common ? 'In the common effects' : `${view.name}’s own`}, {plural(e.moves, 'move')}
                </div>
              </div>
              <span className="id">{e.id}</span>
            </div>
          ))}
      </div>
    </div>
  )
}
