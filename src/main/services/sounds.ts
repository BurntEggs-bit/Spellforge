/**
 * Sounds: where the game's sound events are, and other characters' sounds
 * brought into the player's.
 *
 * The game plays a TAE sound event (sound type T, id N) by posting the Wwise
 * event Play_<letter><N, 9 digits>, the letter by type (1: c, character; 5:
 * s, effects...); a bullet's sounds (seId_Bullet1/2, seId_Hit, seId_Flick)
 * are s events. A character's events are in its own bank (sd/cs_c2130.bnk or
 * sd/enus/cs_c2130.bnk, or the banks its NpcParam rows name with SoundBankId
 * and SoundAddBankId), loaded only while it's around; the player's are in
 * the main banks (sd/enus/cs_main.bnk, sd/cs_smain.bnk), always loaded.
 *
 * A move or bullet made the player's brings its events, and everything they
 * play, into the project's copy of the main bank (formats/wwise.ts
 * copyEvents), so they play wherever the player is. Which events came from
 * where is recorded in .spellforge/sounds.json, so a game update can rebuild
 * the bank as the new game's plus those events.
 *
 * Mod loaders: ModEngine 3 (me3) loads a mod's sd/ files; ModEngine 2 does
 * from builds after 2.1.0 (its official release, 2.1.0, ignores them).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Project } from '../../core/project/project.ts'
import type { ParamDatabase } from '../../core/params/paramDb.ts'
import {
  readBank,
  writeBank,
  copyEvents,
  namesOtherBanks,
  eventClosure,
  eventVoices,
  wwiseHash,
  HIRC,
  type WwiseBank,
} from '../../core/formats/wwise.ts'
import { wemToOgg } from '../../core/formats/wemVorbis.ts'
import type * as A from '../../shared/api.ts'
import { errorMessage } from '../../shared/errors.ts'
import { BoundedMap } from '../../shared/collections.ts'

/** The player's main bank: what the player plays is brought in here. */
export const PLAYER_BANK = 'sd/enus/cs_main.bnk'
/** Banks always loaded with the player. */
const PLAYER_BANKS = [PLAYER_BANK, 'sd/cs_smain.bnk']
/** Which events Spellforge brought into which of the project's banks, from where. */
export const SOUNDS_RECORD = '.spellforge/sounds.json'

/** Event letter by TAE sound type (DS Anim Studio's template: 0 a, 1 c, 2 f, ... 15 d). */
const LETTERS = 'acfopsmvxbiyzegd'
/** Sound types whose last two digits the game fills in (floor and armour material). */
const MATERIAL_TYPES = new Set([8, 9, 15])

const soundEventName = (letter: string, id: number) => `Play_${letter}${String(id).padStart(9, '0')}`

/**
 * Events with their Stop_ twins, where the bank has them. A looping sound
 * plays until the game posts its Stop_ event, which it does when what played
 * it ends (a bullet, an effect): brought without it, Morgott's lingering
 * swords' hum never stopped. Every Play_ event in a character's bank has one.
 */
function withStops(bank: WwiseBank, names: string[]): string[] {
  const stops = names
    .filter((n) => n.startsWith('Play_'))
    .map((n) => `Stop_${n.slice(5)}`)
    .filter((n) => bank.byId.get(wwiseHash(n))?.type === HIRC.Event)
  return [...new Set([...names, ...stops])]
}

/** The sounds among recorded events: a Stop_ event recorded with its Play_ event isn't a sound of its own. */
function soundCount(names: string[]): number {
  return names.filter((n) => !(n.startsWith('Stop_') && names.includes(`Play_${n.slice(5)}`))).length
}

/**
 * The events the game may post for a TAE sound event: its letter's, and the
 * character letter's (the player's floor and armour sounds are c events); for
 * material sounds, every material variant.
 */
export function taeSoundNames(soundType: number, id: number): string[] {
  if (id <= 0) return []
  const letters = [...new Set([LETTERS[soundType] ?? 'c', 'c'])]
  const ids = MATERIAL_TYPES.has(soundType) ? Array.from({ length: 100 }, (_, m) => id - (id % 100) + m) : [id]
  return letters.flatMap((l) => ids.map((n) => soundEventName(l, n)))
}

