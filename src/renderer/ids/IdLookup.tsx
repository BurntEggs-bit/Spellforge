/**
 * "What is this ID?": everything a number is in the game, from any page (the
 * top bar) or from a field's line in the Inspector. For an event flag, what
 * it's for, worked out from the game's own files: its community name, its
 * map, every param row that uses it and how, every event script that sets,
 * clears, checks or waits for it, with what those events do, every NPC's
 * dialogue that does. For an entity id, what the maps place with it.
 */
import { createContext, useContext, useEffect, useState } from 'react'
import type { FlagScriptUse, IdLookup, PlacedEntity } from '../../shared/api.ts'
import { call } from '../lib/ipc.ts'
import { PARAM_LABELS } from '../params/paramLabels.ts'
import { GameIcon, InActiveWindow } from '../shared/ui.tsx'
import { errorMessage } from '../../shared/errors.ts'
import { ModalShell } from '../shared/Modal.tsx'

/** Opens the lookup, on an id if given. */
export const IdLookupContext = createContext<(id?: number) => void>(() => {})
export const useIdLookup = () => useContext(IdLookupContext)

const WHAT: Record<FlagScriptUse['what'], string> = {
  set: 'sets',
  clear: 'clears',
  random: 'sets one of',
  wait: 'waits for',
  check: 'checks',
}
const TEXT_LABELS: Record<string, string> = {
  GoodsName: 'Item name',
  WeaponName: 'Weapon name',
  ProtectorName: 'Armor name',
  AccessoryName: 'Talisman name',
  GemName: 'Ash of War name',
  ArtsName: 'Skill name',
  NpcName: 'Character name',
  PlaceName: 'Place name',
  TalkMsg: 'Dialogue line',
  BloodMsg: 'Message',
  ActionButtonText: 'Action button',
  GR_MenuText: 'Menu text',
  EventTextForMap: 'Map event text',
  EventTextForTalk: 'Talk event text',
  TutorialTitle: 'Tutorial title',
  TutorialBody: 'Tutorial text',
  LoadingTitle: 'Loading screen title',
  LoadingText: 'Loading screen text',
}

/** One thing a map places: what it is, where, and a character's NpcParam and dialogue. */
function PlacedLine({
  p,
  openRow,
  lookUp,
}: {
  p: PlacedEntity
  openRow: (param: string, id: number) => void
  lookUp: (id: number) => void
}) {
  return (
    <>
      <b>{p.name}</b>{' '}
      {!p.region && (
        <span className="faint">
          {p.kind}
          {p.model && p.model !== p.name ? `, ${p.model}` : ''}
        </span>
      )}
      , in {p.mapName || p.map}{' '}
      <span className="mono faint">
        ({p.map}, {p.part})
      </span>
      {(p.group || p.npcParam || p.talkId) && (
        <div className="faint">
          {p.group && p.entityId ? <>in the group, as entity {p.entityId}</> : p.group ? 'in the group' : null}
          {p.npcParam && (
            <>
              {p.group ? ', ' : ''}
              <button
                className="link"
                onClick={() => openRow('NpcParam', p.npcParam!)}
                title={`Open NpcParam ${p.npcParam}`}
              >
                NpcParam {p.npcParam}
              </button>
            </>
          )}
          {p.talkId && (
            <>
              , dialogue{' '}
              <button className="link mono" onClick={() => lookUp(p.talkId!)} title="Look up this talk script">
                {p.talkId}
              </button>
            </>
          )}
        </div>
      )}
    </>
  )
}

