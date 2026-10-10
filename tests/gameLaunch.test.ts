/** Playing in game: finding me3 and the arguments it starts the game with. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { findMe3, me3PlayArgs, PLAY_SAVEFILE } from '../src/main/services/gameLaunch.ts'

test('me3 is found where its installer puts it, else on PATH', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-me3-'))
  try {
    const installed = path.join(root, 'local', 'Programs', 'garyttierney', 'me3', 'bin', 'me3.exe')
    const onPath = path.join(root, 'tools', 'me3.exe')
    fs.mkdirSync(path.dirname(onPath), { recursive: true })
    fs.writeFileSync(onPath, '')
    assert.equal(findMe3({ LOCALAPPDATA: path.join(root, 'local'), PATH: path.dirname(onPath) }), onPath)
    fs.mkdirSync(path.dirname(installed), { recursive: true })
    fs.writeFileSync(installed, '')
    assert.equal(findMe3({ LOCALAPPDATA: path.join(root, 'local'), PATH: path.dirname(onPath) }), installed)
    assert.equal(findMe3({ LOCALAPPDATA: path.join(root, 'nowhere'), PATH: '' }), null)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the game starts with the mod folder only, on its own save, offline', () => {
  const args = me3PlayArgs('F:/Mods/My Mod/mod')
  assert.deepEqual(args.slice(0, 3), ['launch', '--game', 'eldenring'])
  assert.equal(args[args.indexOf('--package') + 1], 'F:/Mods/My Mod/mod')
  assert.equal(args[args.indexOf('--savefile') + 1], PLAY_SAVEFILE)
  // me3 keeps the game off the matchmaking servers unless told otherwise: never tell it.
  assert.ok(!args.some((a) => /online/i.test(a)))
  assert.ok(!args.includes('--native'))
})