/** The events a bullet's sound id may be. */
export function bulletSoundNames(id: number): string[] {
  return id > 0 ? [soundEventName('s', id), soundEventName('c', id)] : []
}

/** Where an event is: the player already has it, or one of the character's banks does. */
export type SoundPlace = { where: 'player'; bank: string } | { where: 'character'; bank: string }

export class SoundService {
  private project: Project
  private db: ParamDatabase
  /** Banks as the game has them, parsed once. */
  private gameBanks = new Map<string, WwiseBank | null>()
  /** The project's own copies of banks, parsed once. */
  private projectCopies = new Map<string, WwiseBank | null>()
  /** Event ids of the player's banks (as the project has them). */
  private playerEvents: Set<number> | null = null
  /** The project's copy of the player's main bank, once something is brought in. */
  private player: { bank: WwiseBank; dirty: boolean; added: Record<string, string[]> } | null = null
  /** Sound events converted for the viewer. */
  private clips = new BoundedMap<string, A.SoundClip>(64)
  /** Wwise Vorbis's shared codebook library (data/er/wwise), read once. */
  private codebooksFile: string
  private codebooks: Buffer | null = null

  constructor(
    project: Project,
    db: ParamDatabase,
    codebooksFile = path.resolve('data/er/wwise/packed_codebooks_aoTuV_603.bin'),
  ) {
    this.project = project
    this.db = db
    this.codebooksFile = codebooksFile
  }

  reset(): void {
    this.gameBanks.clear()
    this.projectCopies.clear()
    this.playerEvents = null
    this.player = null
    this.clips.clear()
  }

  private gameBank(rel: string): WwiseBank | null {
    if (!this.gameBanks.has(rel)) {
      let bank: WwiseBank | null = null
      try {
        if (this.project.game.has(rel)) bank = readBank(this.project.readGame(rel))
      } catch {
        bank = null
      }
      this.gameBanks.set(rel, bank)
    }
    return this.gameBanks.get(rel)!
  }

  /** A bank as the project has it (its own copy, else the game's). */
  private projectBank(rel: string): WwiseBank | null {
    if (rel === PLAYER_BANK && this.player) return this.player.bank
    if (this.project.resolve(rel)?.source !== 'project') return this.gameBank(rel)
    if (!this.projectCopies.has(rel)) {
      let bank: WwiseBank | null
      try {
        bank = readBank(this.project.read(rel).data)
      } catch {
        bank = null
      }
      this.projectCopies.set(rel, bank)
    }
    return this.projectCopies.get(rel)!
  }

  private eventsOfPlayer(): Set<number> {
    if (!this.playerEvents) {
      const ids = new Set<number>()
      for (const rel of PLAYER_BANKS)
        for (const o of this.projectBank(rel)?.objects ?? []) if (o.type === HIRC.Event) ids.add(o.id)
      this.playerEvents = ids
    }
    return this.playerEvents
  }

  /** The banks a character's sounds can be in: its own, and the ones its NPC rows name. */
  banksOf(chr: string): string[] {
    const model = Number(chr.slice(1))
    const ids = new Set<number>([model])
    try {
      for (const r of this.db.get('NpcParam').param.rows) {
        // NpcParam 21300000 and up are c2130's.
        if (Math.floor(r.id / 10000) !== model) continue
        for (const f of ['SoundBankId', 'SoundAddBankId']) {
          const v = this.db.value('NpcParam', r.id, f)
          if (typeof v === 'number' && v >= 0) ids.add(v)
        }
      }
    } catch {
      /* no NpcParam */
    }
    const out: string[] = []
    for (const id of ids) {
      const name = `cs_c${String(id).padStart(4, '0')}.bnk`
      for (const rel of [`sd/${name}`, `sd/enus/${name}`]) if (this.gameBank(rel)) out.push(rel)
    }
    return out
  }

  /** Where each event is (null: nowhere the player or the character can play it from). */
  locate(chr: string, names: string[]): Map<string, SoundPlace | null> {
    const player = this.eventsOfPlayer()
    const banks = this.banksOf(chr)
    const out = new Map<string, SoundPlace | null>()
    for (const name of names) {
      const id = wwiseHash(name)
      if (player.has(id)) {
        out.set(name, { where: 'player', bank: PLAYER_BANK })
        continue
      }
      const bank = banks.find((rel) => this.gameBank(rel)!.byId.get(id)?.type === HIRC.Event)
      out.set(name, bank ? { where: 'character', bank } : null)
    }
    return out
  }

