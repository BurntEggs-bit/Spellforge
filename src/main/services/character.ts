/**
 * The animation viewport's character: skeleton, decoded animation clips and
 * equipment models, read from the project (its copies first) or the game.
 * Read-only: nothing here writes files.
 */
import type { Project } from '../../core/project/project.ts'
import type { ParamDatabase } from '../../core/params/paramDb.ts'
import {
  readWeaponAnimations,
  AnimationFiles,
  armorPartNames,
  buildPart,
  partModels,
  weaponPartName,
  type Part,
  sampleClip,
} from '../../core/animation/character.ts'
import { readBnd4 } from '../../core/formats/bnd4.ts'
import { dcxDecompress } from '../../core/formats/dcx.ts'
import { readFlver, type FlverBone } from '../../core/formats/flver.ts'
import { encodePng } from '../../core/formats/textures.ts'
import { readAnimation } from '../../core/formats/havok/animation.ts'
import { type Bone } from '../../core/formats/havok/skeleton.ts'
import type { AnimationService } from './animations.ts'
import { taeSoundNames } from './sounds.ts'
import { retarget } from '../../core/animation/retarget.ts'
import { dummyLocation, dummySourceOf, parseDummyId, type WeaponHand } from '../../core/animation/dummies.ts'
import { readTagfile } from '../../core/formats/havok/tagfile.ts'
import type * as A from '../../shared/api.ts'
import { animationName } from '../../shared/animIds.ts'
import { behaviorRowFor } from '../../core/params/behaviorIds.ts'
import { isPlaceholderName } from '../../core/project/text.ts'
import { BoundedMap } from '../../shared/collections.ts'

type DummySide = A.DummySource

/**
 * A character holds one effect per slot (the SlotID of an effect event): an
 * effect spawned into a slot another one still holds ends that one, so two
 * effects an animation spawns at once into one slot show as one in game (a
 * duplicated effect event keeps its original's slot, so only one of the two
 * shows). Which one stays when both start together isn't known; here the
 * later event in the list does. Both are noted.
 */
function shareSlots(actions: A.SimAction[]): A.SimAction[] {
  const holder = new Map<number, A.SimAction>()
  const order = actions
    .filter((a) => a.kind === 'ffx' && a.effect?.slot !== undefined)
    .sort((x, y) => x.start - y.start)
  for (const a of order) {
    const slot = a.effect!.slot!
    const prev = holder.get(slot)
    if (prev && prev.end > a.start + 1e-4) {
      prev.end = Math.max(prev.start, a.start)
      prev.note = `Slot ${slot}: effect ${a.effect!.id} takes it at ${a.start.toFixed(2)} s and this one ends (one effect per slot)`
      a.note = `Slot ${slot}: takes it from effect ${prev.effect!.id} (one effect per slot)`
    }
    holder.set(slot, a)
  }
  return actions
}

/** Other characters' events and behavior rows (EnemyService), for their animations in the viewport. */
export interface OtherCharacters {
  motionHkx(chr: string, name: string): string
  anim(chr: string, name: string): A.AnimationView
  behaviorRow(judge: number, variation: number): number | null
  defaultVariation(chr: string): number
}

/**
 * The bones a player attack animation moves (Lion's Claw's 42): the body,
 * not the fingers, which come from the category's grip pose.
 */
export const PLAYER_TRACKS = [
  'Master',
  'RootPos',
  'Pelvis',
  'L_Thigh',
  'L_Calf',
  'L_Foot',
  'L_Toe0',
  'L_Thigh_Skirt',
  'R_Thigh',
  'R_Calf',
  'R_Foot',
  'R_Toe0',
  'R_Thigh_Skirt',
  'RootRotY',
  'RootRotXZ',
  'Spine',
  'Spine1',
  'Spine2',
  'L_Axilla',
  'L_Clavicle',
  'L_ShoulderArmor',
  'L_UpperArm',
  'L_Forearm',
  'L_Hand',
  'L_Weapon',
  'L_UpArmTwist',
  'L_Collar',
  'L_Pectoral',
  'Neck',
  'Head',
  'R_Axilla',
  'R_Clavicle',
  'R_ShoulderArmor',
  'R_UpperArm',
  'R_Forearm',
  'R_Hand',
  'R_Weapon',
  'R_UpArmTwist',
  'R_Collar',
  'R_Pectoral',
  'SpineArmor1',
  'SpineArmor2',
]

const b64 = (a: ArrayBufferView | null) =>
  a ? Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64') : null

export class CharacterService {
  private project: Project
  private db: ParamDatabase
  private anims: AnimationService
  private files: AnimationFiles
  private parts = new BoundedMap<string, A.PartView>(24)
  private clips = new BoundedMap<string, A.ClipView>(40)
  private refWorld: number[][] | null = null

  private projectState: (param: string, id: number) => A.ProjectState

  /** A material's textures from its MATBIN (the session's index of the game's materials). */
  private samplers?: (mtd: string) => { type: string; path: string }[]

  setMaterials(samplers: (mtd: string) => { type: string; path: string }[]): void {
    this.samplers = samplers
  }

  /** A row's name as players see it (the session's: the project's text first). */
  displayName: (param: string, id: number) => string = (param, id) => this.db.rowName(param, id)

  constructor(
    project: Project,
    db: ParamDatabase,
    anims: AnimationService,
    projectState: (param: string, id: number) => A.ProjectState = () => null,
  ) {
    this.project = project
    this.db = db
    this.anims = anims
    this.projectState = projectState
    const read = (rel: string) => {
      const r = project.resolve(rel)
      return r ? project.read(rel).data : null
    }
    const binders = project.list('chr', /^c0000_.*\.anibnd\.dcx$/i).map((p) => p.replace(/\\/g, '/'))
    this.files = new AnimationFiles(read, binders)
  }

  private others: OtherCharacters | null = null
  /** Other characters' animation binders (chr/cXXXX.anibnd + cXXXX_divNN.anibnd). */
  private rigs = new BoundedMap<string, { files: AnimationFiles; ref: M[] | null }>(4)

  setOthers(o: OtherCharacters): void {
    this.others = o
  }

  private requireOthers(): OtherCharacters {
    if (!this.others) throw new Error('Other characters are not available')
    return this.others
  }

  private rigOf(chr: string): { files: AnimationFiles; ref: M[] | null } {
    if (!/^c\d{4}$/i.test(chr)) throw new Error(`Not a character model: ${chr}`)
    const hit = this.rigs.get(chr)
    if (hit) return hit
    const read = (rel: string) => (this.project.resolve(rel) ? this.project.read(rel).data : null)
    const binders = this.project
      .list('chr', new RegExp(`^${chr}(_div\\d+)?\\.anibnd\\.dcx$`, 'i'))
      .map((p) => p.replace(/\\/g, '/'))
    const rig = { files: new AnimationFiles(read, binders, `chr/${chr}.anibnd.dcx`), ref: null }
    this.rigs.set(chr, rig)
    return rig
  }

  /** The animation files of a character (c0000: the player). */
  filesOf(chr = 'c0000'): AnimationFiles {
    return chr === 'c0000' ? this.files : this.rigOf(chr).files
  }

