/**
 * Playing the open project in the game (File > Play in game): through
 * ModEngine 3 (me3), with the project's mod folder as the only mod, offline
 * (me3 keeps its games off the matchmaking servers unless asked) and on a
 * save file of its own, so a test never touches the normal save (me3 copies
 * the normal one the first time). Spellforge only starts me3, which the user
 * installs; nothing of me3's ships with Spellforge.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** The save file the game uses when Spellforge starts it (in the game's own save folder). */
export const PLAY_SAVEFILE = 'Spellforge.sl2'

/** me3's executable: where its installer puts it, else on PATH. Null when it isn't installed. */
export function findMe3(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    ...(env.LOCALAPPDATA ? [path.join(env.LOCALAPPDATA, 'Programs', 'garyttierney', 'me3', 'bin', 'me3.exe')] : []),
    ...(env.PATH ?? '')
      .split(path.delimiter)
      .filter(Boolean)
      .map((d) => path.join(d, 'me3.exe')),
  ]
  return candidates.find((p) => fs.existsSync(p)) ?? null
}

/** me3's arguments to play a mod folder on its own save (offline: me3's default). */
export function me3PlayArgs(modDir: string, savefile = PLAY_SAVEFILE): string[] {
  return ['launch', '--game', 'eldenring', '--package', modDir, '--savefile', savefile]
}

/** Starts the game through me3; it carries on when Spellforge closes. */
export function launchMe3(me3: string, args: string[]): void {
  const child = spawn(me3, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', () => {
    /* reported by the caller's check that the game started */
  })
  child.unref()
}