  /** How much the events would add to the player's bank (embedded audio it doesn't have yet, bytes). */
  size(chr: string, names: string[]): number {
    let bytes = 0
    const byBank = new Map<string, number[]>()
    for (const [name, at] of this.locate(chr, names))
      if (at?.where === 'character') byBank.set(at.bank, [...(byBank.get(at.bank) ?? []), wwiseHash(name)])
    const has = this.projectBank(PLAYER_BANK)?.media ?? new Map()
    const counted = new Set<number>()
    for (const [rel, ids] of byBank) {
      const bank = this.gameBank(rel)!
      for (const m of eventClosure(bank, ids).media) {
        if (has.has(m) || counted.has(m)) continue
        counted.add(m)
        bytes += bank.media.get(m)?.length ?? 0
      }
    }
    return bytes
  }

  private playerCopy(): NonNullable<SoundService['player']> {
    if (!this.player) {
      // The project's own copy becomes the one edited; the game's is read afresh
      // (the parsed game bank kept for lookups stays as the game has it).
      let bank = this.project.resolve(PLAYER_BANK)?.source === 'project' ? this.projectBank(PLAYER_BANK) : null
      this.projectCopies.delete(PLAYER_BANK)
      if (!bank) {
        try {
          bank = readBank(this.project.read(PLAYER_BANK).data)
        } catch (e) {
          throw new Error(`The player's sound bank (${PLAYER_BANK}) can't be read: ${errorMessage(e)}`, {
            cause: e,
          })
        }
      }
      this.player = { bank, dirty: false, added: {} }
    }
    return this.player
  }

  /**
   * Brings a character's events (and everything they play) into the
   * project's copy of the player's main bank. Events the player's banks
   * already have are left alone.
   */
  bring(
    chr: string,
    names: string[],
  ): { copied: number; present: number; missing: string[]; objects: number; mediaBytes: number } {
    const out = { copied: 0, present: 0, missing: [] as string[], objects: 0, mediaBytes: 0 }
    const byBank = new Map<string, string[]>()
    for (const [name, at] of this.locate(chr, names)) {
      if (!at) out.missing.push(name)
      else if (at.where === 'player') out.present++
      else byBank.set(at.bank, [...(byBank.get(at.bank) ?? []), name])
    }
    if (!byBank.size) return out
    const p = this.playerCopy()
    for (const [rel, list] of byBank) {
      const src = this.gameBank(rel)!
      const all = withStops(src, list)
      const r = copyEvents(src, p.bank, all.map(wwiseHash))
      // Counted as asked for: their Stop_ twins come along unannounced.
      const asked = new Set(list.map(wwiseHash))
      out.copied += r.copied.filter((e) => asked.has(e)).length
      out.present += r.present.filter((e) => asked.has(e)).length
      out.objects += r.objects
      out.mediaBytes += r.mediaBytes
      p.added[rel] = [...new Set([...(p.added[rel] ?? []), ...all])].sort()
    }
    p.dirty = true
    this.playerEvents = null
    this.clips.clear()
    return out
  }

  /**
   * Where a TAE sound event's sound is, for the event's SoundID: in the
   * player's banks (it plays in game), only in a character's own (it plays
   * only near that character; bringSound copies it into the player's), or
   * in none. A character's sounds carry its model in their first four digits
   * (c213006500 and s213000035 are Margit's, c2130).
   */
  place(soundType: number, id: number): A.SoundPlaceView {
    const names = taeSoundNames(soundType, id)
    if (!names.length) return { where: 'none', name: null }
    const player = this.eventsOfPlayer()
    const mine = names.find((n) => player.has(wwiseHash(n)))
    if (mine) return { where: 'player', name: mine, bank: PLAYER_BANK }
    const chr = `c${String(Math.floor(id / 100000)).padStart(4, '0')}`
    for (const [name, at] of this.locate(chr, names))
      if (at?.where === 'character') return { where: 'character', name, bank: at.bank, chr }
    return { where: 'none', name: names[0] }
  }

