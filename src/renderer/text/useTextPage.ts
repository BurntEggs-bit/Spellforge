/**
 * The Text page's state and what its panels do: the language and its files,
 * the file open and its entries (searched, filtered), the entry picked, a
 * search through every file, and edits saved into the project's copy.
 */
import { useState, useRef, useEffect, useMemo } from 'react'
import type { TextLanguageView, TextFileView, TextEntryFilter, TextEntryView, TextSearchHit } from '../../shared/api.ts'
import { plural } from '../../shared/format.ts'
import { call } from '../lib/ipc.ts'
import { readText, PREF_KEYS, writeText } from '../lib/storage.ts'
import { useUi } from '../shared/ui.tsx'

/** The most entries a file's list shows at once (search to find the rest). */
const LIMIT = 800

/** Where the Text page is (for Back / Forward). */
export interface TextPlace {
  lang: string
  rel: string | null
  file: string | null
  id: number | null
}

export interface TextProps {
  /** A file / entry to show (from elsewhere, or Back / Forward). */
  target: (TextPlace & { seq: number }) | null
  onEdited: () => void
  onOpenRow: (param: string, id: number) => void
  onPlace: (p: TextPlace) => void
}

export function useTextPage({ target, onEdited, onOpenRow, onPlace }: TextProps) {
  const ui = useUi()
  const [languages, setLanguages] = useState<TextLanguageView[]>([])
  const [lang, setLang] = useState(() => readText(PREF_KEYS.textLang) ?? 'engus')
  const [files, setFiles] = useState<TextFileView[]>([])
  const [fileFilter, setFileFilter] = useState('')
  const [current, setCurrent] = useState<TextFileView | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<TextEntryFilter>('all')
  const [entries, setEntries] = useState<TextEntryView[]>([])
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [searchAll, setSearchAll] = useState('')
  const [hits, setHits] = useState<TextSearchHit[] | null>(null)
  const [version, setVersion] = useState(0)
  /** A place to open once the language's files have loaded. */
  const pending = useRef<TextPlace | null>(null)

  useEffect(() => {
    call('text:languages', undefined).then(setLanguages).catch(ui.error)
  }, [ui])
  useEffect(() => {
    writeText(PREF_KEYS.textLang, lang)
    call('text:files', { lang })
      .then((f) => {
        setFiles(f)
        const p = pending.current
        if (p) {
          pending.current = null
          const hit = (p.rel && p.file && f.find((x) => x.rel === p.rel && x.file === p.file)) || null
          setCurrent(hit)
          setQuery(p.id !== null ? String(p.id) : '')
          setSelected(p.id)
          return
        }
        // Keep the same table when switching language (or after an edit).
        setCurrent((c) => (c ? (f.find((x) => x.file === c.file && x.container === c.container) ?? null) : null))
      })
      .catch(ui.error)
  }, [lang, version, ui])

  // Back / Forward, or a link from elsewhere.
  useEffect(() => {
    if (!target) return
    pending.current = target
    if (target.lang && target.lang !== lang) setLang(target.lang)
    else setVersion((v) => v + 1)
  }, [target?.seq])

  useEffect(() => {
    if (!current) return setEntries([])
    let live = true
    const t = window.setTimeout(
      () =>
        call('text:entries', { rel: current.rel, file: current.file, query, limit: LIMIT, filter }).then((r) => {
          if (!live) return
          setEntries(r.entries)
          setTotal(r.total)
        }),
      120,
    )
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [current?.rel, current?.file, query, filter, version])

  useEffect(() => {
    const q = searchAll.trim()
    if (q.length < 2) return setHits(null)
    // An answer for an older search never replaces a newer one.
    let live = true
    const t = window.setTimeout(
      () => call('text:search', { lang, query: q, limit: 300 }).then((r) => live && setHits(r)),
      250,
    )
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [searchAll, lang, version])

  const groups = useMemo(() => {
    const q = fileFilter.trim().toLowerCase()
    const shown = files.filter(
      (f) =>
        (!q || f.title.toLowerCase().includes(q) || f.file.toLowerCase().includes(q)) &&
        (filter === 'all' || (filter === 'edited' ? f.edited > 0 : f.outdated > 0)),
    )
    const out: { label: string; items: TextFileView[] }[] = []
    for (const container of ['item', 'menu'] as const) {
      for (const group of ['Base game', 'DLC 1', 'DLC 2'] as const) {
        const items = shown
          .filter(
            (f) => f.container === container && f.group === group && (f.count > 0 || f.edited > 0 || f.outdated > 0),
          )
          .sort((a, b) => a.title.localeCompare(b.title))
        if (items.length) out.push({ label: `${container === 'item' ? 'Items' : 'Menus & dialogue'}: ${group}`, items })
      }
    }
    return out
  }, [files, fileFilter, filter])

  const open = (rel: string, file: string, id?: number) => {
    const f = files.find((x) => x.rel === rel && x.file === file)
    if (!f) return
    setCurrent(f)
    setQuery(id !== undefined ? String(id) : '')
    setSelected(id ?? null)
    onPlace({ lang, rel, file, id: id ?? null })
  }
  const select = (id: number) => {
    setSelected(id)
    if (current) onPlace({ lang, rel: current.rel, file: current.file, id })
  }

  const set = async (rel: string, file: string, id: number, text: string | null) => {
    const r = await ui.run(text === null ? 'Deleting text' : 'Saving text', () =>
      call('text:set', { rel, file, id, text }),
    )
    if (r === undefined) return false
    setVersion((v) => v + 1)
    onEdited()
    return true
  }

  const updateFromGame = async (only?: TextFileView) => {
    const rels = only ? [only.rel] : [...new Set(files.filter((f) => f.outdated > 0).map((f) => f.rel))]
    const n = await ui.run('Bringing in the game’s newer text', async () => {
      let total = 0
      for (const rel of rels)
        total += (await call('text:updateFromGame', { rel, file: only ? only.file : null })).updated
      return total
    })
    if (n === undefined) return
    ui.toast(
      n
        ? `${plural(n, 'entry', 'entries')} updated from the installed game. Your own edits were kept. Saved into the project when you save.`
        : 'Nothing to update.',
    )
    if (filter === 'outdated') setFilter('all')
    setVersion((v) => v + 1)
    onEdited()
  }

  const entry = selected !== null ? entries.find((e) => e.id === selected) : undefined
  const langName = languages.find((l) => l.code === lang)?.name ?? lang
  const outdated = files.reduce((n, f) => n + f.outdated, 0)
  const editedCount = files.reduce((n, f) => n + f.edited, 0)
  const base = files.find((f) => f.ownCopy && f.base)?.base

  return {
    languages,
    lang,
    setLang,
    langName,
    files,
    fileFilter,
    setFileFilter,
    current,
    query,
    setQuery,
    filter,
    setFilter,
    entries,
    total,
    selected,
    select,
    searchAll,
    setSearchAll,
    hits,
    version,
    groups,
    open,
    set,
    updateFromGame,
    entry,
    outdated,
    editedCount,
    base,
    onOpenRow,
  }
}