  skeleton(chr = 'c0000'): A.SkeletonView {
    return {
      bones: this.filesOf(chr)
        .skeleton()
        .map((b) => ({ name: b.name, parent: b.parent, t: b.t, r: b.r, s: b.s })),
    }
  }

  /** The .hkx an animation plays: its own, or the one it references. */
  private hkxFor(animation: string): string {
    let name = animation
    for (let hops = 0; hops < 8; hops++) {
      const v = this.anims.view(name)
      if (v.motion === 'full' && v.source && v.source !== name) {
        name = v.source
        continue
      }
      const file = (v.motionFile || `${name}.hkt`).replace(/\.hk[tx]$/i, '')
      // The game finds a motion by its animation's id; a mod's TAE may name the
      // entry anything (Sacred Arsenal's "Sacred Arsenal"): then the id's file.
      const byId = v.motion === 'motion' && v.source ? v.source : name
      if (!this.files.has(`${file}.hkx`) && !this.anims.pendingMotion(`${file}.hkx`) && this.files.has(`${byId}.hkx`))
        return `${byId}.hkx`
      return `${file}.hkx`
    }
    return `${animation}.hkx`
  }

  clip(animation: string, chr = 'c0000', retargeted?: A.RetargetRequest): A.ClipView {
    if (retargeted) return this.retargetedClip(animation, retargeted)
    if (chr !== 'c0000') return this.otherClip(chr, animation)
    return this.playerClip(animation)
  }

  /** Another character's animation as it plays on that character. */
  private otherClip(chr: string, animation: string): A.ClipView {
    const hkx = this.requireOthers().motionHkx(chr, animation)
    const key = `${chr}/${hkx}`.toLowerCase()
    const hit = this.clips.get(key)
    if (hit) return { ...hit, animation }
    const c = this.rigOf(chr).files.clip(hkx)
    const view: A.ClipView = {
      animation,
      hkx,
      binder: c.file,
      frames: c.frames,
      frameDuration: c.frameDuration,
      duration: c.duration,
      tracks: c.tracks,
      data: b64(c.data)!,
      root: b64(c.root),
      hand: null,
    }
    this.clips.set(key, view)
    return view
  }

  /**
   * Another character's animation fitted to the player (see retarget.ts): what
   * a skill made from it will look like.
   */
  retargetedMotion(animation: string, req: A.RetargetOptionsView & { chr: string }, trackNames = PLAYER_TRACKS) {
    const hkx = this.requireOthers().motionHkx(req.chr, animation)
    const files = this.rigOf(req.chr).files
    const src = files.clip(hkx)
    return retarget(
      {
        bones: files.skeleton(),
        frames: src.frames,
        frameDuration: src.frameDuration,
        tracks: src.tracks,
        data: src.data,
        root: src.root,
      },
      this.files.skeleton(),
      {
        mirror: req.mirror,
        upright: req.upright,
        travel: req.travel,
        trackNames,
      },
    )
  }

  private retargetedClip(animation: string, req: A.RetargetRequest): A.ClipView {
    const r = this.retargetedMotion(animation, req)
    // The fingers: the common grip pose, as a skill category's own would give.
    let hand: A.ClipView['hand'] = null
    try {
      const hc = this.files.clip('a000_000009.hkx')
      hand = { hkx: 'a000_000009.hkx', tracks: hc.tracks, data: b64(hc.data.subarray(0, hc.tracks.length * 10))! }
    } catch {
      /* no grip pose: open hands */
    }
    const hkx = this.requireOthers().motionHkx(req.chr, animation)
    return {
      animation,
      hkx: `${req.chr} ${hkx}`,
      binder: `${req.chr} (fitted to you)`,
      frames: r.frames,
      frameDuration: r.frameDuration,
      duration: (r.frames - 1) * r.frameDuration,
      tracks: r.tracks,
      data: b64(r.data)!,
      root: b64(r.root),
      hand,
    }
  }

  /** Drops a decoded clip (its file was just replaced). */
  forgetClip(hkx: string): void {
    this.clips.delete(hkx.toLowerCase())
  }

  private playerClip(animation: string): A.ClipView {
    const hkx = this.hkxFor(animation)
    const key = hkx.toLowerCase()
    const hit = this.clips.get(key)
    if (hit) return { ...hit, animation }
    // A file Spellforge made this session (a move fitted to the player) plays before it's saved.
    const pending = this.anims.pendingMotion(hkx)
    const c = pending
      ? sampleClip(readAnimation(readTagfile(pending.data, pending.compendium)), 'new in this project')
      : this.files.clip(hkx)
    // Hand grip pose: the category's own (aXXX_000009), else the common one.
    let hand: A.ClipView['hand'] = null
    const cat = /^a(\d{3})_/.exec(hkx)?.[1]
    for (const h of [`a${cat}_000009.hkx`, 'a000_000009.hkx']) {
      if (!cat || !this.files.has(h)) continue
      try {
        const hc = this.files.clip(h)
        // One frame is enough: grips are static poses.
        hand = { hkx: h, tracks: hc.tracks, data: b64(hc.data.subarray(0, hc.tracks.length * 10))! }
        break
      } catch {
        /* try the next */
      }
    }
    const view: A.ClipView = {
      animation,
      hkx,
      binder: c.file,
      frames: c.frames,
      frameDuration: c.frameDuration,
      duration: c.duration,
      tracks: c.tracks,
      data: b64(c.data)!,
      root: b64(c.root),
      hand,
    }
    this.clips.set(key, view)
    return view
  }

  /* ---------------------------------- models --------------------------------- */

  private skeletonRef(): number[][] {
    if (this.refWorld) return this.refWorld
    this.refWorld = referenceWorlds(this.files.skeleton())
    return this.refWorld
  }

  /** A part's model: 0 is the part itself; a weapon's model 1 is its scabbard or the second of a pair. */
  part(name: string, attach = 'R_Weapon', model = 0): A.PartView {
    const key = `${name.toLowerCase()}@${attach}#${model}`
    const hit = this.parts.get(key)
    if (hit) return hit
    let rel = `parts/${name.toLowerCase()}.partsbnd.dcx`
    // Most armor has no female model of its own: fall back to the shared one.
    if (!this.project.resolve(rel) && /_f_/i.test(name)) {
      name = name.replace(/_f_/i, '_m_')
      rel = `parts/${name.toLowerCase()}.partsbnd.dcx`
    }
    if (!this.project.resolve(rel)) throw new Error(`${name} isn’t in the game’s parts folder`)
    const raw = this.project.read(rel).data
    const shared: Buffer[] = []
    // Bodies, arms and legs share skin textures.
    if (/^(bd|am|lg|fc|hd)_/i.test(name) && this.project.resolve('parts/common_body.tpf.dcx')) {
      try {
        shared.push(dcxDecompress(this.project.read('parts/common_body.tpf.dcx').data).data)
      } catch {
        /* optional */
      }
    }
    const skel = this.files.skeleton()
    const part = buildPart(name, raw, skel, shared, attach, 1024, /^wp_/i.test(name), model, this.samplers)
    const view = this.toView(part, raw, skel, /^wp_/i.test(name), model)
    this.parts.set(key, view)
    return view
  }

