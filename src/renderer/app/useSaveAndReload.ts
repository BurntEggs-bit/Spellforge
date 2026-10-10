/**
 * Saving the project into its mod folder (Save, Ctrl+S) and reloading the
 * character in the running game (F5, DS Anim Studio's "Force In-game Entity
 * Reload"), with what is unsaved. Saving can also reload every time.
 */
import { useCallback, useEffect, useState } from 'react'
import type { DirtyState } from '../../shared/api.ts'
import { errorMessage } from '../../shared/errors.ts'
import { PREF_KEYS, readText, writeText } from '../lib/storage.ts'
import { call } from '../lib/ipc.ts'
import { useUi } from '../shared/ui.tsx'
import { projectPath } from './projectPaths.ts'
import { useAppKeydown } from './windows.ts'

export function useSaveAndReload(modDir: string) {
  const ui = useUi()
  const [dirty, setDirty] = useState<DirtyState>({ regulation: false, bundles: [] })
  const refreshDirty = useCallback(() => call('project:dirty', undefined).then(setDirty), [])
  // Opened with changes already made (brought back from last time): say so from the start.
  useEffect(() => {
    refreshDirty()
  }, [refreshDirty])
  const isDirty = dirty.regulation || dirty.bundles.length > 0

  /** Whether saving also reloads the character in the running game. */
  const [reloadOnSave, setReloadOnSaveState] = useState(() => readText(PREF_KEYS.reloadOnSave) === '1')
  const setReloadOnSave = (on: boolean) => {
    setReloadOnSaveState(on)
    writeText(PREF_KEYS.reloadOnSave, on ? '1' : '0')
  }

  /** After a save: the game reloads the character if it's running; nothing is said when it isn't. */
  const reloadQuietly = async () => {
    try {
      const st = await call('game:status', undefined)
      if (!st.running || st.problem) return
      const r = await call('game:reload', { model: 'c0000' })
      ui.toast(`Reloaded in game (${(r.ms / 1000).toFixed(1)} s).`)
    } catch (e) {
      ui.toast(`Saved, but reloading in game failed: ${errorMessage(e)}`, true)
    }
  }

  const save = () =>
    ui.run('Saving into the project', async () => {
      const r = await call('project:save', undefined)
      await refreshDirty()
      const short = (f: string) => projectPath(modDir, f)
      ui.toast(
        r.written.length
          ? `Saved into your mod folder:\n${r.written.map(short).join('\n')}\n\nBackups of replaced files: ${short(r.backupsFolder)}`
          : 'Nothing to save.',
      )
      // Reload after every save, if asked and the game is running.
      if (r.written.length && reloadOnSave) await reloadQuietly()
    })

  /** Saves (if there's anything to), then asks the running game to reload the player character. */
  const reloadInGame = () =>
    ui.run('Reloading in game', async () => {
      if (isDirty) {
        await call('project:save', undefined)
        await refreshDirty()
      }
      const st = await call('game:status', undefined)
      if (!st.running)
        throw new Error(
          'Elden Ring isn’t running. Start it (offline, through ModEngine), load your save, then press F5.',
        )
      if (st.problem) throw new Error(st.problem)
      const r = await call('game:reload', { model: 'c0000' })
      ui.toast(
        `The game reloaded your character (${(r.ms / 1000).toFixed(1)} s): saved animations, events and behaviour are in.`,
      )
    })

  /** Saves (if there's anything to), then starts the game with the mod through me3, offline, on its own save. */
  const playInGame = () =>
    ui.run('Starting the game', async () => {
      if (isDirty) {
        await call('project:save', undefined)
        await refreshDirty()
      }
      const r = await call('game:play', undefined)
      ui.toast(
        `Elden Ring is starting with your mod, offline, on the save ${r.savefile} (a copy of your own the first time, so your real save stays as it is). Once you've loaded in, F5 reloads your character after each save.`,
      )
    })

  // Ctrl+S saves; F5 (DS Anim Studio's) saves, then the running game reloads the character. In every window.
  useAppKeydown((e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      save()
    } else if (e.key === 'F5' && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      reloadInGame()
    }
  })

  return { dirty, isDirty, refreshDirty, save, reloadInGame, playInGame, reloadOnSave, setReloadOnSave }
}
