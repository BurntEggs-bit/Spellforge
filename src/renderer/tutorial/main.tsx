/**
 * The walkthrough videos' window: the walkthrough, then shorter videos after
 * it (another example of a moveset, recreating Clever's Sacred Arsenal), each with its chapters beside it
 * (click to jump), and where you stopped last time. Opened from the start
 * screen or the top bar; meant to sit on another screen while you follow
 * along (it opens where it was last). Fullscreen (F, or double-click the
 * video) fills that screen; "Keep on top" keeps it over Spellforge on one
 * screen.
 */
import { createRoot } from 'react-dom/client'
import { useEffect, useRef, useState } from 'react'
import { call } from '../lib/ipc.ts'
import { applyTheme } from '../app/theme.ts'
import { WALKTHROUGH_VIDEOS } from '../../shared/videos.ts'
import '../styles/index.css'
import { PREF_KEYS, readText, writeText } from '../lib/storage.ts'
import '../styles/tutorial.css'

const BASE = 'app://spellforge/tutorial/'
const RESUME_KEY = PREF_KEYS.walkthroughAt
const VIDEO_KEY = PREF_KEYS.walkthroughVideo

/** The videos, in order; one whose chapters aren't there isn't in this build. */
const VIDEOS = WALKTHROUGH_VIDEOS

interface Chapter {
  /** Seconds into the video. */
  t: number
  part: number
  title: string
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function Walkthrough() {
  const video = useRef<HTMLVideoElement>(null)
  /** Each video's chapters (null: not in this build); undefined while reading. */
  const [lists, setLists] = useState<(Chapter[] | null)[] | undefined>(undefined)
  const [playing, setPlaying] = useState(0)
  const [now, setNow] = useState(0)
  const [onTop, setOnTop] = useState(false)
  /** A chapter to jump to once the other video is loaded. */
  const pending = useRef<number | null>(null)
  useEffect(() => {
    call('app:walkthroughWindow', {})
      .then((s) => setOnTop(s.onTop))
      .catch(() => {})
  }, [])
  const toggleTop = () =>
    call('app:walkthroughWindow', { onTop: !onTop })
      .then((s) => setOnTop(s.onTop))
      .catch(() => {})
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void video.current?.requestFullscreen()
  }
  // F: fullscreen; Space and the arrows are the video's own.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault()
        fullscreen()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    call('setup:status', undefined)
      .then((s) => s.settings.theme && applyTheme(s.settings.theme))
      .catch(() => {})
    Promise.all(
      VIDEOS.map((v) =>
        fetch(BASE + v.chapters)
          .then((r) => (r.ok ? (r.json() as Promise<Chapter[]>) : null))
          .catch(() => null),
      ),
    ).then((l) => {
      setLists(l)
      // The one watched last, if it's here.
      const last = Number(readText(VIDEO_KEY) ?? 0)
      setPlaying(
        l[last]
          ? last
          : Math.max(
              0,
              l.findIndex((c) => c),
            ),
      )
    })
  }, [])

  const resumeKey = (i: number) => (i === 0 ? RESUME_KEY : `${RESUME_KEY}.${i}`)
  // Pick up where you left off (unless that was the very end), or at the chapter asked for.
  const onLoaded = () => {
    const v = video.current
    if (!v) return
    if (pending.current !== null) {
      v.currentTime = pending.current + 0.05
      pending.current = null
      void v.play()
      return
    }
    const at = Number(readText(resumeKey(playing)) ?? 0)
    if (at > 5 && at < v.duration - 10) v.currentTime = at
  }
  const onTime = () => {
    const v = video.current
    if (!v) return
    setNow(v.currentTime)
    writeText(resumeKey(playing), String(Math.floor(v.currentTime)))
  }
  const jump = (i: number, t: number) => {
    if (i !== playing) {
      // The other video: load it, then jump.
      pending.current = t
      setNow(0)
      setPlaying(i)
      writeText(VIDEO_KEY, String(i))
      return
    }
    const v = video.current
    if (!v) return
    v.currentTime = t + 0.05
    void v.play()
  }
  const chapters = lists?.[playing] ?? null
  const current = chapters ? [...chapters].reverse().find((c) => now >= c.t) : undefined

  if (lists && !lists.some((c) => c))
    return (
      <div className="walk-missing">
        <b>The walkthrough videos aren’t part of this build of Spellforge.</b>
        <span className="dim">
          Release builds include them. Building it yourself, put the videos and their chapter lists in media/tutorial.
        </span>
      </div>
    )

  return (
    <div className="walk">
      <div className="walk-player">
        {lists && (
          <video
            key={playing}
            ref={video}
            src={BASE + VIDEOS[playing].file}
            controls
            preload="metadata"
            onLoadedMetadata={onLoaded}
            onTimeUpdate={onTime}
            onDoubleClick={fullscreen}
          />
        )}
      </div>
      <nav className="walk-chapters">
        <div className="walk-head">
          <b>{VIDEOS[playing].title}</b>
          <div className="walk-actions">
            <button
              className="ghost"
              onClick={fullscreen}
              title="Fill the screen it's on (F, or double-click the video; Esc to come back)"
            >
              Fullscreen
            </button>
            <button
              className={`ghost${onTop ? ' active' : ''}`}
              onClick={toggleTop}
              title="Keep this window above Spellforge, for one screen"
            >
              {onTop ? 'Kept on top' : 'Keep on top'}
            </button>
          </div>
        </div>
        {VIDEOS.map((v, i) => {
          const list = lists?.[i]
          if (!list) return null
          return (
            <div key={v.file} className="walk-video">
              {lists.filter((c) => c).length > 1 && (
                <div className={`walk-video-title${i === playing ? ' active' : ''}`}>{v.title}</div>
              )}
              {list.map((c) => (
                <button
                  key={c.part}
                  className={`walk-chapter${i === playing && current?.part === c.part ? ' active' : ''}`}
                  onClick={() => jump(i, c.t)}
                >
                  <span className="mono faint">{clock(c.t)}</span>
                  <span>
                    <span className="faint">Part {c.part}</span> {c.title}
                  </span>
                </button>
              ))}
            </div>
          )
        })}
      </nav>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Walkthrough />)