  private bodyDummyBones: Map<number, string> | null = null
  /** The bone one of the player body's dummy polys rides (c0000's model): 20 R_Weapon, 21 L_Weapon, 220 Spine2… */
  bodyDummyBone(id: number): string | null {
    if (!this.bodyDummyBones) {
      const map = new Map<number, string>()
      try {
        const fl = readFlver(
          partModels(readBnd4(dcxDecompress(this.project.read('chr/c0000.chrbnd.dcx').data).data))[0].data,
        )
        for (const d of fl.dummies)
          if (!map.has(d.id) && d.attachBone >= 0 && fl.bones[d.attachBone]) map.set(d.id, fl.bones[d.attachBone].name)
      } catch {
        /* no body model: the dummies go unnamed */
      }
      this.bodyDummyBones = map
    }
    return this.bodyDummyBones.get(id) ?? null
  }

  /** c0000.chrbnd's model: the body's dummy polys. */
  body(chr = 'c0000'): A.PartView {
    const hit = this.parts.get(chr)
    if (hit) return hit
    if (chr !== 'c0000') return this.otherBody(chr)
    const raw = this.project.read('chr/c0000.chrbnd.dcx').data
    const skel = this.files.skeleton()
    const part = buildPart('c0000', raw, skel, [], 'R_Weapon', 1024, false, 0, this.samplers)
    const view = this.toView(part, raw, skel, false)
    this.parts.set('c0000', view)
    return view
  }

  /** Another character's whole model, skinned to its own skeleton, with its textures (cXXXX_h.texbnd). */
  private otherBody(chr: string): A.PartView {
    const rel = `chr/${chr}.chrbnd.dcx`
    if (!this.project.resolve(rel)) throw new Error(`${chr} has no model`)
    const raw = this.project.read(rel).data
    const rig = this.rigOf(chr)
    const skel = rig.files.skeleton()
    const tpfs: Buffer[] = []
    for (const t of [`chr/${chr}_h.texbnd.dcx`, `chr/${chr}.texbnd.dcx`, `chr/${chr}_l.texbnd.dcx`]) {
      if (!this.project.resolve(t)) continue
      try {
        for (const e of readBnd4(dcxDecompress(this.project.read(t).data).data).entries)
          if (/\.tpf$/i.test(e.name)) tpfs.push(e.data)
        break
      } catch {
        /* the next one */
      }
    }
    const part = buildPart(chr, raw, skel, tpfs, 'R_Weapon', 512, false, 0, this.samplers)
    rig.ref ??= referenceWorlds(skel)
    const view = this.toView(part, raw, skel, false, 0, rig.ref)
    this.parts.set(chr, view)
    return view
  }

  private toView(
    part: Part,
    raw: Buffer,
    skel: Bone[],
    rigid: boolean,
    model = 0,
    ref: M[] = this.skeletonRef(),
  ): A.PartView {
    const bnd = readBnd4(dcxDecompress(raw).data)
    const models = partModels(bnd)
    const fl = readFlver((models.find((m) => m.index === model) ?? models[0]).data)
    const skelIndex = new Map(skel.map((b, i) => [b.name, i]))
    const map = (i: number): number => {
      for (let k = i, n = 0; k >= 0 && k < fl.bones.length && n < 64; k = fl.bones[k].parent, n++) {
        const s = skelIndex.get(fl.bones[k].name)
        if (s !== undefined) return s
      }
      return -1
    }
    const attachBone = part.meshes.find((m) => m.bone >= 0)?.bone ?? skelIndex.get('R_Weapon') ?? 0
    const textures: Record<string, string> = {}
    for (const [k, img] of part.textures) textures[k] = `data:image/png;base64,${encodePng(img).toString('base64')}`
    // A weapon's bones are its own: never matched to the character skeleton.
    const bindWorlds = flverBindWorlds(fl.bones, (i) => (rigid ? -1 : (skelIndex.get(fl.bones[i].name) ?? -1)), ref)
    return {
      name: part.name,
      meshes: part.meshes.map((m) => ({
        positions: b64(m.positions)!,
        normals: b64(m.normals),
        uvs: b64(m.uvs),
        indices: b64(m.indices)!,
        skinIndex: b64(m.skinIndex),
        skinWeight: b64(m.skinWeight),
        bone: m.bone,
        ownBone: m.ownBone,
        albedo: m.albedo,
        normalMap: m.normalMap,
        ormMap: m.ormMap,
        alphaTest: m.alphaTest,
        material: m.material,
      })),
      textures,
      dummies: part.dummies.map((d) => ({
        id: d.id,
        // Weapons: a dummy relative to one of the weapon's bones is moved into the weapon's model space.
        ...(rigid && d.parentBone >= 0 && bindWorlds[d.parentBone]
          ? inBoneSpace(bindWorlds[d.parentBone], d)
          : { position: d.position, forward: d.forward, up: d.up }),
        // Rigid parts (weapons): positions are in the part's own space, which rides on the attach bone.
        bone: rigid ? attachBone : map(d.attachBone),
        space: rigid ? -2 : d.parentBone >= 0 ? map(d.parentBone) : -1,
      })),
      bones: fl.bones.map((b, i) => ({
        name: b.name,
        parent: b.parent,
        skeletonBone: rigid ? attachBone : map(i),
        glued: !skelIndex.has(b.name),
        bind: bindWorlds[i],
        // Its bounding box, when the model gives it one (min x y z, max x y z).
        ...(b.bbMin.every((v, k) => Number.isFinite(v) && v <= b.bbMax[k]) &&
        b.bbMax.some((v, k) => v - b.bbMin[k] > 1e-4) &&
        b.bbMax.every((v) => Math.abs(v) < 1e4)
          ? { box: [...b.bbMin, ...b.bbMax] }
          : {}),
      })),
      weaponAnim: rigid ? weaponAnimView(raw, model) : undefined,
      models: models.length,
    }
  }

  /**
   * Where the game puts a weapon's models (its absorpParamId's
   * WepAbsorpPosParam row): for each model, the body dummy poly for each way
   * of holding it. A katana in the right hand: model 0 at dummy 20 (the
   * hand), model 1 (the scabbard) at 2069, i.e. body dummy 69 on the hip.
   */
  /**
   * A character's hit capsule from its NpcParam row (hitRadius, hitHeight):
   * the player's is row 1 ("Human"), another character's its first row by
   * the id convention (c2130: 21300000…).
   */
  capsule(chr = 'c0000'): A.CapsuleView {
    let row: number
    if (chr === 'c0000') row = this.db.row('NpcParam', 1) ? 1 : 0
    else {
      const n = Number(chr.slice(1))
      row = this.db.get('NpcParam').param.rows.find((r) => Math.floor(r.id / 10000) === n)?.id ?? -1
    }
    const radius = row >= 0 && this.db.row('NpcParam', row) ? this.db.num('NpcParam', row, 'hitRadius') : 0.4
    const height = row >= 0 && this.db.row('NpcParam', row) ? this.db.num('NpcParam', row, 'hitHeight') : 1.5
    return { radius: radius > 0 ? radius : 0.4, height: height > 0 ? height : 1.5 }
  }