export function IdLookupDialog({
  initial,
  onClose,
  onOpenRow,
  onOpenEffect,
}: {
  initial?: number
  onClose: () => void
  onOpenRow: (param: string, id: number) => void
  onOpenEffect: (id: number) => void
}) {
  const [query, setQuery] = useState(initial !== undefined ? String(initial) : '')
  const [result, setResult] = useState<IdLookup | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const n = Number(query.trim())
    if (!query.trim() || !Number.isInteger(n)) {
      setResult(null)
      return
    }
    let live = true
    setBusy(true)
    const t = setTimeout(() => {
      call('ids:lookup', { id: n })
        .then((r) => {
          if (!live) return
          setResult(r)
          setError(null)
        })
        .catch((e) => live && setError(errorMessage(e)))
        .finally(() => live && setBusy(false))
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [query])

  const open = (param: string, id: number) => {
    onClose()
    onOpenRow(param, id)
  }
  const lookUp = (id: number) => setQuery(String(id))
  const f = result?.flag
  const empty =
    result &&
    !f &&
    !result.rows.length &&
    !result.texts.length &&
    !result.effect &&
    !result.icons.length &&
    !result.character &&
    !result.talkScript &&
    !result.placed.length

  return (
    <InActiveWindow>
      <ModalShell onClose={onClose} className="id-lookup">
        <header>
          <h2 className="grow">What is this ID?</h2>
        </header>
        <div className="body">
          <div className="row">
            <input
              autoFocus
              className="mono grow"
              placeholder="Any number: an event flag, a row, a text entry, an icon, an effect…"
              value={query}
              onChange={(e) => setQuery(e.target.value.replace(/[^\d-]/g, ''))}
            />
            {busy && <span className="faint">looking…</span>}
          </div>
          {error && <div className="version-note warn">{error}</div>}
          {!result && !busy && (
            <div className="dim">
              Any number: event flags (name, map, the params, event scripts and dialogue that use them), entity ids
              (what the maps place), rows, text, icons and effects.
            </div>
          )}
          {empty && (
            <div className="dim">
              Nothing in the game uses {result.id}: no row, flag, text, icon, effect, dialogue or placed entity has it.
            </div>
          )}

          {f && (
            <section className="lookup-section">
              <h3>Event flag</h3>
              <div className="lookup-summary">{f.summary}</div>
              {f.map && (
                <div className="faint">
                  {f.map.name || f.map.id} <span className="mono">({f.map.id})</span>, its flag {f.map.local}
                </div>
              )}
              {f.params.length > 0 && (
                <>
                  <h4>Params that use it</h4>
                  <ul className="lookup-list">
                    {f.params.slice(0, 40).map((u, i) => (
                      <li key={i}>
                        <button className="link" onClick={() => open(u.param, u.id)} title={`Open ${u.param} ${u.id}`}>
                          {PARAM_LABELS[u.param] ?? u.param} {u.id}
                        </button>{' '}
                        <span className="mono faint">{u.field}</span>
                        <div>{u.role}</div>
                      </li>
                    ))}
                  </ul>
                  {f.params.length > 40 && <div className="faint">… and {f.params.length - 40} more</div>}
                </>
              )}
              {f.scripts.length > 0 && (
                <>
                  <h4>Scripts that use it</h4>
                  <ul className="lookup-list">
                    {f.scripts.slice(0, 40).map((s, i) => (
                      <li key={i}>
                        <b>{WHAT[s.what]}</b>
                        {s.range ? (
                          <span className="faint">
                            {' '}
                            (flags {s.range[0]}–{s.range[1]})
                          </span>
                        ) : null}
                        {s.kind === 'talk' ? (
                          <>
                            , {s.talkName ? <>{s.talkName}’s dialogue</> : 'dialogue'}{' '}
                            <button
                              className="link mono faint"
                              onClick={() => lookUp(s.event)}
                              title="Look up this talk script"
                            >
                              (talk {s.event})
                            </button>
                          </>
                        ) : (
                          <>
                            , event <span className="mono">{s.event}</span>
                            {s.via !== undefined && (
                              <span className="faint">
                                {' '}
                                through event <span className="mono">{s.via}</span>
                              </span>
                            )}
                          </>
                        )}
                        , in {s.mapName || s.file}
                        {s.mapName && <span className="mono faint"> ({s.file})</span>}
                        {s.context && <div className="faint">{s.context}</div>}
                      </li>
                    ))}
                  </ul>
                  {f.scripts.length > 40 && <div className="faint">… and {f.scripts.length - 40} more</div>}
                </>
              )}
              {f.unused && (
                <div className="faint">Nothing in the game’s params, event scripts or dialogue uses it.</div>
              )}
            </section>
          )}

          {result && result.placed.length > 0 && (
            <section className="lookup-section">
              <h3>
                {result.placed.every((p) => p.group) ? 'Entity group: what the maps put in it' : 'Placed in the maps'}
              </h3>
              <ul className="lookup-list">
                {result.placed.slice(0, 40).map((p, i) => (
                  <li key={i}>
                    <PlacedLine p={p} openRow={open} lookUp={lookUp} />
                  </li>
                ))}
              </ul>
              {result.placed.length > 40 && <div className="faint">… and {result.placed.length - 40} more</div>}
            </section>
          )}

          {result && result.rows.length > 0 && (
            <section className="lookup-section">
              <h3>Rows with this ID</h3>
              <ul className="lookup-list">
                {result.rows.map((r) => (
                  <li key={r.param}>
                    <button className="link" onClick={() => open(r.param, r.id)}>
                      {PARAM_LABELS[r.param] ?? r.param}
                    </button>{' '}
                    {r.name || <span className="faint">(no name)</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result && result.icons.length > 0 && (
            <section className="lookup-section">
              <h3>Icons with this ID</h3>
              <div className="row" style={{ gap: 12 }}>
                {result.icons.map((i) => (
                  <span key={i.kind} className="row" style={{ gap: 6 }}>
                    <GameIcon kind={i.kind} id={i.id} size={i.kind === 'Status' ? 32 : 56} />
                    <span className="faint">
                      {i.kind === 'Item' ? 'item' : i.kind === 'Status' ? 'status' : 'map'} icon
                    </span>
                  </span>
                ))}
              </div>
            </section>
          )}

          {result && result.texts.length > 0 && (
            <section className="lookup-section">
              <h3>Text with this ID</h3>
              <ul className="lookup-list">
                {result.texts.slice(0, 30).map((t) => (
                  <li key={t.table}>
                    <span className="faint">{TEXT_LABELS[t.table] ?? t.table}:</span>{' '}
                    {t.text.length > 220 ? t.text.slice(0, 220) + '…' : t.text}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result?.effect && (
            <section className="lookup-section">
              <h3>Effect</h3>
              <div className="row">
                <span className="grow">{result.effect.name}</span>
                <button
                  className="fx-chip"
                  onClick={() => {
                    onClose()
                    onOpenEffect(result.effect!.id)
                  }}
                >
                  ✦ open
                </button>
              </div>
            </section>
          )}

          {result?.character && (
            <section className="lookup-section">
              <h3>Character model</h3>
              <div>
                <span className="mono">{result.character.chr}</span> {result.character.name}
              </div>
            </section>
          )}
          {result?.talkScript && (
            <section className="lookup-section">
              <h3>Talk script</h3>
              <div>
                {result.talkScript.name ?? <span className="faint">(no name)</span>}{' '}
                <span className="faint">
                  — a character’s or object’s dialogue
                  {result.talkScript.file ? `, kept with ${result.talkScript.file}’s talk scripts` : ''}
                </span>
              </div>
              {result.talkScript.speakers.length === 0 && (
                <div className="faint">
                  No map places a character with it: it may be unused, or something other than a map gives it.
                </div>
              )}
              {result.talkScript.speakers.length > 0 && (
                <>
                  <h4>Who the maps give it to</h4>
                  <ul className="lookup-list">
                    {result.talkScript.speakers.slice(0, 20).map((p, i) => (
                      <li key={i}>
                        <PlacedLine p={p} openRow={open} lookUp={lookUp} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
        </div>
        <footer>
          <span
            className="faint grow"
            style={{ fontSize: 12 }}
            title="Everything else is read from the game’s params, event and talk scripts, and maps"
          >
            Names: the community lists Smithbox ships
          </span>
          <button onClick={onClose}>Close</button>
        </footer>
      </ModalShell>
    </InActiveWindow>
  )
}
