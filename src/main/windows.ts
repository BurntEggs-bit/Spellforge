/**
 * The main window and the windows its panels pop out into: what each may load
 * and open. The windows only ever show Spellforge's own pages; web links
 * (https only) open in the user's browser; anything else is refused.
 */
import { BrowserWindow, screen, shell, type BrowserWindowConstructorOptions } from 'electron'
import { PRELOAD, pageUrl } from './paths.ts'

export const BACKGROUND = '#0b0f14'

/** The web preferences every window shares: isolated, sandboxed, offline. */
export const SECURE_WEB_PREFERENCES = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  // Chromium's spellchecker can download dictionaries; Spellforge stays offline.
  spellcheck: false,
} as const

/** Lets a window show only its own page: navigation away is refused, https links open in the browser. */
export function confineToPage(window: BrowserWindow, page: string): void {
  window.setMenuBarVisibility(false)
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== page) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
}

/** Opens the main window, which may pop panels out into windows of its own (popout.html). */
export function createMainWindow(): BrowserWindow {
  const main = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1100,
    minHeight: 640,
    backgroundColor: BACKGROUND,
    title: 'Spellforge',
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      ...SECURE_WEB_PREFERENCES,
      // Popped-out panels run this page's code: keep it running when this window is minimised.
      backgroundThrottling: false,
    },
  })

  const popoutPage = pageUrl('popout.html')
  main.webContents.setWindowOpenHandler(({ url }) => {
    if (url === popoutPage) return { action: 'allow', overrideBrowserWindowOptions: popoutOptions() }
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  main.webContents.on('did-create-window', (child, details) => {
    confineToPage(child, popoutPage)
    trackPopoutDrag(main, child, details.frameName)
  })
  // Closing the main window closes its popped-out panels too.
  main.on('closed', () => {
    for (const w of BrowserWindow.getAllWindows()) w.close()
  })
  main.webContents.on('will-navigate', (event, url) => {
    if (url !== main.webContents.getURL()) event.preventDefault()
  })
  // No camera, location, notifications…: only fullscreen (the walkthrough's video).
  main.webContents.session.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(permission === 'fullscreen'),
  )
  // Files the page saves (exported events, names, .glb models) go where the user picks.
  main.webContents.session.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({ title: 'Save from Spellforge', defaultPath: item.getFilename(), buttonLabel: 'Save' })
  })

  main.loadURL(pageUrl('index.html'))
  return main
}

/** A window holding panels popped out of the main one. */
function popoutOptions(): BrowserWindowConstructorOptions {
  return {
    backgroundColor: BACKGROUND,
    title: 'Spellforge',
    autoHideMenuBar: true,
    minWidth: 260,
    minHeight: 180,
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      // Keeps animating while the main window is minimised.
      backgroundThrottling: false,
    },
  }
}

/**
 * Dragging a popped-out window by its title bar: tell the main window where
 * the cursor is, so it can offer drop targets and dock the panels back when
 * the window is let go over one. Only moves the user makes (will-move),
 * not the window being placed when it opens.
 */
function trackPopoutDrag(main: BrowserWindow, child: BrowserWindow, name: string): void {
  let dragging = false
  const send = (kind: 'moving' | 'moved') => {
    if (main.isDestroyed()) return
    const p = screen.getCursorScreenPoint()
    const c = main.getContentBounds()
    const inside = !main.isMinimized() && p.x >= c.x && p.x < c.x + c.width && p.y >= c.y && p.y < c.y + c.height
    main.webContents.send('popout:move', { name, kind, x: p.x - c.x, y: p.y - c.y, inside })
  }
  child.on('will-move', () => {
    dragging = true
  })
  child.on('move', () => dragging && send('moving'))
  child.on('moved', () => {
    if (!dragging) return
    dragging = false
    send('moved')
  })
}