  placement(weapon: number): A.WeaponPlacement | null {
    const row = this.db.num('EquipParamWeapon', weapon, 'absorpParamId', -1)
    if (!this.db.hasRow('WepAbsorpPosParam', row)) return null
    const v = (f: string) => this.db.num('WepAbsorpPosParam', row, f, -1)
    const slots = [0, 1, 2, 3].map((i) => ({
      right: v(`right_${i}`),
      left: v(`left_${i}`),
      both: v(`both_${i}`),
      leftBoth: v(`leftBoth_${i}`),
      rightHang: v(`rightHang_${i}`),
      leftHang: v(`leftHang_${i}`),
      invisible: v(`wepInvisibleType_${i}`),
    }))
    // A passive effect with the "Hide Weapon" state (184, Unseen Blade's) hides it while held.
    const hidden = ['residentSpEffectId', 'residentSpEffectId1', 'residentSpEffectId2'].some((f) => {
      const sp = this.db.num('EquipParamWeapon', weapon, f, -1)
      return sp > 0 && this.db.num('SpEffectParam', sp, 'stateInfo') === 184
    })
    return { row, slots, ...(hidden ? { hidden } : {}) }
  }

  /* ------------------------------- simulation ------------------------------- */

  /**
   * BehaviorParam_PC row for a TAE judge and a weapon's behaviour variation.
   * Rows are category * 1e8 + variation * 1000 + judge % 1000 (judges of
   * 1000 and up carry the category in their thousands); a weapon without its
   * own row uses its base variation (hundreds), then 0.
   */
  behaviorRow(judge: number, variation: number): number | null {
    return behaviorRowFor(this.db, 'BehaviorParam_PC', judge, variation)
  }

  private attackHits(atk: number, weaponSide: DummySide, param = 'AtkParam_Pc'): A.SimHit[] {
    if (!this.db.row(param, atk)) return []
    // An enemy's dummies are all on its own model.
    const source: DummySide =
      param !== 'AtkParam_Pc' || this.db.num(param, atk, 'hitSourceType') === 1 ? 'body' : weaponSide
    const hits: A.SimHit[] = []
    for (let k = 0; k < 16; k++) {
      const r = this.db.num(param, atk, `hit${k}_Radius`)
      const d1 = this.db.num(param, atk, `hit${k}_DmyPoly1`)
      const d2 = this.db.num(param, atk, `hit${k}_DmyPoly2`)
      if (d1 < 0 || r <= 0) continue
      // A player attack's point given as a weapon id (10120) is on that weapon, whatever the row's source.
      const at = param === 'AtkParam_Pc' ? dummyLocation(d1, source) : { dummy: d1, source }
      const end = d2 >= 0 && param === 'AtkParam_Pc' ? dummyLocation(d2, source).dummy : d2
      hits.push({ dummy1: at.dummy, dummy2: end, radius: r, source: at.source, slot: k })
    }
    return hits
  }

