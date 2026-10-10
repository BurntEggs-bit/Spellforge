/**
 * The Text page's entry: its text to edit (or the game's to restore), the same
 * id in the related files, and adding an entry.
 */
import { useState, useEffect } from 'react'
import type { TextFileView, TextEntryView } from '../../../shared/api.ts'
import { confirmHere } from '../../app/windows.ts'
import { call } from '../../lib/ipc.ts'
import { PARAM_LABELS } from '../../params/paramLabels.ts'
import { fileKey, STATE_LABEL } from '../labels.ts'
import { useText } from '../pageContext.ts'

export function EntryPanel() {
  const t = useText()
  const { current, entry } = t
  return (
    <div className="panel">
      <div className="panel-body">
        {current && (
          <AddEntry
            onAdd={(id, text) =>
              t.set(current.rel, current.file, id, text).then((ok) => {
                if (!ok) return
                t.setQuery(String(id))
                t.select(id)
              })
            }
          />
        )}
        {!current && (
          <div
            className="empty"
            title="With the DLC installed the game reads the _dlc02 text files, which hold the base game’s text too: Spellforge edits those and saves your copy into the project."
          >
            No entry selected.
          </div>
        )}
        {current && entry && (
          <EntryEditor
            key={`${fileKey(current)}|${entry.id}|${t.version}`}
            file={current}
            entry={entry}
            files={t.files}
            base={t.base?.version}
            onSet={(rel, file, id, text) => t.set(rel, file, id, text)}
            onOpenRow={t.onOpenRow}
            onOpenFile={t.open}
          />
        )}
      </div>
    </div>
  )
}

function AddEntry({ onAdd }: { onAdd: (id: number, text: string) => void }) {
  const [open, setOpen] = useState(false)
  const [id, setId] = useState('')
  const [text, setText] = useState('')
  if (!open)
    return (
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="ghost" onClick={() => setOpen(true)}>
          + Add entry
        </button>
      </div>
    )
  return (
    <section className="section">
      <header>
        <h3>New entry</h3>
      </header>
      <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label className="row">
          <span style={{ width: 40 }}>Id</span>
          <input
            className="mono"
            value={id}
            onChange={(e) => setId(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="e.g. the weapon’s row id"
          />
        </label>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Text" />
        <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
          <button onClick={() => setOpen(false)}>Cancel</button>
          <button
            className="primary"
            disabled={!id}
            onClick={() => {
              onAdd(Number(id), text)
              setOpen(false)
              setId('')
              setText('')
            }}
          >
            Add
          </button>
        </div>
      </div>
    </section>
  )
}

function EntryEditor({
  file,
  entry,
  files,
  base,
  onSet,
  onOpenRow,
  onOpenFile,
}: {
  file: TextFileView
  entry: TextEntryView
  files: TextFileView[]
  base?: string
  onSet: (rel: string, file: string, id: number, text: string | null) => Promise<boolean>
  onOpenRow: (param: string, id: number) => void
  onOpenFile: (rel: string, file: string, id: number) => void
}) {
  const [draft, setDraft] = useState(entry.text ?? '')
  const changed = draft !== (entry.text ?? '')
  // The same id in the other tables about the same thing (name / short description / description).
  const related = file.param
    ? files.filter(
        (f) => f.param === file.param && f.rel === file.rel && f.group === file.group && f.file !== file.file,
      )
    : []
  const [relatedText, setRelatedText] = useState<Record<string, string | null>>({})
  useEffect(() => {
    let live = true
    Promise.all(
      related.map((f) =>
        call('text:entries', { rel: f.rel, file: f.file, query: String(entry.id), limit: 50 }).then(
          (r) => [f.file, r.entries.find((e) => e.id === entry.id)?.text ?? null] as const,
        ),
      ),
    ).then((pairs) => live && setRelatedText(Object.fromEntries(pairs)))
    return () => {
      live = false
    }
  }, [file.file, entry.id])

  const state = entry.state
  const original = entry.original ?? null
  return (
    <div className="inspector">
      <div>
        <div className="row">
          <span className="badge kind">{file.title}</span>
          <span className="mono faint">{entry.id}</span>
          {state && (
            <span className={`badge ${STATE_LABEL[state].cls}`} title={STATE_LABEL[state].title}>
              {STATE_LABEL[state].text}
            </span>
          )}
        </div>
        <h2 style={{ overflowWrap: 'anywhere' }}>
          {entry.rowName || (entry.text ?? original ?? '').split('\n')[0] || `Entry ${entry.id}`}
        </h2>
        {file.param && (
          <div className="row" style={{ gap: 6 }}>
            <span className="dim">
              Id {entry.id} is {PARAM_LABELS[file.param] ?? file.param} row {entry.id}
              {entry.rowName ? '' : ' (no such row)'}
            </span>
            {entry.rowName && (
              <button className="ghost" onClick={() => onOpenRow(file.param!, entry.id)}>
                Open row
              </button>
            )}
          </div>
        )}
      </div>

      <section className="section">
        <header>
          <h3>Text</h3>
          <span className="grow" />
          <span className="faint">{draft.length} characters</span>
        </header>
        <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            className="text-edit"
            value={draft}
            rows={Math.min(18, Math.max(3, draft.split('\n').length + 1))}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={entry.text === null ? 'Not in your copy: type to add it' : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                if (changed) onSet(file.rel, file.file, entry.id, draft)
              }
            }}
          />
          <div className="row" style={{ gap: 6 }}>
            <span className="faint grow" style={{ fontSize: 11 }}>
              Ctrl+Enter applies; line breaks show in game
            </span>
            {entry.text !== null && (
              <button
                className="ghost"
                onClick={() => {
                  if (confirmHere(`Delete entry ${entry.id} from ${file.title}?`))
                    onSet(file.rel, file.file, entry.id, null)
                }}
              >
                Delete
              </button>
            )}
            <button disabled={!changed} onClick={() => setDraft(entry.text ?? '')}>
              Revert
            </button>
            <button className="primary" disabled={!changed} onClick={() => onSet(file.rel, file.file, entry.id, draft)}>
              Apply
            </button>
          </div>
        </div>
      </section>

      {(state === 'changed' || state === 'removed' || state === 'outdated') && (
        <section className="section">
          <header>
            <h3>
              {state === 'outdated' ? 'The installed game’s text' : `The game’s original${base ? ` (${base})` : ''}`}
            </h3>
            <span className="grow" />
            <button
              className="ghost"
              onClick={() => onSet(file.rel, file.file, entry.id, original)}
              title={state === 'outdated' ? 'Use the newer text' : 'Undo your change to this entry'}
            >
              {state === 'outdated' ? 'Use this text' : 'Restore original'}
            </button>
          </header>
          <div className="content">
            <div className={original ? 'related-body' : 'faint'}>{original ?? '(none)'}</div>
          </div>
        </section>
      )}

      {related.length > 0 && (
        <section className="section">
          <header>
            <h3>Same id elsewhere</h3>
          </header>
          <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {related.map((f) => (
              <div key={f.file} className="related-text">
                <div className="row">
                  <b className="grow">{f.title}</b>
                  <button className="ghost" onClick={() => onOpenFile(f.rel, f.file, entry.id)}>
                    Edit
                  </button>
                </div>
                <div className={relatedText[f.file] ? 'related-body' : 'faint'}>{relatedText[f.file] ?? '(none)'}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
