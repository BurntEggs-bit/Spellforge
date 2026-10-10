/** Where the app's own files are: the built UI, the preload script, the bundled data, the walkthrough videos. */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'

const here = path.dirname(fileURLToPath(import.meta.url))

/** The built UI's files. */
export const RENDERER_DIR = path.resolve(here, '../renderer')

/** The preload script every window runs (it exposes the IPC bridge, nothing else). */
export const PRELOAD = path.join(here, '../preload/index.cjs')

/** Bundled param data: beside the app when packaged, in the repo when developing. */
export function bundledData(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'data', 'er') : path.join(app.getAppPath(), 'data', 'er')
}

/** The walkthrough videos and their chapters: beside the app when packaged, in media/tutorial when developing. */
export function tutorialDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'tutorial')
    : path.join(app.getAppPath(), 'media', 'tutorial')
}

/** A page of the UI: the dev server's while developing, else the packaged one. */
export function pageUrl(name: string): string {
  const dev = process.env.ELECTRON_RENDERER_URL
  return dev ? new URL(name, dev.endsWith('/') ? dev : dev + '/').toString() : `app://spellforge/${name}`
}