  actions(
    animation: string,
    right: number | null,
    left: number | null,
    chr = 'c0000',
    variation?: number,
    spell?: number,
  ): A.SimAction[] {
    // Another character: its own events, behavior rows (BehaviorParam) and attacks (AtkParam_Npc), all on its model.
    const npc = chr !== 'c0000'
    // Entire spell: the spell its cast events cast (the player's only).
    const cast =
      !npc && spell !== undefined && this.db.row('Magic', spell)
        ? {
            id: spell,
            name: this.displayName('Magic', spell) || `Spell ${spell}`,
            sfx: [
              this.db.num('Magic', spell, 'castSfxId'),
              this.db.num('Magic', spell, 'fireSfxId'),
              this.db.num('Magic', spell, 'effectSfxId'),
            ],
          }
        : null
    const view = npc ? this.requireOthers().anim(chr, animation) : this.anims.view(animation)
    const npcVariation = npc ? (variation ?? this.requireOthers().defaultVariation(chr)) : 0
    const behaviorParam = npc ? 'BehaviorParam' : 'BehaviorParam_PC'
    const atkParam = npc ? 'AtkParam_Npc' : 'AtkParam_Pc'
    const variationOf = (w: number | null) =>
      w !== null && this.db.row('EquipParamWeapon', w) ? this.db.num('EquipParamWeapon', w, 'behaviorVariationId') : 0
    const field = (ev: A.AnimEventView, name: string) => ev.fields.find((f) => f.name === name)?.value
    const out: A.SimAction[] = []
    for (const ev of view.events) {
      const base = {
        event: ev.index,
        start: ev.start,
        end: ev.end,
        behavior: null,
        hits: [],
        bullet: null,
        bulletTable: {},
        effect: null,
      }
      // The spell's bullets: CastHighlightedMagic fires the Magic row's refId by its RefType (0-9:
      // refId1-10; refCategory 1 a bullet, 2 a SpEffect), from its dummy poly. Its flag at @4 keeps
      // it firing every shootInterval while the event lasts (Comet Azur's beam, Agheel's breath).
      if (cast && ev.type === 64) {
        const k = (field(ev, 'RefType') ?? 0) + 1
        const category = this.db.num('Magic', cast.id, `refCategory${k}`)
        const ref = this.db.num('Magic', cast.id, `refId${k}`)
        if (ref <= 0) continue
        if (category === 2) {
          out.push({
            ...base,
            kind: 'speffect',
            label: `${cast.name}: refId${k} → SpEffect ${ref}: ${this.db.rowName('SpEffectParam', ref)}`,
          })
          continue
        }
        const at = dummyLocation(field(ev, 'DummyPolyID') ?? -1, 'body')
        const { bullet, table } = this.bulletChain(ref, at.dummy, at.source, 'right', 'AtkParam_Pc')
        const repeat = (ev.fields.find((f) => f.offset === 4)?.value ?? 0) !== 0 && (bullet?.shootInterval ?? 0) > 0
        const chain = Object.keys(table).length - 1
        out.push({
          ...base,
          kind: 'bullet',
          bullet,
          bulletTable: table,
          ...(repeat ? { repeat: true } : {}),
          label: `${cast.name}: refId${k} → Bullet ${ref}${bullet?.name ? `: ${bullet.name}` : ''}${repeat ? `, every ${+bullet!.shootInterval.toFixed(2)} s` : ''}${chain > 0 ? ` (+${chain} chained)` : ''}`,
        })
        continue
      }
      // The spell's effects: SpawnFFX_GoodsAndMagic(EX), SFXIndexID 0 its cast, 1 fire, 2 effect sfx,
      // on the body (DummyPolySource 0) or a held weapon (1 left, 2 right).
      if (cast && (ev.type === 114 || ev.type === 115)) {
        const index = field(ev, 'SFXIndexID') ?? 0
        const fx = cast.sfx[index] ?? -1
        if (fx <= 0) continue
        const from = field(ev, 'DummyPolySource') ?? 0
        const source: DummySide = from === 2 ? 'right' : from === 1 ? 'left' : 'body'
        const dummy = field(ev, 'DummyPolyID') ?? -1
        const follow = (field(ev, 'IsFollowDummyPoly') ?? 1) !== 0
        out.push({
          ...base,
          kind: 'ffx',
          effect: { id: fx, dummy, source, follow },
          label: `${cast.name}: ${['cast effect', 'fire effect', 'effect'][index]} ${fx}${dummy >= 0 ? ` @ dummy ${dummy}` : ''}`,
        })
        continue
      }
      const judge = field(ev, 'BehaviorJudgeID')
      const kind: A.SimAction['kind'] | null =
        ev.type === 1
          ? 'attack'
          : ev.type === 2
            ? 'bullet'
            : ev.type === 5
              ? 'common'
              : ev.type === 304
                ? 'throw'
                : ev.type === 307
                  ? 'pc'
                  : null
      if (kind && judge !== undefined && judge >= 0) {
        // Source: 0 default (right hand), 1 force right, 2 force left.
        const src = npc ? 'body' : field(ev, 'Source') === 2 ? 'left' : 'right'
        const weapon = src === 'left' ? left : right
        const row = npc
          ? this.requireOthers().behaviorRow(judge, npcVariation)
          : this.behaviorRow(judge, variationOf(weapon))
        if (row === null) {
          out.push({
            ...base,
            kind,
            label: `judge ${judge}: no behaviour row for ${npc ? 'this character' : 'this weapon'}`,
            note: 'no behaviour row',
          })
          continue
        }
        const refType = this.db.num(behaviorParam, row, 'refType')
        const refId = this.db.num(behaviorParam, row, 'refId')
        const rowName = this.db.rowName(behaviorParam, row)
        if (refType === 0) {
          const hits = this.attackHits(refId, src, atkParam)
          out.push({
            ...base,
            kind,
            behavior: row,
            attack: refId,
            hits,
            label: `${rowName || `Behavior ${row}`} → Attack ${refId}${hits.length ? `, ${hits.length} hit${hits.length === 1 ? '' : 's'}` : ''}`,
          })
        } else if (refType === 1) {
          const dmy = field(ev, 'DummyPolyID') ?? -1
          const at = npc ? { dummy: dmy, source: 'body' as DummySide } : dummyLocation(dmy, 'body')
          const { bullet, table } = this.bulletChain(refId, at.dummy, at.source, src, atkParam)
          const chain = Object.keys(table).length - 1
          out.push({
            ...base,
            kind: 'bullet',
            behavior: row,
            bullet,
            bulletTable: table,
            label: `${rowName || `Behavior ${row}`} → Bullet ${refId}${bullet?.name ? `: ${bullet.name}` : ''}${chain > 0 ? ` (+${chain} chained)` : ''}`,
          })
        } else if (refType === 2) {
          out.push({
            ...base,
            kind: 'speffect',
            behavior: row,
            label: `${rowName || `Behavior ${row}`} → SpEffect ${refId}: ${this.db.rowName('SpEffectParam', refId)}`,
          })
        }
        continue
      }
      const sp = field(ev, 'SpEffectID')
      if (sp !== undefined && sp > 0) {
        // Its visual effect (SpEffectVfxParam midstSfxId at midstDmyId) plays while it's on.
        const vfx = this.db.row('SpEffectParam', sp) ? this.db.num('SpEffectParam', sp, 'vfxId') : -1
        const midst =
          vfx > 0 && this.db.row('SpEffectVfxParam', vfx) ? this.db.num('SpEffectVfxParam', vfx, 'midstSfxId') : -1
        const midstDummy = midst > 0 ? this.db.num('SpEffectVfxParam', vfx, 'midstDmyId') : -1
        out.push({
          ...base,
          kind: 'speffect',
          effect:
            midst > 0 ? { id: midst, dummy: midstDummy >= 0 ? midstDummy : 220, source: 'body', follow: true } : null,
          label: `${ev.typeName} ${sp}${this.db.rowName('SpEffectParam', sp) ? `: ${this.db.rowName('SpEffectParam', sp)}` : ''}${midst > 0 ? `, effect ${midst}` : ''}`,
        })
        continue
      }
      // Sounds: where they play (their dummy poly, or the body) and which sound event they are.
      const soundId = field(ev, 'SoundID')
      if (soundId !== undefined && soundId > 0 && /Sound/i.test(ev.typeName)) {
        const type = field(ev, 'SoundType') ?? 0
        const dmy = field(ev, 'DummyPolyID') ?? -1
        const at = npc ? { dummy: dmy, source: 'body' as DummySide } : dummyLocation(dmy, 'body')
        const names = taeSoundNames(type, soundId)
        out.push({
          ...base,
          kind: 'sound',
          sound: { id: soundId, type, name: names[0] ?? null, dummy: at.dummy, source: at.source },
          label: `${names[0] ?? `Sound ${soundId}`}${dmy >= 0 ? ` @ dummy ${dmy}` : ''}`,
        })
        continue
      }
      // A floor-determined effect's id picks from the floor material's effects, in game; it isn't an effect id.
      const fx = /FloorDetermined/i.test(ev.typeName)
        ? undefined
        : ev.fields.find((f) => f.link === 'effect' && f.value > 0)
      if (fx) {
        const dmy = field(ev, 'DummyPolyID') ?? -1
        const at = npc ? { dummy: dmy, source: 'body' as DummySide } : dummyLocation(dmy, 'body')
        // Follows the dummy poly unless the event says it stays where it spawned.
        const follow = (field(ev, 'IsFollowDummyPoly') ?? 1) !== 0 || /Blade|ForEventDuration|Body/i.test(ev.typeName)
        const slot = field(ev, 'SlotID') ?? -1
        out.push({
          ...base,
          kind: 'ffx',
          effect: { id: fx.value, dummy: at.dummy, source: at.source, follow, ...(slot >= 0 ? { slot } : {}) },
          label: `${ev.typeName} ${fx.value}${dmy >= 0 ? ` @ dummy ${dmy}` : ''}`,
        })
      }
    }
    return shareSlots(out)
  }

  /* ------------------------------- entire spell ------------------------------- */

  /** The spells cast with a category's animations: the category is 400 + their Magic refType. */
  spellsForCategory(category: number): { id: number; name: string }[] {
    if (category < 400) return []
    const out: { id: number; name: string }[] = []
    for (const r of this.db.get('Magic').param.rows) {
      if (this.db.num('Magic', r.id, 'refType') !== category - 400) continue
      const name = this.displayName('Magic', r.id)
      if (isPlaceholderName(name)) continue
      out.push({ id: r.id, name })
    }
    return out
  }

