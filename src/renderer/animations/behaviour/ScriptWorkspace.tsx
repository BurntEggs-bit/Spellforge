/**
 * The Behaviour tab's script editor: scripts of the user's own, appended to
 * the player's behaviour script (c0000.hks) after the game's code and
 * Spellforge's behaviours, checked as they're typed by Spellforge's HKS
 * compiler and its checks of what the game's script expects (main:
 * behaviour:check): errors and warnings underlined in the code, listed with
 * their line and column, and the code compiled (its instructions, as the
 * game will run them).
 *
 * Beside it: Spellforge's part (what the behaviours write), and the game's
 * own script to read, search, and wrap a function of in a script.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BehaviourPreview, HksCheck, HksNames, Recipe } from '../../../shared/api.ts'
import { call } from '../../lib/ipc.ts'
import { MenuButton } from '../../shared/menu.tsx'
import { InActiveWindow } from '../../shared/ui.tsx'
import { plural, randomId } from '../../../shared/format.ts'
import { ModalShell } from '../../shared/Modal.tsx'
import type { NameSets } from './hksHighlight.ts'
import { type CodeEditorHandle, CodeEditor } from './CodeEditor.tsx'

export type CodeRecipe = Extract<Recipe, { kind: 'code' }>

const NEW_SCRIPT = `-- Runs when the game loads the behaviour script, after the game's own code
-- and Spellforge's behaviours: wrap a game function here to change what it does.
-- Insert ▾ has ready pieces; problems show as you type (Ctrl+S saves).

`

const SNIPPETS: { label: string; hint: string; code: string }[] = [
  {
    label: 'If a SpEffect is on',
    hint: 'env(1116, id): one of yours, applied by an AddSpEffect event',
    code: 'if env(1116, 7810000) == TRUE then\n    \nend\n',
  },
  {
    label: 'If the right-hand weapon is of a category',
    hint: 'env(345, hand): the weapon’s special category (spAtkcategory)',
    code: 'if env(345, HAND_RIGHT) == 683 then\n    \nend\n',
  },
  {
    label: 'If an input is pressed',
    hint: 'env(1106, arm): R1 here (the game only reports it where the animation allows it)',
    code: 'if env(1106, ACTION_ARM_R1) == TRUE then\n    \nend\n',
  },
  {
    label: 'If two-handed',
    hint: 'c_Style: the grip, set by the game every frame',
    code: 'if c_Style == HAND_RIGHT_BOTH or c_Style == HAND_LEFT_BOTH then\n    \nend\n',
  },
  {
    label: 'Play a behaviour event',
    hint: 'The whole body: an attack, a skill, a move',
    code: 'ExecEventAllBody("W_AttackRightLight1")\n',
  },
  {
    label: 'Play a half-body event',
    hint: 'Upper and lower body apart, as the game plays its Event_… tables',
    code: 'ExecEventHalfBlend(Event_AttackCrossbowRightEmpty, ALLBODY)\n',
  },
  { label: 'Add a SpEffect', hint: 'act(2002, id)', code: 'act(2002, 7810000)\n' },
  { label: 'Remove a SpEffect', hint: 'act(9001, id)', code: 'act(9001, 7810000)\n' },
]

/** A wrapper around one of the game's functions: your code first, then the game's own. */
function wrapTemplate(name: string, params: string[]): string {
  const list = params.includes('...') ? params.join(', ') : [...params, '...'].join(', ')
  return `-- The game's ${name}, wrapped: this code runs first, then the game's own.
do
    local base = ${name}
    ${name} = function(${list})
        -- Your code here.
        return base(${list})
    end
end
`
}

type View = { kind: 'script'; id: string } | { kind: 'part' } | { kind: 'function'; name: string }