  /** A sound only a character's bank has, brought into the player's (as making a skill from its moves does). */
  bringSound(soundType: number, id: number): ReturnType<SoundService['bring']> & { name: string } {
    const at = this.place(soundType, id)
    if (at.where === 'player') throw new Error(`${at.name} is in your sound bank already`)
    if (at.where !== 'character') throw new Error(`No sound bank has ${at.name ?? `sound ${id}`}`)
    return { ...this.bring(at.chr!, [at.name!]), name: at.name! }
  }

  /* -------------------------------- playing -------------------------------- */

  /**
   * A TAE sound event's audio, for the viewer: the Wwise event the game
   * posts (looked for in the character's banks, then the player's, as the
   * project has them), what it plays (formats/wwise.ts eventVoices), and
   * each sound as Ogg Vorbis (formats/wemVorbis.ts, after ww2ogg). Streamed
   * sounds are read from sd/wem/<first two digits>/<id>.wem.
   */
  clip(chr: string, soundType: number, id: number): A.SoundClip {
    const key = `${chr}:${soundType}:${id}`
    const cached = this.clips.get(key)
    if (cached) return cached
    const out: A.SoundClip = { event: null, bank: null, audio: {}, choices: [], weights: [] }
    const names = taeSoundNames(soundType, id)
    const banks = [...(chr === 'c0000' ? [] : this.banksOf(chr)), ...PLAYER_BANKS]
    let found: { name: string; rel: string; bank: WwiseBank } | null = null
    for (const name of names) {
      const h = wwiseHash(name)
      for (const rel of banks) {
        const bank = this.projectBank(rel)
        if (bank?.byId.get(h)?.type === HIRC.Event) {
          found = { name, rel, bank }
          break
        }
      }
      if (found) break
    }
    if (!found) {
      out.note = names.length
        ? `No bank ${chr === 'c0000' ? 'the player loads' : `${chr} or the player loads`} has ${names[0]}`
        : 'No sound id'
      return out
    }
    out.event = found.name
    out.bank = found.rel
    const { choices, weights } = eventVoices(found.bank, wwiseHash(found.name))
    const problems: string[] = []
    let bytes = 0
    for (const [i, choice] of choices.entries()) {
      const kept: A.SoundClip['choices'][number] = []
      for (const v of choice) {
        if (!(v.media in out.audio)) {
          const ogg = this.ogg(found.bank, v.media, v.stream, problems)
          if (!ogg || bytes + ogg.length > 24e6) continue
          bytes += ogg.length
          out.audio[v.media] = ogg.toString('base64')
        }
        kept.push({ media: v.media, volume: v.volume, pitch: v.pitch })
      }
      if (kept.length) {
        out.choices.push(kept)
        out.weights.push(weights[i] ?? 1)
      }
    }
    if (!choices.length) out.note = `${found.name} plays nothing a viewer can (a generator or another action)`
    else if (problems.length) out.note = [...new Set(problems)].slice(0, 3).join('; ')
    this.clips.set(key, out)
    return out
  }

  /** A sound's media as Ogg Vorbis: from the bank, or its streamed .wem. */
  private ogg(bank: WwiseBank, media: number, stream: number, problems: string[]): Buffer | null {
    let wem = stream === 0 ? (bank.media.get(media) ?? null) : null
    let partial = false
    if (!wem) {
      const s = String(media).slice(0, 2)
      const rel = [`sd/wem/${s}/${media}.wem`, `sd/enus/wem/${s}/${media}.wem`].find((p) => this.project.resolve(p))
      if (rel) wem = this.project.read(rel).data
      else if (bank.media.has(media)) {
        // Only the start (a prefetch copy) is there.
        wem = bank.media.get(media)!
        partial = true
      }
    }
    if (!wem) {
      problems.push(`sound ${media} isn’t in the bank or sd/wem`)
      return null
    }
    try {
      if (!this.codebooks) this.codebooks = fs.readFileSync(this.codebooksFile)
      return wemToOgg(wem, this.codebooks, { partial })
    } catch (e) {
      problems.push(`sound ${media}: ${errorMessage(e)}`)
      return null
    }
  }

  /* --------------------------------- saving -------------------------------- */

  dirtyFiles(): string[] {
    return this.player?.dirty ? [PLAYER_BANK] : []
  }

