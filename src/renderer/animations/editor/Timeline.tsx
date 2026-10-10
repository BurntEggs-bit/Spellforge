/**
 * An animation's events on a timeline: one lane per event type, bars to
 * select, move and resize, the ruler to scrub, and the playhead following
 * the clock.
 */
import { useRef, useState, useEffect, useMemo } from 'react'
import type { AnimationView, AnimEventView } from '../../../shared/api.ts'
import { useWindowOf, windowOf } from '../../app/windows.ts'
import { clamp } from '../../lib/math.ts'
import type { PlayClock } from '../../viewer/PlayClock.ts'
import { FPS, frameNumber, snapToFrame } from '../../../shared/frames.ts'
import { useLatest } from '../../lib/hooks.ts'
import { isOpen, kindOf, KIND_ORDER } from './events.ts'

const LABEL_W = 170
const ROW_H = 22

/** How a click selects: just this event, toggled in or out (Ctrl), added (Shift), or shown while the selection stays (a drag). */
type SelectMode = 'replace' | 'toggle' | 'add' | 'focus'

export function Timeline({
  clock,
  view,
  selected,
  selection,
  onSelect,
  onSelectMany,
  onTimes,
  onAdd,
  muted,
  mutedTypes,
  colors,
  order,
  onColor,
}: {
  clock: PlayClock
  view: AnimationView
  selected: number | null
  selection: number[]
  onSelect: (i: number | null, mode: SelectMode) => void
  onSelectMany: (indices: number[], focus: number | null) => void
  onTimes: (edits: { index: number; start: number; end: number }[]) => void
  onAdd: (type: number, time: number) => void
  /** Viewer only: events muted or soloed, and types muted everywhere. */
  muted: { mute: number[]; solo: number[] } | null
  mutedTypes: number[]
  /** Event type -> its bars' colour (C). */
  colors: Record<string, string>
  order: LaneOrder
  onColor: (type: number, current?: string) => void
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [zoom, setZoom] = useState<number | null>(null)
  // Bars being dragged: where each is now.
  const [drag, setDrag] = useState<Map<number, { start: number; end: number }> | null>(null)
  // A box being dragged out on the empty timeline (in tl-inner's coordinates).
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const playhead = useRef<HTMLDivElement>(null)

  const shownIn = useWindowOf(wrap)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new (windowOf(el).ResizeObserver)(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [shownIn])

  // One lane per event type, split into rows where its events overlap.
  const lanes = useMemo(() => {
    const byType = new Map<number, AnimEventView[]>()
    for (const e of view.events) {
      const l = byType.get(e.type) ?? []
      l.push(e)
      byType.set(e.type, l)
    }
    const out = [...byType.values()].map((events) => {
      const rows: AnimEventView[][] = []
      const ends: number[] = []
      for (const e of [...events].sort((a, b) => a.start - b.start || a.end - b.end)) {
        let r = ends.findIndex((end) => end <= e.start + 1e-6)
        if (r < 0) {
          r = rows.length
          rows.push([])
          ends.push(0)
        }
        rows[r].push(e)
        ends[r] = Math.max(e.end, e.start + 1e-4)
      }
      return {
        type: events[0].type,
        name: events[0].typeName,
        kind: kindOf(events[0].typeName),
        rows,
        first: Math.min(...events.map((e) => e.start)),
      }
    })
    if (order === 'type') return out.sort((a, b) => a.type - b.type)
    if (order === 'time') return out.sort((a, b) => a.first - b.first || a.type - b.type)
    return out.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.type - b.type)
  }, [view, order])

  const span = Math.max(view.length, 1) * 1.08 + 0.2
  const fit = Math.max(40, (width - LABEL_W - 16) / span)
  const pps = zoom ?? fit
  const trackW = Math.max(width - LABEL_W - 2, span * pps)
  const tickStep = [1, 2, 5, 10, 15, 30, 60, 150, 300].find((f) => (f / FPS) * pps >= 46) ?? 600
  const ticks: number[] = []
  for (let f = 0; f / FPS <= trackW / pps; f += tickStep) ticks.push(f)

  const snap = (t: number, free: boolean) => Math.max(0, free ? t : snapToFrame(t))
  const ppsRef = useLatest(pps)
  const sel = useMemo(() => new Set(selection), [selection])
  const muteSet = useMemo(() => new Set(muted?.mute ?? []), [muted])
  const soloSet = useMemo(() => new Set(muted?.solo ?? []), [muted])
  const typeMuted = useMemo(() => new Set(mutedTypes), [mutedTypes])

  // The playhead follows the clock without re-rendering the timeline; bars
  // under it light up while their event is active.
  useEffect(() => {
    const place = () => {
      if (playhead.current) playhead.current.style.transform = `translateX(${LABEL_W + clock.time * ppsRef.current}px)`
      const root = wrap.current
      if (!root) return
      const t = clock.time
      root.querySelectorAll<HTMLElement>('.tl-bar').forEach((b) => {
        const on = clock.duration > 0 && t >= Number(b.dataset.start) && t <= Number(b.dataset.end)
        if (b.classList.contains('live') !== on) b.classList.toggle('live', on)
      })
    }
    place()
    return clock.subscribe(place)
  }, [clock, ppsRef])
  useEffect(() => {
    if (playhead.current) playhead.current.style.transform = `translateX(${LABEL_W + clock.time * pps}px)`
  }, [pps])

  /** Click or drag on the ruler scrubs (Shift: don't snap to frames). */
  const scrub = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement
    const at = (x: number, free: boolean) => {
      const t = (x - el.getBoundingClientRect().left) / pps
      clock.pauseAt(free ? t : snapToFrame(t))
    }
    at(e.clientX, e.shiftKey)
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    const move = (m: PointerEvent) => at(m.clientX, m.shiftKey)
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  /**
   * A bar pressed: Ctrl toggles it in the selection, Shift adds it; else it's
   * selected (keeping the others if it already was one of several) and can be
   * dragged: in the middle it moves, with every selected event alongside; at
   * an edge (one event) it resizes.
   */
  const startDrag = (e: React.PointerEvent, ev: AnimEventView) => {
    if (e.button !== 0) return
    e.stopPropagation()
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      onSelect(ev.index, e.ctrlKey || e.metaKey ? 'toggle' : 'add')
      return
    }
    const group = sel.has(ev.index) && sel.size > 1 ? [...sel] : [ev.index]
    onSelect(ev.index, group.length > 1 ? 'focus' : 'replace')
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    const edge = 6
    const open = isOpen(ev.end)
    const mode =
      group.length > 1
        ? 'move'
        : e.clientX - rect.left < edge
          ? 'start'
          : !open && rect.right - e.clientX < edge
            ? 'end'
            : 'move'
    const x0 = e.clientX
    let moved = false
    const orig = new Map(group.map((i) => [i, { start: view.events[i].start, end: view.events[i].end }]))
    let cur = new Map(orig)
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* the pointer is already gone */
    }
    const move = (m: PointerEvent) => {
      const dt = (m.clientX - x0) / pps
      if (!moved && Math.abs(m.clientX - x0) < 3) return
      moved = true
      const free = m.altKey
      const next = new Map<number, { start: number; end: number }>()
      if (mode === 'move') {
        // The pressed bar snaps; the others keep their spacing from it, and none goes before 0.
        let delta = snap(ev.start + dt, free) - ev.start
        const earliest = Math.min(...[...orig.values()].map((o) => o.start))
        if (earliest + delta < 0) delta = -earliest
        for (const [i, o] of orig) next.set(i, { start: o.start + delta, end: isOpen(o.end) ? o.end : o.end + delta })
      } else if (mode === 'start')
        next.set(ev.index, { start: Math.min(snap(ev.start + dt, free), ev.end), end: ev.end })
      else next.set(ev.index, { start: ev.start, end: Math.max(snap(ev.end + dt, free), ev.start) })
      cur = next
      setDrag(next)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      setDrag(null)
      if (!moved) return
      const edits = [...cur]
        .filter(([i, t]) => Math.abs(t.start - orig.get(i)!.start) > 1e-6 || Math.abs(t.end - orig.get(i)!.end) > 1e-6)
        .map(([index, t]) => ({ index, start: t.start, end: t.end }))
      if (edits.length) onTimes(edits)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  /**
   * Pressing the empty timeline: a drag selects the events in the box (Ctrl
   * or Shift: added to the selection); a plain click clears the selection.
   */
  const startBox = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return
    const root = inner.current
    if (!root) return
    const r0 = root.getBoundingClientRect()
    const x0 = e.clientX - r0.left
    const y0 = e.clientY - r0.top
    const add = e.ctrlKey || e.metaKey || e.shiftKey
    const el = e.currentTarget as HTMLElement
    let moved = false
    let last = { x0, y0, x1: x0, y1: y0 }
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    const move = (m: PointerEvent) => {
      const r = root.getBoundingClientRect()
      last = { x0, y0, x1: m.clientX - r.left, y1: m.clientY - r.top }
      if (!moved && Math.hypot(last.x1 - x0, last.y1 - y0) < 4) return
      moved = true
      setBox(last)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      setBox(null)
      if (!moved) {
        if (!add) onSelect(null, 'replace')
        return
      }
      const r = root.getBoundingClientRect()
      const left = r.left + Math.min(last.x0, last.x1)
      const right = r.left + Math.max(last.x0, last.x1)
      const top = r.top + Math.min(last.y0, last.y1)
      const bottom = r.top + Math.max(last.y0, last.y1)
      const hit: number[] = []
      root.querySelectorAll<HTMLElement>('.tl-bar').forEach((b) => {
        const br = b.getBoundingClientRect()
        if (br.right >= left && br.left <= right && br.bottom >= top && br.top <= bottom)
          hit.push(Number(b.dataset.index))
      })
      const list = add ? [...new Set([...selection, ...hit])] : hit
      onSelectMany(list, hit[0] ?? selected)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const addAt = (type: number, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    onAdd(type, snap((e.clientX - rect.left) / pps, e.altKey))
  }

  return (
    <div
      className="timeline"
      ref={wrap}
      onWheel={(e) => {
        if (!e.ctrlKey) return
        e.preventDefault()
        setZoom(clamp(pps * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 20, 4000))
      }}
    >
      <div className="tl-inner" ref={inner} style={{ width: LABEL_W + trackW }}>
        <div className="tl-ruler">
          <div className="tl-label tl-corner">
            <button
              className="ghost icon"
              title="Zoom out (Ctrl+wheel)"
              onClick={() => setZoom(clamp(pps / 1.5, 20, 4000))}
            >
              −
            </button>
            <button className="ghost icon" title="Fit" onClick={() => setZoom(null)}>
              fit
            </button>
            <button
              className="ghost icon"
              title="Zoom in (Ctrl+wheel)"
              onClick={() => setZoom(clamp(pps * 1.5, 20, 4000))}
            >
              +
            </button>
          </div>
          <div
            className="tl-track tl-scrub"
            style={{ width: trackW }}
            onPointerDown={scrub}
            title="Click or drag to scrub (Shift: between frames)"
          >
            {ticks.map((f) => (
              <span key={f} className="tl-tick" style={{ left: (f / FPS) * pps }}>
                {f}
              </span>
            ))}
            <span
              className="tl-end"
              style={{ left: view.length * pps }}
              title={`Last event time: frame ${frameNumber(view.length)}`}
            />
          </div>
        </div>
        {lanes.map((lane) => {
          const color = colors[lane.type]
          const laneStyle = color ? ({ ['--kind' as string]: color } as React.CSSProperties) : undefined
          return (
            <div key={lane.type} className={`tl-lane${typeMuted.has(lane.type) ? ' muted-type' : ''}`}>
              <div
                className={`tl-label kind-${lane.kind}`}
                style={laneStyle}
                title={`${lane.name} (type ${lane.type})${typeMuted.has(lane.type) ? '\nMuted in the viewer (4)' : ''}\nC with one selected: its color`}
                onDoubleClick={() => onColor(lane.type, color)}
              >
                <span className="ellipsis">{lane.name}</span>
              </div>
              <div
                className="tl-track"
                style={{ width: trackW, height: lane.rows.length * ROW_H + 4 }}
                onPointerDown={startBox}
                onDoubleClick={(e) => addAt(lane.type, e)}
                onContextMenu={(e) => {
                  // Ctrl+right-click: a new event of this lane's type, here.
                  if (!e.ctrlKey) return
                  e.preventDefault()
                  addAt(lane.type, e)
                }}
              >
                {ticks.map((f) => (
                  <span key={f} className="tl-grid" style={{ left: (f / FPS) * pps }} />
                ))}
                {lane.rows.map((row, r) =>
                  row.map((ev) => {
                    const d = drag?.get(ev.index) ?? ev
                    const open = isOpen(d.end)
                    const end = open ? trackW / pps : d.end
                    const silent =
                      muteSet.has(ev.index) || (soloSet.size > 0 && !soloSet.has(ev.index)) || typeMuted.has(ev.type)
                    return (
                      <div
                        key={ev.index}
                        data-index={ev.index}
                        data-start={ev.start}
                        data-end={ev.end}
                        className={`tl-bar kind-${lane.kind}${sel.has(ev.index) ? ' selected' : ''}${selected === ev.index && sel.size > 1 ? ' primary' : ''}${hover === ev.index ? ' hover' : ''}${open ? ' open' : ''}${silent ? ' muted' : ''}${soloSet.has(ev.index) ? ' solo' : ''}`}
                        style={{
                          left: d.start * pps,
                          width: Math.max(4, (end - d.start) * pps),
                          top: r * ROW_H + 3,
                          ...(laneStyle ?? {}),
                        }}
                        title={`${ev.typeName}\nframes ${frameNumber(d.start)}–${open ? 'end' : frameNumber(d.end)} (${d.start.toFixed(3)}–${open ? 'end' : d.end.toFixed(3) + ' s'})${ev.summary ? '\n' + ev.summary : ''}${silent ? '\nMuted in the viewer' : ''}`}
                        onPointerDown={(e) => startDrag(e, ev)}
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                        onMouseEnter={() => setHover(ev.index)}
                        onMouseLeave={() => setHover(null)}
                      >
                        <span className="ellipsis">{ev.summary || ev.typeName}</span>
                      </div>
                    )
                  }),
                )}
              </div>
            </div>
          )
        })}
        {!lanes.length && <div className="empty">No events.</div>}
        {box && (
          <div
            className="tl-box"
            style={{
              left: Math.min(box.x0, box.x1),
              top: Math.min(box.y0, box.y1),
              width: Math.abs(box.x1 - box.x0),
              height: Math.abs(box.y1 - box.y0),
            }}
          />
        )}
        <div className="tl-playhead" ref={playhead} />
      </div>
    </div>
  )
}

/** How the timeline orders its lanes: by kind of event, by type number, or by when each type first happens. */
export type LaneOrder = 'kind' | 'type' | 'time'
