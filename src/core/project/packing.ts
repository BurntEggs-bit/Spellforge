/**
 * Packed (DCX) files in a project that Elden Ring can't unpack: Kraken files
 * whose 256 KB chunks don't all unpack on their own (see krakChunks). The game
 * unpacks one chunk at a time, reads garbage past the first 256 KB of such a
 * file, and crashes at startup. Older Spellforge versions wrote such files;
 * packing one again (repackDcx) fixes it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { krakChunksOfFile } from '../formats/dcx.ts'

/** Project-relative paths (forward slashes) of the .dcx files the game can't unpack. */
export function badlyPacked(modDir: string): string[] {
  const out: string[] = []
  const walk = (dir: string, rel: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      // .spellforge holds Spellforge's own records, never game files.
      if (e.name.startsWith('.')) continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(path.join(dir, e.name), r)
      else if (/\.dcx$/i.test(e.name)) {
        try {
          const chunks = krakChunksOfFile(path.join(dir, e.name))
          if (chunks && chunks.independent < chunks.total) out.push(r)
        } catch {
          /* unreadable: left as it is */
        }
      }
    }
  }
  walk(modDir, '')
  return out.sort()
}
