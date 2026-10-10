/**
 * TAE — animation event tables (Elden Ring: "TAE " version 0x1000C/D, 64-bit),
 * as found in chr/cXXXX.anibnd.dcx. Spellforge reads them for one thing: which
 * animations fire which behaviors, because some bullets (many skills) are only
 * linked to anything through an animation event, never through a param.
 *
 * Layout (all offsets absolute, 64-bit):
 *   0x00 "TAE " ; 0x04 u8 bigEndian, 0, 0, u8 is64Bit (0xFF)
 *   0x08 version ; 0x0C fileSize
 *   0x50 i32 id ; 0x54 i32 animCount ; 0x58 i64 animsOffset
 *   anims: { i64 animId, i64 animOffset } per animation
 *   animation: { i64 eventHeaders, i64 eventGroups, i64 times, i64 animFile,
 *                i32 eventCount, ... }
 *   event header: { i64 startTimeOffset, i64 endTimeOffset, i64 eventDataOffset }
 *   event data: { i32 type, i32 unk, i64 paramsOffset } ; params per DSAS's
 *   TAE.Template.ER.xml.
 *
 * Credit: DS Anim Studio (Meowmaritus and contributors; MIT) documents the
 * event parameters in its template.
 */
import { animationName } from '../../shared/animIds.ts'

export interface TaeEvent {
  type: number
  start: number
  end: number
  params: Buffer
}

export interface TaeAnimation {
  /** Id within the TAE file; the full name is aXXX_YYYYYY (file id, anim id). */
  id: number
  events: TaeEvent[]
}

export interface Tae {
  id: number
  animations: TaeAnimation[]
}

export function readTae(buf: Buffer): Tae {
  if (buf.toString('ascii', 0, 4) !== 'TAE ') throw new Error('Not a TAE file')
  if (buf[4] !== 0) throw new Error('Big-endian TAE is not supported')
  if (buf[7] !== 0xff) throw new Error('Only 64-bit TAE (Elden Ring) is supported')
  const i64 = (o: number) => Number(buf.readBigInt64LE(o))
  const id = buf.readInt32LE(0x50)
  const animCount = buf.readInt32LE(0x54)
  const animsOffset = i64(0x58)

  const animations: TaeAnimation[] = []
  for (let a = 0; a < animCount; a++) {
    const animId = i64(animsOffset + a * 16)
    const at = i64(animsOffset + a * 16 + 8)
    const headers = i64(at)
    const eventCount = buf.readInt32LE(at + 0x20)
    const events: TaeEvent[] = []
    for (let e = 0; e < eventCount; e++) {
      const h = headers + e * 0x18
      const start = buf.readFloatLE(i64(h))
      const end = buf.readFloatLE(i64(h + 8))
      const data = i64(h + 0x10)
      const type = buf.readInt32LE(data)
      const params = i64(data + 8)
      events.push({ type, start, end, params: buf.subarray(params, Math.min(buf.length, params + 0x40)) })
    }
    animations.push({ id: animId, events })
  }
  return { id, animations }
}

/** Events that fire a BehaviorParam row, and where their judge id sits. */
const BEHAVIOR_EVENTS: Record<number, { name: string; judgeAt: number; dummyPolyAt?: number }> = {
  1: { name: 'AttackBehavior', judgeAt: 8 },
  2: { name: 'BulletBehavior', judgeAt: 8, dummyPolyAt: 0 },
  5: { name: 'CommonBehavior', judgeAt: 4 },
  307: { name: 'PCBehavior', judgeAt: 8 },
}

export interface BehaviorInvocation {
  /** e.g. a051_030000 */
  animation: string
  event: string
  start: number
  end: number
  dummyPoly?: number
}

/**
 * judge id -> animations that fire it. `taeFiles` are [fileName, data]
 * pairs; the group number comes from the file name (a051.tae -> 51), which is
 * how animations are named in-game and in DSAS.
 */
export function indexBehaviorInvocations(taeFiles: [string, Buffer][]): Map<number, BehaviorInvocation[]> {
  const index = new Map<number, BehaviorInvocation[]>()
  for (const [name, data] of taeFiles) {
    const m = /a(\d+)\.tae$/i.exec(name)
    if (!m) continue
    let tae: Tae
    try {
      tae = readTae(data)
    } catch {
      continue
    }
    const group = Number(m[1])
    for (const anim of tae.animations) {
      for (const ev of anim.events) {
        const spec = BEHAVIOR_EVENTS[ev.type]
        if (!spec || ev.params.length < spec.judgeAt + 4) continue
        const judge = ev.params.readInt32LE(spec.judgeAt)
        if (judge < 0) continue
        const list = index.get(judge) ?? []
        list.push({
          animation: animationName(group, anim.id),
          event: spec.name,
          start: ev.start,
          end: ev.end,
          dummyPoly: spec.dummyPolyAt !== undefined ? ev.params.readInt32LE(spec.dummyPolyAt) : undefined,
        })
        index.set(judge, list)
      }
    }
  }
  return index
}
