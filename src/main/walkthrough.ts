/**
 * The walkthrough video, in a window of its own: put it on another screen and
 * follow along. Opening it again brings it forward; where it was put (screen,
 * size, kept on top) is remembered for next time.
 */
import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, screen } from 'electron'
import { WALKTHROUGH_VIDEOS } from '../shared/videos.ts'
import { PRELOAD, pageUrl, tutorialDir } from './paths.ts'
import { BACKGROUND, SECURE_WEB_PREFERENCES, confineToPage } from './windows.ts'

interface WalkthroughPlace {
  bounds: { x: number; y: number; width: number; height: number }
  maximized: boolean
  onTop: boolean
}

export class WalkthroughWindow {
  private window: BrowserWindow | null = null

  /** Opens (or brings forward) the window; false when this build has no walkthrough video. */
  open(): boolean {
    if (!fs.existsSync(path.join(tutorialDir(), WALKTHROUGH_VIDEOS[0].file))) return false
    const current = this.window
    if (current && !current.isDestroyed()) {
      if (current.isMinimized()) current.restore()
      current.focus()
      return true
    }
    const place = loadPlace()
    const w = new BrowserWindow({
      ...(place ? place.bounds : { width: 1280, height: 800 }),
      minWidth: 640,
      minHeight: 420,
      backgroundColor: BACKGROUND,
      title: 'Spellforge walkthrough',
      autoHideMenuBar: true,
      webPreferences: { preload: PRELOAD, ...SECURE_WEB_PREFERENCES },
    })
    this.window = w
    if (place?.maximized) w.maximize()
    if (place?.onTop) w.setAlwaysOnTop(true, 'floating')
    let keep: NodeJS.Timeout | undefined
    const remember = () => {
      clearTimeout(keep)
      keep = setTimeout(() => savePlace(w), 400)
    }
    for (const ev of ['move', 'resize', 'maximize', 'unmaximize'] as const) w.on(ev as 'move', remember)
    w.on('close', () => savePlace(w))
    w.on('closed', () => {
      if (this.window === w) this.window = null
    })
    const page = pageUrl('tutorial.html')
    confineToPage(w, page)
    w.loadURL(page)
    return true
  }

  /** Keeps the window above others or not (`onTop` left out: as it is); how it is now. */
  keepOnTop(onTop?: boolean): { onTop: boolean } {
    const w = this.window
    if (!w || w.isDestroyed()) return { onTop: false }
    if (onTop !== undefined) {
      w.setAlwaysOnTop(onTop, 'floating')
      savePlace(w)
    }
    return { onTop: w.isAlwaysOnTop() }
  }
}

const placeFile = () => path.join(app.getPath('userData'), 'walkthrough-window.json')

function loadPlace(): WalkthroughPlace | null {
  try {
    const p = JSON.parse(fs.readFileSync(placeFile(), 'utf8')) as WalkthroughPlace
    const b = p.bounds
    // Only on a screen that's still there (a second monitor may be gone).
    const centre = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    const on = screen
      .getAllDisplays()
      .some(
        (d) =>
          centre.x >= d.workArea.x &&
          centre.x < d.workArea.x + d.workArea.width &&
          centre.y >= d.workArea.y &&
          centre.y < d.workArea.y + d.workArea.height,
      )
    return on && b.width >= 320 && b.height >= 200 ? p : null
  } catch {
    return null
  }
}

function savePlace(w: BrowserWindow): void {
  if (w.isDestroyed() || w.isFullScreen() || w.isMinimized()) return
  const place: WalkthroughPlace = {
    bounds: w.isMaximized() ? w.getNormalBounds() : w.getBounds(),
    maximized: w.isMaximized(),
    onTop: w.isAlwaysOnTop(),
  }
  try {
    fs.writeFileSync(placeFile(), JSON.stringify(place))
  } catch {
    /* it opens in the default place next time */
  }
}