  /**
   * Entire spell: the spell's right-hand cast animations in the order the
   * behaviour graph plays them (see EntireSpellPlan), each cut where the game
   * moves on, and the catalyst it's cast with.
   */
  entireSpell(spell: number, right: number | null): A.EntireSpellPlan {
    if (!this.db.row('Magic', spell)) throw new Error(`Spell ${spell} doesn't exist`)
    const category = 400 + this.db.num('Magic', spell, 'refType')
    const views = new Map<number, A.AnimationView>()
    for (const id of [45000, 45010, 45011, 45012, 45020, 45030]) {
      try {
        views.set(id, this.anims.view(animationName(category, id)))
      } catch {
        /* not one of its casts */
      }
    }
    // A spell held (a loop, 045012) is released with 045011; otherwise 045011 is its quick cast.
    const order: [number, string][] = [
      [45000, 'launch'],
      [45010, 'cast'],
      ...(views.has(45012)
        ? ([
            [45012, 'held'],
            [45011, 'release'],
          ] as [number, string][])
        : ([[45011, 'quick cast']] as [number, string][])),
      [45020, '2nd cast'],
      [45030, '3rd cast'],
    ]
    const present = order.filter(([id]) => views.has(id))
    const flag = (v: A.AnimationView, type: number, field: string, value: number) =>
      v.events.find((e) => e.type === type && e.fields.find((f) => f.name === field)?.value === value)?.start ?? null
    const steps = present.map(([id, what], i) => {
      const v = views.get(id)!
      const next = present[i + 1]?.[0]
      // Launch hands over to the cast where its jump table 93 opens (129 of the game's 130 launches have it);
      // a cast followed by a chained one goes on where it can be cancelled into magic (ChrActionFlag 29).
      const to =
        id === 45000
          ? flag(v, 300, 'JumpTableID_ToActivateEarly', 93)
          : next === 45020 || next === 45030
            ? flag(v, 0, 'FlagType', 29)
            : null
      return { animation: v.name, to: to !== null && to > 0.05 ? to : null, what }
    })
    // Cast with what the right hand holds if it casts this kind of spell (staffs sorceries, seals incantations), else a Glintstone Staff or a Finger Seal.
    const incantation = this.db.num('Magic', spell, 'ezStateBehaviorType') === 1
    const can = (w: number | null): w is number =>
      w !== null &&
      !!this.db.row('EquipParamWeapon', w) &&
      this.db.num('EquipParamWeapon', w, incantation ? 'enableMiracle' : 'enableMagic') === 1
    const catalystId = can(right) ? right : incantation ? 34000000 : 33000000
    const catalyst = this.db.row('EquipParamWeapon', catalystId)
      ? { id: catalystId, name: this.displayName('EquipParamWeapon', catalystId) || `Weapon ${catalystId}` }
      : null
    return { spell, name: this.displayName('Magic', spell) || `Spell ${spell}`, steps, catalyst }
  }

  /** A bullet and the whole chain it can reach: hit bullets and interval bullets, theirs, and so on. */
  private bulletChain(
    id: number,
    dummy: number,
    source: DummySide,
    weaponSide: DummySide,
    atkParam: string,
  ): { bullet: A.SimBullet | null; table: Record<string, A.SimBullet> } {
    const bullet = this.bullet(id, dummy, source, weaponSide, atkParam)
    const table: Record<string, A.SimBullet> = {}
    const queue = bullet ? [bullet] : []
    while (queue.length && Object.keys(table).length < 24) {
      const b = queue.shift()!
      if (table[b.id]) continue
      table[b.id] = b
      for (const next of [b.hitBullet, b.intervalBullet]) {
        if (next > 0 && !table[next]) {
          const nb = this.bullet(next, -1, 'body', weaponSide, atkParam)
          if (nb) queue.push(nb)
        }
      }
    }
    return { bullet, table }
  }

  private bullet(
    id: number,
    dummy: number,
    source: DummySide,
    weaponSide: DummySide,
    atkParam = 'AtkParam_Pc',
  ): A.SimBullet | null {
    if (!this.db.row('Bullet', id)) return null
    const n = (f: string) => this.db.num('Bullet', id, f)
    const speed = n('initVellocity')
    const lifeField = n('life')
    const dist = n('dist')
    const life = lifeField > 0 ? lifeField : dist > 0 && speed > 0 ? dist / speed : 1
    const atk = n('atkId_Bullet')
    return {
      id,
      name: this.db.rowName('Bullet', id),
      dummy,
      source,
      speed,
      accel: n('accelInRange'),
      maxSpeed: n('maxVellocity'),
      life: Math.min(life, 20),
      gravity: n('gravityInRange'),
      radius: Math.max(0.05, n('hitRadius')),
      radiusMax: n('hitRadiusMax'),
      spreadTime: n('spreadTime'),
      count: Math.max(1, Math.min(32, n('numShoot'))),
      angle: n('shootAngle'),
      angleInterval: n('shootAngleInterval'),
      angleX: n('shootAngleXZ'),
      angleXInterval: n('shootAngleXInterval'),
      randomYaw: n('shootAngleYMaxRandom'),
      randomPitch: n('shootAngleXMaxRandom'),
      ownerAngle: n('isOwnerOverrideInitAngle') !== 0,
      penetrateMap: n('isPenetrateMap') !== 0,
      effect: n('sfxId_Bullet'),
      attack: atk > 0 ? atk : null,
      hits: atk > 0 ? this.attackHits(atk, weaponSide, atkParam) : [],
      hitEffect: n('sfxId_Hit'),
      hitBullet: n('HitBulletID'),
      intervalBullet: n('intervalCreateBulletId'),
      intervalMin: n('intervalCreateTimeMin'),
      intervalMax: n('intervalCreateTimeMax'),
      intervalWait: n('intervalCreateWaitTime'),
      minSpeed: n('minVellocity'),
      homingAngle: n('homingAngle'),
      autoHoming: n('isEnableAutoHoming') !== 0,
      homingStop: n('hormingStopRange'),
      emitPos: n('EmittePosType'),
      inheritSfx: n('isInheritSfxToChild') !== 0,
      inheritSpeed: n('isInheritSpeedToChild') !== 0,
      launchCondition: n('launchConditionType'),
      shootInterval: Math.max(0, n('shootInterval')),
    }
  }

  /* -------------------------------- equipment -------------------------------- */