  save(): string[] {
    const p = this.player
    if (!p?.dirty) return []
    const written = [this.project.writeProjectFile(PLAYER_BANK, writeBank(p.bank))]
    const record = this.recorded()
    const mine = (record[PLAYER_BANK] ??= {})
    for (const [rel, names] of Object.entries(p.added))
      mine[rel] = [...new Set([...(mine[rel] ?? []), ...names])].sort()
    written.push(this.project.writeProjectFile(SOUNDS_RECORD, Buffer.from(JSON.stringify(record, null, 1))))
    p.dirty = false
    p.added = {}
    return written
  }

  /** The record: project bank -> source bank -> event names Spellforge brought in. */
  recorded(): Record<string, Record<string, string[]>> {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.project.config.modDir, SOUNDS_RECORD), 'utf8'))
    } catch {
      return {}
    }
  }

  /** The project's banks Spellforge rebuilds after a game update. */
  recordedBanks(): string[] {
    return Object.keys(this.recorded())
  }

  /**
   * When the project's player bank names other characters' banks in its Play
   * actions (written by an older Spellforge; the game drops such a bank, and
   * menu and player sounds go silent): built again, the game's bank plus the
   * recorded events (mergeFromGame), and written by the next save.
   */
  repairPlayerBank(): { events: number } | null {
    if (!this.recorded()[PLAYER_BANK] || this.project.resolve(PLAYER_BANK)?.source !== 'project') return null
    const mine = this.projectBank(PLAYER_BANK)
    const game = this.gameBank(PLAYER_BANK)
    if (!mine || !game || !namesOtherBanks(mine, game)) return null
    return this.mergeFromGame(true)
  }

  /**
   * When sounds brought into the project's player bank lack their Stop_
   * twins (an older Spellforge brought Play_ events alone, so a looping one
   * never stopped): the twins brought in from the banks they came from, and
   * written by the next save. Null when nothing's missing.
   */
  repairStops(): { events: number } | null {
    const record = this.recorded()[PLAYER_BANK]
    if (!record || this.project.resolve(PLAYER_BANK)?.source !== 'project') return null
    const mine = this.player?.bank ?? this.projectBank(PLAYER_BANK)
    if (!mine) return null
    const missing = new Map<string, string[]>()
    for (const [rel, names] of Object.entries(record)) {
      const src = this.gameBank(rel)
      if (!src) continue
      const stops = withStops(src, names).filter(
        (n) => n.startsWith('Stop_') && mine.byId.get(wwiseHash(n))?.type !== HIRC.Event,
      )
      if (stops.length) missing.set(rel, stops)
    }
    if (!missing.size) return null
    const p = this.playerCopy()
    let events = 0
    for (const [rel, stops] of missing) {
      events += copyEvents(this.gameBank(rel)!, p.bank, stops.map(wwiseHash)).copied.length
      p.added[rel] = [...new Set([...(p.added[rel] ?? []), ...stops])].sort()
    }
    if (!events) return null
    p.dirty = true
    this.playerEvents = null
    this.clips.clear()
    return { events }
  }

  /**
   * After a game update: the player's bank rebuilt as the new game's, with
   * the recorded events brought in again from the new game's banks (the rest
   * of the project's copy is the old game's).
   */
  mergeFromGame(apply: boolean): { events: number } {
    const record = this.recorded()[PLAYER_BANK]
    if (!record || this.project.resolve(PLAYER_BANK)?.source !== 'project') return { events: 0 }
    const pending = this.player?.added ?? {}
    let events = 0
    for (const names of Object.values(record)) events += soundCount(names)
    if (!apply) return { events }
    this.gameBanks.clear()
    let bank: WwiseBank
    try {
      bank = readBank(this.project.readGame(PLAYER_BANK))
    } catch {
      return { events: 0 }
    }
    const sources: Record<string, string[]> = {}
    for (const [rel, names] of [...Object.entries(record), ...Object.entries(pending)])
      sources[rel] = [...new Set([...(sources[rel] ?? []), ...names])]
    for (const [rel, names] of Object.entries(sources)) {
      const src = this.gameBank(rel)
      if (src) copyEvents(src, bank, withStops(src, names).map(wwiseHash))
    }
    this.player = { bank, dirty: true, added: pending }
    this.playerEvents = null
    this.clips.clear()
    return { events }
  }
}
