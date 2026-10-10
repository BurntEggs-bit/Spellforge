/**
 * The bridge the UI calls the main process through: `window.spellforge`,
 * exposed to the sandboxed page by contextBridge. Requests go to dispatch.ts
 * over IPC, and a failed call comes back as an Error with the main process's
 * message.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { PopoutMoveEvent, SpellforgeBridge } from '../shared/api.ts'

const bridge: SpellforgeBridge = {
  async invoke(channel, request) {
    const r = await ipcRenderer.invoke(channel, request)
    if (!r.ok) throw new Error(r.error)
    return r.value
  },
  onPopoutMove(listener) {
    const f = (_e: unknown, m: PopoutMoveEvent) => listener(m)
    ipcRenderer.on('popout:move', f)
    return () => {
      ipcRenderer.removeListener('popout:move', f)
    }
  },
}

contextBridge.exposeInMainWorld('spellforge', bridge)