  equipment(female: boolean): A.EquipmentLists {
    const out: A.EquipmentLists = { head: [], body: [], arms: [], legs: [], weapons: [], buffs: [] }
    const exists = (n: string) => !!this.project.resolve(`parts/${n}.partsbnd.dcx`)
    const seen = new Set<string>()
    try {
      const prot = this.db.get('EquipParamProtector')
      for (const r of prot.param.rows) {
        const name = this.db.rowName('EquipParamProtector', r.id)
        if (isPlaceholderName(name)) continue
        const v = (f: string) => this.db.num('EquipParamProtector', r.id, f)
        const model = v('equipModelId')
        const slots: ['head' | 'body' | 'arms' | 'legs', 'hd' | 'bd' | 'am' | 'lg', string][] = [
          ['head', 'hd', 'headEquip'],
          ['body', 'bd', 'bodyEquip'],
          ['arms', 'am', 'armEquip'],
          ['legs', 'lg', 'legEquip'],
        ]
        const project = !!this.projectState('EquipParamProtector', r.id)
        for (const [slot, prefix, flag] of slots) {
          if (!v(flag)) continue
          const part = armorPartNames(prefix, model, female).find(exists) ?? null
          const key = `${slot}:${name}`
          if (seen.has(key) && !project) continue
          seen.add(key)
          out[slot].push({ id: r.id, name, part, project, customModel: !!part && this.inProject(part) })
        }
      }
      for (const r of this.db.get('EquipParamWeapon').param.rows) {
        if (r.id % 10000 !== 0) continue
        const name = this.db.rowName('EquipParamWeapon', r.id)
        if (isPlaceholderName(name)) continue
        const model = this.db.num('EquipParamWeapon', r.id, 'equipModelId')
        const p = weaponPartName(model)
        const part = exists(p) ? p : null
        out.weapons.push({
          id: r.id,
          name,
          part,
          project: !!this.projectState('EquipParamWeapon', r.id),
          customModel: !!part && this.inProject(part),
          buffable: this.db.num('EquipParamWeapon', r.id, 'isEnhance') !== 0,
        })
      }
      // Items and spells that coat the weapon: their SpEffect draws an enchant effect on it.
      for (const r of this.db.get('EquipParamGoods').param.rows) {
        if (!this.buffEffects({ goods: r.id }, 'right').length) continue
        const name = this.db.rowName('EquipParamGoods', r.id)
        if (isPlaceholderName(name)) continue
        out.buffs.push({ id: r.id, name, project: !!this.projectState('EquipParamGoods', r.id) })
      }
      for (const r of this.db.get('Magic').param.rows) {
        if (!(['right', 'left'] as const).some((hand) => this.buffEffects({ spell: r.id }, hand).length)) continue
        const name = this.db.rowName('Magic', r.id)
        if (isPlaceholderName(name)) continue
        out.buffs.push({ id: r.id, name, project: !!this.projectState('Magic', r.id), spell: true })
      }
    } catch {
      /* params unavailable */
    }
    // The project's own items first, then alphabetical.
    for (const k of ['head', 'body', 'arms', 'legs', 'weapons', 'buffs'] as const)
      (out[k] as { project: boolean; name: string }[]).sort(
        (a, b) => Number(b.project) - Number(a.project) || a.name.localeCompare(b.name),
      )
    out.faceParts = this.faceParts(female)
    return out
  }

  /**
   * The bare head's parts, from the parts folder: faces (fc_m_ / fc_f_),
   * hair (hr_a_), and the face's other parts (fg_a_ by hundreds: 01 eyes and
   * mouth, 20 eyebrows, 30 beards, 50 accessories, 70 eyelashes, as their
   * models and materials show). FaceParam picks one of each for a face; the
   * low-detail copies (_l) are left out.
   */
  private faceParts(female: boolean): A.FacePartGroup[] {
    let files: string[] = []
    try {
      files = this.project.list('parts', /^(fc|fg|hr)_[amf]_\d{4}\.partsbnd\.dcx$/i).map((f) =>
        f
          .split(/[\\/]/)
          .pop()!
          .replace(/\.partsbnd\.dcx$/i, '')
          .toLowerCase(),
      )
    } catch {
      return []
    }
    const sex = female ? 'f' : 'm'
    const groups: [string, string, (n: string) => boolean][] = [
      [
        'face',
        'Face',
        (n) =>
          n.startsWith(`fc_${sex}_`) ||
          (female && n.startsWith('fc_m_') && !files.includes(n.replace('fc_m_', 'fc_f_'))),
      ],
      ['fg01', 'Eyes and mouth', (n) => /^fg_a_01\d\d$/.test(n)],
      ['hair', 'Hair', (n) => n.startsWith('hr_a_') && n !== 'hr_a_0000'],
      ['fg20', 'Eyebrows', (n) => /^fg_a_20\d\d$/.test(n) && n !== 'fg_a_2000'],
      ['fg30', 'Beard', (n) => /^fg_a_30\d\d$/.test(n) && n !== 'fg_a_3000'],
      ['fg70', 'Eyelashes', (n) => /^fg_a_70\d\d$/.test(n) && n !== 'fg_a_7000'],
      ['fg50', 'Accessories', (n) => /^fg_a_50\d\d$/.test(n) && n !== 'fg_a_5000'],
    ]
    return groups
      .map(([key, label, keep]) => ({ key, label, parts: files.filter(keep).sort() }))
      .filter((g) => g.parts.length)
  }

  /**
   * What an item's weapon buff draws on a hand's weapon: the item's SpEffect
   * (its left-hand one for the left), that SpEffect's VFX rows, and of those
   * the ones that coat the weapon. Each gives an effect, the weapon model it
   * coats (a pair's second blade has points of its own) and where each of its
   * coatings starts and ends (enchantStartDmyId, enchantEndDmyId).
   */
  private buffEffects(
    src: { goods?: number; spell?: number },
    hand: WeaponHand,
  ): { base: number; offset: boolean; source: DummySide; groups: number[]; ends: number[] }[] {
    return this.coatings(this.buffSpEffect(src, hand), hand)
  }

  /** The coatings a SpEffect's VFX rows draw on a hand's weapon (each from its enchant start points up the blade). */
  private coatings(
    sp: number,
    hand: WeaponHand,
  ): { base: number; offset: boolean; source: DummySide; groups: number[]; ends: number[] }[] {
    const v = (param: string, id: number, f: string) => this.db.num(param, id, f, -1)
    if (sp <= 0 || !this.db.row('SpEffectParam', sp)) return []
    const out: { base: number; offset: boolean; source: DummySide; groups: number[]; ends: number[] }[] = []
    for (const k of ['vfxId', 'vfxId1', 'vfxId2', 'vfxId3', 'vfxId4', 'vfxId5', 'vfxId6', 'vfxId7']) {
      const vfx = v('SpEffectParam', sp, k)
      if (vfx <= 0 || !this.db.row('SpEffectVfxParam', vfx)) continue
      const base = v('SpEffectVfxParam', vfx, 'midstSfxId')
      if (base <= 0) continue
      const offset = v('SpEffectVfxParam', vfx, 'isUseOffsetEnchantSfxSize') === 1
      // Each start is the first of a group of points up a blade (300, 301…);
      // its end the last (-1: as far as the numbers run on).
      const byModel = new Map<number, { groups: number[]; ends: number[] }>()
      for (let i = 0; i < 8; i++) {
        const start = parseDummyId(v('SpEffectVfxParam', vfx, `enchantStartDmyId_${i}`))
        if (start.on !== hand) continue
        const end = parseDummyId(v('SpEffectVfxParam', vfx, `enchantEndDmyId_${i}`))
        const model = byModel.get(start.model) ?? { groups: [], ends: [] }
        model.groups.push(start.point)
        model.ends.push(end.on === hand && end.model === start.model ? end.point : -1)
        byModel.set(start.model, model)
      }
      for (const [model, { groups, ends }] of byModel)
        out.push({ base, offset, source: dummySourceOf({ on: hand, model, point: 0 }), groups, ends })
    }
    return out
  }

