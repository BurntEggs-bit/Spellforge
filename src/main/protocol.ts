/**
 * The app://spellforge origin the UI is served from, rather than file://, so a
 * panel popped out into its own window can be a same-origin page the main
 * window fills in. Only the built UI's files and the walkthrough videos are
 * served; nothing leaves the machine.
 */
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { RENDERER_DIR, tutorialDir } from './paths.ts'

/** Declares the scheme; must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ])
}

/** Answers app://spellforge requests: /tutorial/… from the videos folder, anything else from the built UI. */
export function serveApp(): void {
  protocol.handle('app', (request) => {
    const url = new URL(request.url)
    if (url.host !== 'spellforge') return new Response(null, { status: 404 })
    if (url.pathname.startsWith('/tutorial/')) {
      const dir = tutorialDir()
      const file = path.resolve(dir, '.' + decodeURIComponent(url.pathname.slice('/tutorial'.length)))
      if (!file.startsWith(dir + path.sep)) return new Response(null, { status: 403 })
      return serveFile(file, request)
    }
    const file = path.resolve(RENDERER_DIR, '.' + decodeURIComponent(url.pathname))
    if (!file.startsWith(RENDERER_DIR + path.sep)) return new Response(null, { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

/** A file from disk, honouring Range requests so a video can be scrubbed. */
function serveFile(file: string, request: Request): Response {
  let size: number
  try {
    size = fs.statSync(file).size
  } catch {
    return new Response(null, { status: 404 })
  }
  const type = file.endsWith('.mp4')
    ? 'video/mp4'
    : file.endsWith('.json')
      ? 'application/json'
      : 'application/octet-stream'
  const m = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '')
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
    const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1
    if (start >= size || end < start)
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream
    return new Response(body, {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
      },
    })
  }
  const body = Readable.toWeb(fs.createReadStream(file)) as ReadableStream
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' },
  })
}
