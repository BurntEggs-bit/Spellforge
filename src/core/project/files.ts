/** Writing files so a crash or a full disk never leaves one half written. */
import fs from 'node:fs'
import path from 'node:path'

/** Writes a file whole or not at all: to a temporary file beside it first, then renamed over it. */
export function writeFileAtomic(target: string, data: string | Uint8Array): void {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const tmp = `${target}.partial-${process.pid}`
  try {
    fs.writeFileSync(tmp, data)
    fs.renameSync(tmp, target)
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw e
  }
}