  /**
   * The SpEffect a buff puts on a hand's weapon. An item: its own (refId_1
   * for the left hand). A spell: the SpEffect its refs name (refCategory 2),
   * on the hand that SpEffect is for (wepParamChange: 1 right, 2 left;
   * buff spells in the game are for the right-hand armament).
   */
  private buffSpEffect(src: { goods?: number; spell?: number }, hand: 'right' | 'left'): number {
    const v = (param: string, id: number, f: string) => this.db.num(param, id, f, -1)
    if (src.goods !== undefined) {
      if (!this.db.row('EquipParamGoods', src.goods) || v('EquipParamGoods', src.goods, 'refCategory') !== 2) return -1
      return v('EquipParamGoods', src.goods, hand === 'left' ? 'refId_1' : 'refId_default')
    }
    if (src.spell === undefined || !this.db.row('Magic', src.spell)) return -1
    for (let k = 1; k <= 10; k++) {
      if (v('Magic', src.spell, `refCategory${k}`) !== 2) continue
      const sp = v('Magic', src.spell, `refId${k}`)
      if (sp <= 0 || !this.db.row('SpEffectParam', sp)) continue
      const wep = v('SpEffectParam', sp, 'wepParamChange')
      if ((wep === 1 && hand === 'left') || (wep === 2 && hand === 'right')) continue
      return sp
    }
    return -1
  }

  /** The coating an item or spell puts on the held weapons, sized for each weapon (its Enchantment SFX Size). */
  buff(src: { goods?: number; spell?: number }, right: number | null, left: number | null): A.BuffRun[] {
    return this.coatHeld(right, left, (hand) => this.buffEffects(src, hand))
  }

  /**
   * The looks the held weapons carry themselves: each Passive SpEffect
   * (residentSpEffectId) that starts a SpEffect with a weapon buff's look
   * through its cycle (cycleOccurrenceSpEffectId), the Souls Modding wiki's
   * way to keep a weapon glowing. A passive lasting −1 never cycles, so it
   * shows nothing, as in game.
   *
   * Credit: the Souls Modding wiki ("apply an sfx permanently to a weapon").
   */
  ownLooks(right: number | null, left: number | null): A.BuffRun[] {
    const v = (param: string, id: number, f: string) => this.db.num(param, id, f, -1)
    return this.coatHeld(right, left, (hand, weapon) =>
      ['residentSpEffectId', 'residentSpEffectId1', 'residentSpEffectId2'].flatMap((f) => {
        const carrier = v('EquipParamWeapon', weapon, f)
        if (
          carrier <= 0 ||
          !this.db.row('SpEffectParam', carrier) ||
          v('SpEffectParam', carrier, 'effectEndurance') === -1
        )
          return []
        return this.coatings(v('SpEffectParam', carrier, 'cycleOccurrenceSpEffectId'), hand)
      }),
    )
  }

  /** Coatings on each held weapon, sized for it (its Enchantment SFX Size). */
  private coatHeld(
    right: number | null,
    left: number | null,
    coats: (
      hand: WeaponHand,
      weapon: number,
    ) => { base: number; offset: boolean; source: DummySide; groups: number[]; ends: number[] }[],
  ): A.BuffRun[] {
    const out: A.BuffRun[] = []
    for (const [hand, weapon] of [
      ['right', right],
      ['left', left],
    ] as const) {
      if (weapon === null || !this.db.row('EquipParamWeapon', weapon)) continue
      const size = this.db.num('EquipParamWeapon', weapon, 'enchantSfxSize') || 0
      for (const e of coats(hand, weapon)) {
        out.push({ effectId: e.offset ? e.base + size : e.base, groups: e.groups, ends: e.ends, source: e.source })
      }
    }
    return out
  }

  private inProject(part: string): boolean {
    return this.project.resolve(`parts/${part}.partsbnd.dcx`)?.source === 'project'
  }
}

/* ------------------------------------ math ----------------------------------- */
type M = number[]
const mul = (a: M, b: M): M => {
  const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return o
}
const T = (x: number, y: number, z: number): M => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
const S = (x: number, y: number, z: number): M => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]
const RX = (a: number): M => [1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1]
const RY = (a: number): M => [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1]
const RZ = (a: number): M => [Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const Q = (x: number, y: number, z: number, w: number): M => [
  1 - 2 * (y * y + z * z),
  2 * (x * y + z * w),
  2 * (x * z - y * w),
  0,
  2 * (x * y - z * w),
  1 - 2 * (x * x + z * z),
  2 * (y * z + x * w),
  0,
  2 * (x * z + y * w),
  2 * (y * z - x * w),
  1 - 2 * (x * x + y * y),
  0,
  0,
  0,
  0,
  1,
]

/** A dummy's position and axes carried through a bone's bind transform. */
function inBoneSpace(
  m: M,
  d: { position: number[]; forward: number[]; up: number[] },
): { position: number[]; forward: number[]; up: number[] } {
  const point = (v: number[]) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r])
  const dir = (v: number[]) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2])
  return { position: point(d.position), forward: dir(d.forward), up: dir(d.up) }
}

/** Skeleton reference pose, model space, column-major 4x4 per bone. */
function referenceWorlds(skel: Bone[]): M[] {
  const out: M[] = []
  const get = (i: number): M => {
    if (out[i]) return out[i]
    const b = skel[i]
    const local = mul(T(b.t[0], b.t[1], b.t[2]), mul(Q(b.r[0], b.r[1], b.r[2], b.r[3]), S(b.s[0], b.s[1], b.s[2])))
    out[i] = b.parent >= 0 ? mul(get(b.parent), local) : local
    return out[i]
  }
  skel.forEach((_, i) => get(i))
  return out
}

/**
 * FLVER bones' bind pose in model space: bones the skeleton has take its
 * reference pose; the rest hang off their parent with their own transform.
 * `exact(i)` is the skeleton bone with bone i's name, or -1.
 */
function flverBindWorlds(bones: FlverBone[], exact: (i: number) => number, ref: M[]): M[] {
  const out: M[] = []
  const get = (i: number, depth = 0): M => {
    if (out[i]) return out[i]
    const s = exact(i)
    if (s >= 0) return (out[i] = ref[s])
    const b = bones[i]
    const local = mul(
      T(b.t[0], b.t[1], b.t[2]),
      mul(RY(b.r[1]), mul(RZ(b.r[2]), mul(RX(b.r[0]), S(b.s[0], b.s[1], b.s[2])))),
    )
    out[i] = b.parent >= 0 && depth < 64 ? mul(get(b.parent, depth + 1), local) : local
    return out[i]
  }
  bones.forEach((_, i) => get(i))
  return out
}

/** A weapon's own clips for the viewport, or undefined when it has none. */
function weaponAnimView(partsbnd: Buffer, model = 0): A.WeaponAnimView | undefined {
  const w = readWeaponAnimations(partsbnd, model)
  if (!w) return undefined
  const clips: A.WeaponAnimView['clips'] = {}
  for (const [name, c] of w.clips) {
    clips[name] = {
      frames: c.frames,
      frameDuration: c.frameDuration,
      tracks: c.tracks,
      data: Buffer.from(c.data.buffer, c.data.byteOffset, c.data.byteLength).toString('base64'),
    }
  }
  return { bones: w.bones, clips }
}
