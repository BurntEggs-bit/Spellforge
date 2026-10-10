/**
 * The Electron main process: starts the session, serves the UI, opens the
 * windows and answers the UI's calls (dispatch.ts).
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { CHANNELS, dispatch, type HostHandlers } from './dispatch.ts'
import { bundledData } from './paths.ts'
import { registerAppScheme, serveApp } from './protocol.ts'
import { Session } from './session.ts'
import { WalkthroughWindow } from './walkthrough.ts'
import { createMainWindow } from './windows.ts'

registerAppScheme()

let session: Session
let mainWindow: BrowserWindow | null = null
const walkthrough = new WalkthroughWindow()

/** The calls that need a window: file dialogs and the walkthrough window. */
const host: HostHandlers = {
  'dialog:pickFolder': async (_s, { title, defaultPath }) => {
    const r = await dialog.showOpenDialog(mainWindow!, { title, defaultPath, properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  },
  'dialog:pickFile': async (_s, { title, extensions }) => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      title,
      properties: ['openFile'],
      filters: [{ name: extensions.join(', '), extensions }],
    })
    return r.canceled ? null : r.filePaths[0]
  },
  'app:openTutorial': () => walkthrough.open(),
  'app:walkthroughWindow': (_s, { onTop }) => walkthrough.keepOnTop(onTop),
}

function openMainWindow(): BrowserWindow {
  const w = createMainWindow()
  w.on('closed', () => {
    if (mainWindow === w) mainWindow = null
  })
  mainWindow = w
  return w
}

app.whenReady().then(() => {
  session = new Session(app.getPath('userData'), bundledData())
  serveApp()
  for (const channel of CHANNELS) ipcMain.handle(channel, (_event, req) => dispatch(session, host, channel, req))
  openMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