export function ScriptWorkspace({
  preview,
  scripts,
  start,
  onSave,
  onDelete,
  onClose,
}: {
  preview: BehaviourPreview | null
  /** The project's scripts (as saved). */
  scripts: CodeRecipe[]
  /** What to show first: a script, a new one, Spellforge's part, or a game function. */
  start: View | { kind: 'new' }
  onSave: (r: CodeRecipe) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onClose: () => void
}) {
  const [names, setNames] = useState<HksNames | null>(null)
  const nameSets = useMemo<NameSets | null>(
    () =>
      names
        ? {
            functions: new Set(names.functions.map((f) => f.name)),
            constants: new Set(names.constants),
            engine: new Set(names.engine),
          }
        : null,
    [names],
  )
  // Unsaved edits by script id (new ones too).
  const [drafts, setDrafts] = useState<Record<string, CodeRecipe>>({})
  const [view, setView] = useState<View>(() => (start.kind === 'new' ? { kind: 'part' } : start))
  const [check, setCheck] = useState<HksCheck | null>(null)
  const [tab, setTab] = useState<'problems' | 'compiled'>('problems')
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<{ line: number; text: string }[]>([])
  const [fnText, setFnText] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const editor = useRef<CodeEditorHandle | null>(null)

  const newScript = () => {
    const id = randomId()
    const r: CodeRecipe = { id, kind: 'code', title: 'My script', code: NEW_SCRIPT }
    setDrafts((d) => ({ ...d, [id]: r }))
    setView({ kind: 'script', id })
    return r
  }
  const started = useRef(false)
  useEffect(() => {
    call('behaviour:names', undefined)
      .then(setNames)
      .catch(() => {})
    if (start.kind === 'new' && !started.current) {
      started.current = true
      newScript()
    }
  }, [])

  const all: CodeRecipe[] = useMemo(() => {
    const out = scripts.map((s) => drafts[s.id] ?? s)
    for (const d of Object.values(drafts)) if (!scripts.some((s) => s.id === d.id)) out.push(d)
    return out
  }, [scripts, drafts])
  const current = view.kind === 'script' ? (all.find((s) => s.id === view.id) ?? null) : null
  const unsaved = (id: string) =>
    !!drafts[id] && JSON.stringify(drafts[id]) !== JSON.stringify(scripts.find((s) => s.id === id) ?? null)

  // Checked as it's typed (after a pause).
  useEffect(() => {
    if (!current) return setCheck(null)
    let live = true
    const h = setTimeout(() => {
      call('behaviour:check', { code: current.code, id: current.id })
        .then((c) => live && setCheck(c))
        .catch(() => {})
    }, 300)
    return () => {
      live = false
      clearTimeout(h)
    }
  }, [current?.code, current?.id])

  useEffect(() => {
    if (view.kind !== 'function') return setFnText(null)
    call('behaviour:function', { name: view.name })
      .then(setFnText)
      .catch(() => setFnText(null))
  }, [view.kind === 'function' ? view.name : null])
  useEffect(() => {
    const t = q.trim()
    if (t.length < 3) return setHits([])
    // An answer for an older search never replaces a newer one.
    let live = true
    const h = setTimeout(
      () =>
        call('behaviour:search', { query: t })
          .then((r) => live && setHits(r))
          .catch(() => {}),
      200,
    )
    return () => {
      live = false
      clearTimeout(h)
    }
  }, [q])

  const edit = (patch: Partial<CodeRecipe>) => {
    if (!current) return
    setDrafts((d) => ({ ...d, [current.id]: { ...current, ...patch } }))
  }
  const forget = (id: string) =>
    setDrafts((d) => {
      const rest = { ...d }
      delete rest[id]
      return rest
    })
  const save = async () => {
    if (!current) return
    setBusy(true)
    try {
      await onSave(current)
      forget(current.id)
    } finally {
      setBusy(false)
    }
  }
  /** Puts code into the open script (a new one when none is open). */
  const insert = (code: string) => {
    if (current) {
      editor.current?.insert(code)
      return
    }
    const r = newScript()
    setDrafts((d) => ({ ...d, [r.id]: { ...r, code: r.code + code } }))
  }
  const fnList = useMemo(() => {
    const t = q.trim().toLowerCase()
    const list = names?.functions ?? []
    return (t ? list.filter((f) => f.name.toLowerCase().includes(t)) : list).slice(0, 500)
  }, [names, q])
  const errors = check?.problems.filter((p) => p.severity === 'error').length ?? 0
  const warnings = check?.problems.filter((p) => p.severity === 'warning').length ?? 0

  return (
    <InActiveWindow>
      <ModalShell onClose={onClose} className="script-viewer script-workspace" style={{ width: 'min(1280px, 97vw)' }}>
        <header>
          <h2 className="grow">
            Behaviour script <span className="faint">c0000.hks</span>
          </h2>
          <span
            className="faint"
            style={{ fontSize: 12 }}
            title="Spellforge’s HKS compiler checks it as the game compiles a text script"
          >
            HKS, checked as you type
          </span>
          <button
            className="ghost"
            onClick={onClose}
            title="Close (unsaved scripts are kept until you close the project)"
          >
            ✕
          </button>
        </header>
        <div className="body script-body">
          <div className="script-side">
            <div className="script-head">
              <b className="grow">Your scripts</b>
              <button className="ghost icon" onClick={() => newScript()} title="A new script of your own">
                + New
              </button>
            </div>
            <div className="script-list script-mine">
              {all.length === 0 && (
                <div className="faint" style={{ padding: '6px 8px', fontSize: 12 }}>
                  None.
                </div>
              )}
              {all.map((s) => (
                <div
                  key={s.id}
                  className={`list-item${view.kind === 'script' && view.id === s.id ? ' selected' : ''}${s.off ? ' faint' : ''}`}
                  onClick={() => setView({ kind: 'script', id: s.id })}
                >
                  <span className="grow ellipsis">{s.title || 'Untitled'}</span>
                  {unsaved(s.id) && (
                    <span className="unsaved-dot" title="Not saved yet">
                      ●
                    </span>
                  )}
                </div>
              ))}
              <div
                className={`list-item${view.kind === 'part' ? ' selected' : ''}`}
                onClick={() => setView({ kind: 'part' })}
              >
                <span className="grow">Spellforge’s part</span>
                <span className="faint" style={{ fontSize: 11 }}>
                  read only
                </span>
              </div>
            </div>
            <div className="script-head">
              <b className="grow">The game’s script</b>
            </div>
            <input
              placeholder="Function or text (ExecAttack, W_AttackRightSpecial1, 1116…)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="script-list">
              {fnList.map((f) => (
                <div
                  key={f.name}
                  className={`list-item mono${view.kind === 'function' && view.name === f.name ? ' selected' : ''}`}
                  onClick={() => setView({ kind: 'function', name: f.name })}
                >
                  {f.name}
                </div>
              ))}
              {hits.length > 0 && (
                <div className="faint" style={{ padding: '6px 8px', fontSize: 11 }}>
                  Lines with “{q.trim()}”:
                </div>
              )}
              {hits.slice(0, 80).map((h) => (
                <div key={h.line} className="list-item mono script-hit" title={h.text}>
                  <span className="faint">{h.line}</span> {h.text}
                </div>
              ))}
            </div>
          </div>

          <div className="script-main">
            {view.kind === 'script' && current && (
              <>
                <div className="row script-toolbar">
                  <input
                    className="script-title"
                    value={current.title}
                    onChange={(e) => edit({ title: e.target.value })}
                    placeholder="Name"
                  />
                  <label className="row faint" title="Off: kept, left out of the script">
                    <input type="checkbox" checked={!current.off} onChange={(e) => edit({ off: !e.target.checked })} />{' '}
                    on
                  </label>
                  <span className="grow" />
                  <MenuButton
                    label="Insert ▾"
                    className="ghost icon"
                    width={360}
                    items={SNIPPETS.map((s) => ({ label: s.label, hint: s.hint, run: () => insert(s.code) }))}
                  />
                  <button
                    className="ghost icon"
                    onClick={async () => {
                      if (scripts.some((s) => s.id === current.id)) await onDelete(current.id)
                      forget(current.id)
                      setView({ kind: 'part' })
                    }}
                    title="Delete this script"
                  >
                    Delete
                  </button>
                  <button
                    className="primary"
                    disabled={busy || !unsaved(current.id)}
                    onClick={save}
                    title="Keep it in the project’s behaviours (Ctrl+S); the project’s Save writes the script"
                  >
                    Save script
                  </button>
                </div>
                <CodeEditor
                  value={current.code}
                  onChange={(code) => edit({ code })}
                  problems={check?.problems ?? []}
                  names={nameSets}
                  onSave={save}
                  handle={editor}
                  minHeight={300}
                />
                <div className="row script-status">
                  {!check ? (
                    <span className="faint">Checking…</span>
                  ) : check.compiles ? (
                    <span className="ok-text">
                      ✓ Compiles, alone and with the whole script{warnings ? `, ${plural(warnings, 'warning')}` : ''}
                    </span>
                  ) : (
                    <span className="warn-text">
                      ✗ {errors ? plural(errors, 'error') : 'Doesn’t compile with the whole script'}
                      {warnings ? `, ${plural(warnings, 'warning')}` : ''}
                    </span>
                  )}
                  <span className="grow" />
                  {check && <span className="faint">checked in {check.ms} ms</span>}
                  <div className="seg small" role="tablist">
                    <button className={tab === 'problems' ? 'active' : ''} onClick={() => setTab('problems')}>
                      Problems{check?.problems.length ? ` (${check.problems.length})` : ''}
                    </button>
                    <button
                      className={tab === 'compiled' ? 'active' : ''}
                      onClick={() => setTab('compiled')}
                      disabled={!check?.compiled}
                    >
                      Compiled
                    </button>
                  </div>
                </div>
                {tab === 'problems' ? (
                  <div className="script-problems">
                    {check?.whole && <div className="problem p-error">{check.whole}</div>}
                    {check && !check.problems.length && !check.whole && <div className="faint">No problems.</div>}
                    {check?.problems.map((p, i) => (
                      <button
                        key={i}
                        className={`problem p-${p.severity}`}
                        onClick={() => editor.current?.reveal(p.line, p.col)}
                        title="Go to it"
                      >
                        <span className="problem-icon">
                          {p.severity === 'error' ? '✗' : p.severity === 'warning' ? '⚠' : 'ℹ'}
                        </span>
                        <span className="mono problem-at">
                          {p.line}:{p.col}
                        </span>
                        <span className="grow">{p.message}</span>
                        <span className="faint problem-source">
                          {p.source === 'syntax' ? 'syntax' : p.source === 'compile' ? 'compiler' : 'check'}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <pre className="script-code mono script-listing">
                    {check?.compiled
                      ? `${plural(check.compiled.functions, 'function')}, ${check.compiled.instructions} instructions (what the game runs: it compiles the text the same way)\n\n${check.compiled.listing}`
                      : ''}
                  </pre>
                )}
              </>
            )}
            {view.kind === 'part' && (
              <>
                <div
                  className="faint"
                  style={{ fontSize: 12 }}
                  title="Appended to the game’s script for the behaviours and your scripts, made from them on each save: edit those, not this"
                >
                  Generated from the behaviours and your scripts
                  {preview?.error ? (
                    <span className="warn-text">; doesn’t compile: {preview.error}</span>
                  ) : preview ? (
                    <span className="ok-text">, compiles</span>
                  ) : null}
                </div>
                <CodeEditor value={preview?.block ?? ''} names={nameSets} readOnly minHeight={420} />
              </>
            )}
            {view.kind === 'function' && (
              <>
                <div className="row script-toolbar">
                  <b className="mono grow">{view.name}</b>
                  <button
                    className="ghost icon"
                    title="A wrapper around it in your script: your code runs first, then the game’s own (game updates still reach it)"
                    onClick={() => {
                      const f = names?.functions.find((x) => x.name === view.name)
                      insert(wrapTemplate(view.name, f?.params ?? []))
                    }}
                  >
                    Wrap it in my script
                  </button>
                  <button
                    className="ghost icon"
                    title="Its whole code in a new script, to change: it replaces the game’s (game updates no longer reach it)"
                    onClick={() => {
                      const r = newScript()
                      setDrafts((d) => ({
                        ...d,
                        [r.id]: {
                          ...r,
                          title: `My ${view.name}`,
                          code: `-- A copy of the game's ${view.name}: this replaces it.\n${fnText ?? ''}\n`,
                        },
                      }))
                    }}
                    disabled={!fnText}
                  >
                    Copy it into a new script
                  </button>
                </div>
                <CodeEditor value={fnText ?? 'Reading…'} names={nameSets} readOnly minHeight={420} />
              </>
            )}
          </div>
        </div>
      </ModalShell>
    </InActiveWindow>
  )
}
