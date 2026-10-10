/**
 * The player character for the animation viewport: skeleton, animation clips
 * and equipment models, prepared for the renderer.
 *
 *   chr/c0000.anibnd.dcx            Skeleton.hkx (150 bones) and the TAEs
 *   chr/c0000_a*.anibnd.dcx         animation .hkx files per category group,
 *                                   each binder with a type compendium
 *   parts/{hd,bd,am,lg}_{m,f}_NNNN  armor (skinned FLVER + TPF)
 *   parts/wp_a_NNNN                 weapons (rigid FLVER + TPF)
 *
 * Armor files carry only part of the skeleton's bone chain, so skinning binds
 * against the skeleton's reference pose; bones only the armor has (cloth,
 * straps) move with their nearest skeleton ancestor.
 */
import { entryFileName, findEntry, readBnd4, type Bnd4 } from '../formats/bnd4.ts'
import { dcxDecompress } from '../formats/dcx.ts'
import { readFlver, type Flver } from '../formats/flver.ts'
import { readCompendium, readTagfile, type Compendium, type Tagfile } from '../formats/havok/tagfile.ts'
import { readAnimation, type AnimationClip } from '../formats/havok/animation.ts'
import { readSkeleton, type Bone } from '../formats/havok/skeleton.ts'
import { decodeDds, downscale, readTpf, type Image } from '../formats/textures.ts'
import { BoundedMap } from '../../shared/collections.ts'

/** Reads a game-relative file (the project's copy first); null if missing. */
export type FileReader = (rel: string) => Buffer | null

export interface SampledClip {
  file: string
  frames: number
  frameDuration: number
  duration: number
  /** Bone index per track. */
  tracks: number[]
  /** [frame][track][tx ty tz rx ry rz rw sx sy sz] */
  data: Float32Array
  /** [frame][x y z yaw], when the animation moves the character. */
  root: Float32Array | null
}

export class AnimationFiles {
  private read: FileReader
  private binders: string[]
  /** hkx file name (lower case, no folder) -> binder. */
  private index: Map<string, string> | null = null
  /** Binders kept open (2-30 MB each). */
  private open = new BoundedMap<string, { bnd: Bnd4; compendium?: Compendium }>(4)
  private skel: Bone[] | null = null
  /** The binder with the skeleton (chr/cXXXX.anibnd.dcx). */
  private skeletonBinder: string

  constructor(read: FileReader, binders: string[], skeletonBinder = 'chr/c0000.anibnd.dcx') {
    this.read = read
    // a00 comes in hi/md/lo detail; prefer hi so its files win the index.
    this.binders = [...binders].sort((a, b) => rank(a) - rank(b))
    this.skeletonBinder = skeletonBinder
  }

  skeleton(): Bone[] {
    if (this.skel) return this.skel
    const raw = this.read(this.skeletonBinder)
    if (!raw) throw new Error(`${this.skeletonBinder} not found`)
    const bnd = readBnd4(dcxDecompress(raw).data)
    const e = bnd.entries.find((x) => /skeleton\.hkx$/i.test(x.name))
    if (!e) throw new Error(`${this.skeletonBinder.split('/').pop()} has no Skeleton.hkx`)
    this.skel = readSkeleton(readTagfile(e.data))
    return this.skel
  }

  /** An animation file's tagfile and the type compendium of its binder (for writing a new file like it). */
  tagfile(hkx: string): { tf: Tagfile; compendium?: Compendium; binder: string } {
    const name = hkx.toLowerCase()
    const rel = this.buildIndex().get(name)
    if (!rel) throw new Error(`${hkx} isn’t in any animation binder`)
    const { bnd, compendium } = this.binder(rel)
    const e = findEntry(bnd, name)!
    return { tf: readTagfile(e.data, compendium), compendium, binder: rel }
  }

  /** Forgets cached binders (after the project wrote new animation files). */
  reset(): void {
    this.index = null
    this.open.clear()
  }

  private binder(rel: string): { bnd: Bnd4; compendium?: Compendium } {
    let b = this.open.get(rel)
    if (b) return b
    const raw = this.read(rel)
    if (!raw) throw new Error(`${rel} not found`)
    const bnd = readBnd4(dcxDecompress(raw).data)
    const c = bnd.entries.find((x) => x.name.toLowerCase().endsWith('.compendium'))
    b = { bnd, compendium: c ? readCompendium(c.data) : undefined }
    this.open.set(rel, b)
    return b
  }

  private buildIndex(): Map<string, string> {
    if (this.index) return this.index
    const index = new Map<string, string>()
    for (const rel of this.binders) {
      let bnd: Bnd4
      try {
        bnd = this.binder(rel).bnd
      } catch {
        continue
      }
      for (const e of bnd.entries) {
        const name = entryFileName(e)
        if (name.endsWith('.hkx') && !index.has(name)) index.set(name, rel)
      }
    }
    this.index = index
    return index
  }

  has(hkx: string): boolean {
    return this.buildIndex().has(hkx.toLowerCase())
  }

  /** Decodes `aXXX_YYYYYY.hkx` and samples every frame. */
  clip(hkx: string): SampledClip {
    const name = hkx.toLowerCase()
    const rel = this.buildIndex().get(name)
    if (!rel) throw new Error(`${hkx} isn’t in any c0000 animation binder`)
    const { bnd, compendium } = this.binder(rel)
    const e = findEntry(bnd, name)!
    return sampleClip(readAnimation(readTagfile(e.data, compendium)), rel)
  }
}

function rank(rel: string): number {
  if (/_a00_hi/i.test(rel)) return 0
  if (/_a00_(md|lo)/i.test(rel)) return 2
  return 1
}

export function sampleClip(clip: AnimationClip, file: string): SampledClip {
  const frames = Math.max(1, clip.numFrames)
  const n = clip.trackCount
  const data = new Float32Array(frames * n * 10)
  const t = new Float32Array(n * 3)
  const r = new Float32Array(n * 4)
  const s = new Float32Array(n * 3)
  for (let f = 0; f < frames; f++) {
    clip.sample(f * clip.frameDuration, t, r, s)
    for (let i = 0; i < n; i++) {
      const o = (f * n + i) * 10
      data[o] = t[i * 3]
      data[o + 1] = t[i * 3 + 1]
      data[o + 2] = t[i * 3 + 2]
      data[o + 3] = r[i * 4]
      data[o + 4] = r[i * 4 + 1]
      data[o + 5] = r[i * 4 + 2]
      data[o + 6] = r[i * 4 + 3]
      data[o + 7] = s[i * 3]
      data[o + 8] = s[i * 3 + 1]
      data[o + 9] = s[i * 3 + 2]
    }
  }
  let root: Float32Array | null = null
  if (clip.rootMotion) {
    root = new Float32Array(frames * 4)
    for (let f = 0; f < frames; f++) root.set(clip.rootMotion(f * clip.frameDuration), f * 4)
  }
  return {
    file,
    frames,
    frameDuration: clip.frameDuration,
    duration: clip.duration,
    tracks: clip.trackToBone,
    data,
    root,
  }
}

/* --------------------------------- models -------------------------------- */
export interface PartMesh {
  positions: Float32Array
  normals: Float32Array | null
  uvs: Float32Array | null
  indices: Uint32Array
  /** Skinned: four skeleton bone indices and weights per vertex. */
  skinIndex: Uint16Array | null
  skinWeight: Float32Array | null
  /** Rigid meshes (weapons): the skeleton bone they ride on. */
  bone: number
  /** Weapons: the weapon's own bone the mesh hangs on (a katana's Sword or Case), which its animations move. */
  ownBone: string | null
  albedo: string | null
  /** Tangent-space normal (xyz rebuilt from the game's two-channel normal). */
  normalMap: string | null
  /** three.js packing: G roughness (from the normal map's gloss), B metalness (from _m). */
  ormMap: string | null
  /** Material asks for alpha testing (hair, cloth edges, fur). */
  alphaTest: boolean
  material: string
}

export interface Part {
  name: string
  meshes: PartMesh[]
  /** Texture images by name, decoded and downscaled. */
  textures: Map<string, Image>
  dummies: Flver['dummies']
}

/**
 * Builds a part for the viewport. `attach` names the skeleton bone rigid
 * parts follow (weapons: R_Weapon / L_Weapon).
 */
/**
 * A parts file's models: WP_A_0550.flver is model 0, WP_A_0550_1.flver model
 * 1 (a weapon's scabbard, or the second of a pair), and so on.
 */
export function partModels(bnd: { entries: { name: string; data: Buffer }[] }): { index: number; data: Buffer }[] {
  const out: { index: number; data: Buffer }[] = []
  for (const e of bnd.entries) {
    const base = entryFileName(e)
    if (!base.endsWith('.flver')) continue
    const m = /_(\d)\.flver$/.exec(base)
    out.push({ index: m ? Number(m[1]) : 0, data: e.data })
  }
  return out.sort((a, b) => a.index - b.index)
}

/**
 * `samplers`: a material's textures from its MATBIN (by the FLVER material's
 * mtd path). Elden Ring's FLVERs leave texture paths empty; without this
 * every mesh takes the part's first `_a` texture, which is right for armour
 * (one set per piece) and wrong for a character with many materials (a
 * cloak, a body and a cane would share one texture).
 */
export function buildPart(
  name: string,
  partsbnd: Buffer,
  skeleton: Bone[],
  extraTpfs: Buffer[] = [],
  attach = 'R_Weapon',
  maxTexture = 1024,
  rigid = /^wp_/i.test(name),
  model = 0,
  samplers?: (mtd: string) => { type: string; path: string }[],
): Part {
  const bnd = readBnd4(dcxDecompress(partsbnd).data)
  const models = partModels(bnd)
  const flEntry = models.find((m) => m.index === model) ?? (model === 0 ? models[0] : undefined)
  if (!flEntry) throw new Error(`${name} has no model ${model}`)
  const fl = readFlver(flEntry.data)

  // Textures by lower-case name, from the part's TPFs and any shared ones.
  const tpfs = [...bnd.entries.filter((e) => e.name.toLowerCase().endsWith('.tpf')).map((e) => e.data), ...extraTpfs]
  const texByName = new Map<string, Buffer>()
  for (const t of tpfs) {
    try {
      for (const tex of readTpf(t))
        if (!texByName.has(tex.name.toLowerCase())) texByName.set(tex.name.toLowerCase(), tex.dds)
    } catch {
      /* skip unreadable TPF */
    }
  }

  // FLVER bone -> skeleton bone (by name, else the nearest ancestor that has one).
  const skelIndex = new Map(skeleton.map((b, i) => [b.name, i]))
  const toSkel = fl.bones.map(() => -2)
  const resolve = (i: number, depth = 0): number => {
    if (i < 0 || i >= fl.bones.length || depth > 64) return 0
    if (toSkel[i] !== -2) return toSkel[i]
    const own = skelIndex.get(fl.bones[i].name)
    toSkel[i] = own ?? resolve(fl.bones[i].parent, depth + 1)
    return toSkel[i]
  }
  fl.bones.forEach((_, i) => resolve(i))
  const attachBone = skelIndex.get(attach) ?? 0

  const textures = new Map<string, Image>()
  const texture = (paths: string[], suffixes: RegExp): string | null => {
    for (const p of paths) {
      const base = p
        .split(/[\\/]/)
        .pop()!
        .replace(/\.[^.]+$/, '')
        .toLowerCase()
      if (!suffixes.test(base)) continue
      const dds = texByName.get(base)
      if (!dds) continue
      if (!textures.has(base)) {
        try {
          textures.set(base, downscale(decodeDds(dds, maxTexture), maxTexture))
        } catch {
          continue
        }
      }
      return base
    }
    return null
  }

  // The part's own textures, its exact name first (BD_M_1500_a before BD_M_1500_1_a).
  const own = [...texByName.keys()].filter((k) => k.startsWith(name.toLowerCase())).sort((a, b) => a.length - b.length)
  /**
   * Elden Ring's _n textures hold the normal in R/G and gloss in B; _m is a
   * metal mask. Builds a full normal map and a roughness/metalness map.
   */
  const surfaces = new Map<string, { normalMap: string; ormMap: string }>()
  const surface = (n: string | null): { normalMap: string | null; ormMap: string | null } => {
    if (!n) return { normalMap: null, ormMap: null }
    const hit = surfaces.get(n)
    if (hit) return hit
    const src = textures.get(n)!
    const metalName = n.replace(/_n$/, '_m')
    let metal: Image | null = null
    const metalDds = texByName.get(metalName)
    if (metalDds) {
      try {
        metal = decodeDds(metalDds, maxTexture)
      } catch {
        metal = null
      }
    }
    const { width: w, height: h } = src
    const normal = new Uint8Array(w * h * 4)
    const orm = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      const x = src.rgba[i * 4] / 127.5 - 1
      const y = src.rgba[i * 4 + 1] / 127.5 - 1
      const z = Math.sqrt(Math.max(0, 1 - x * x - y * y))
      normal[i * 4] = src.rgba[i * 4]
      normal[i * 4 + 1] = src.rgba[i * 4 + 1]
      normal[i * 4 + 2] = Math.round((z * 0.5 + 0.5) * 255)
      normal[i * 4 + 3] = 255
      orm[i * 4] = 255
      orm[i * 4 + 1] = 255 - src.rgba[i * 4 + 2]
      let m = 0
      if (metal) {
        const mx = Math.min(metal.width - 1, Math.floor(((i % w) / w) * metal.width))
        const my = Math.min(metal.height - 1, Math.floor((Math.floor(i / w) / h) * metal.height))
        m = metal.rgba[(my * metal.width + mx) * 4]
      }
      orm[i * 4 + 2] = m
      orm[i * 4 + 3] = 255
    }
    textures.set(n, { width: w, height: h, rgba: normal })
    textures.set(`${n}_orm`, { width: w, height: h, rgba: orm })
    const out = { normalMap: n, ormMap: `${n}_orm` }
    surfaces.set(n, out)
    return out
  }

  // A rigid mesh whose vertices ride on different bones becomes one mesh per
  // bone, so each piece can follow its own bone (a katana's scabbard shell).
  const pieces = rigid ? fl.meshes.flatMap((m) => splitByBone(m)) : fl.meshes
  const meshes: PartMesh[] = pieces.map((m) => {
    // The material's own textures: its FLVER paths, else its MATBIN's (albedo first).
    const given = m.material.textures.map((t) => t.path).filter(Boolean)
    const fromMatbin = given.length || !samplers ? [] : samplers(m.material.mtd)
    const paths = given.length
      ? given
      : [...fromMatbin.filter((s) => /albedo/i.test(s.type)), ...fromMatbin.filter((s) => !/albedo/i.test(s.type))].map(
          (s) => s.path,
        )
    let skinIndex: Uint16Array | null = null
    // Weapons ride on the hand as one piece, even when (like many custom
    // models) their meshes are weighted to the weapon's own bones: those
    // bones aren't in the character skeleton, and the vertices are already
    // in the weapon's model space.
    const skinned = m.dynamic && !rigid
    if (skinned && m.boneIndices) {
      skinIndex = new Uint16Array(m.boneIndices.length)
      for (let k = 0; k < skinIndex.length; k++) skinIndex[k] = Math.max(0, toSkel[m.boneIndices[k]] ?? 0)
    }
    return {
      positions: m.positions,
      normals: m.normals,
      uvs: m.uvs,
      indices: m.indices,
      skinIndex,
      skinWeight: skinned ? m.boneWeights : null,
      bone: skinned ? -1 : attachBone,
      ownBone: rigid ? ownBoneOf(fl, m) : null,
      // Elden Ring's part FLVERs leave texture paths empty (materials come from
      // MATBINs); each part has its own set named after it, e.g. BD_M_1500_a.
      albedo: texture(paths, /_a$/) ?? texture(paths, /_a\d*$|albedo|_d$/) ?? texture(own, /_a$/),
      ...surface(texture(paths, /_n$/) ?? texture(own, /_n$/)),
      alphaTest: /\[(alp|alpha|edge)\]|_alp|_edge|hair|fur/i.test(`${m.material.mtd} ${m.material.name}`),
      material: m.material.name,
    }
  })
  return { name, meshes, textures, dummies: fl.dummies }
}

/**
 * One mesh per bone, for a static mesh whose vertices name different bones
 * (FlverMesh.vertexBones): each triangle goes with its first vertex's bone.
 */
function splitByBone(m: Flver['meshes'][number]): Flver['meshes'][number][] {
  const vb = m.vertexBones
  if (!vb) return [m]
  const groups = new Map<number, number[]>()
  for (let t = 0; t + 2 < m.indices.length; t += 3) {
    const b = vb[m.indices[t]]
    let g = groups.get(b)
    if (!g) groups.set(b, (g = []))
    g.push(m.indices[t], m.indices[t + 1], m.indices[t + 2])
  }
  if (groups.size < 2) return [{ ...m, defaultBone: groups.keys().next().value ?? m.defaultBone, vertexBones: null }]
  const out: Flver['meshes'][number][] = []
  for (const [bone, tris] of groups) {
    const remap = new Map<number, number>()
    for (const i of tris) if (!remap.has(i)) remap.set(i, remap.size)
    const take = (src: Float32Array | null, dims: number): Float32Array | null => {
      if (!src) return null
      const out = new Float32Array(remap.size * dims)
      for (const [from, to] of remap) for (let k = 0; k < dims; k++) out[to * dims + k] = src[from * dims + k]
      return out
    }
    out.push({
      ...m,
      positions: take(m.positions, 3)!,
      normals: take(m.normals, 3),
      uvs: take(m.uvs, 2),
      indices: Uint32Array.from(tris, (i) => remap.get(i)!),
      defaultBone: bone,
      vertexBones: null,
    })
  }
  return out
}

/** The weapon bone a rigid mesh hangs on: its default bone, or the one most of its vertices are weighted to. */
function ownBoneOf(fl: Flver, m: Flver['meshes'][number]): string | null {
  let index = m.dynamic ? -1 : (m.defaultBone ?? -1)
  if (index < 0 && m.boneIndices) {
    const count = new Map<number, number>()
    for (let k = 0; k < m.boneIndices.length; k += 4)
      count.set(m.boneIndices[k], (count.get(m.boneIndices[k]) ?? 0) + 1)
    index = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1
  }
  return fl.bones[index]?.name ?? null
}

/** A weapon model's own animations (its partsbnd's anibnd), by name: what moves its bones. */
export interface WeaponAnimations {
  /** The weapon skeleton's bone names. */
  bones: string[]
  clips: Map<string, SampledClip>
}

/**
 * Weapons can carry a small skeleton and clips of their own. A katana's
 * model holds the blade and its scabbard on two bones: its default pose
 * (a999_000000) scales the scabbard to nothing, so only the blade shows in
 * the hand, and its skill clips (a614_…) show the scabbard while drawing.
 * Null when the weapon has none.
 */
export function readWeaponAnimations(partsbnd: Buffer, model = 0): WeaponAnimations | null {
  try {
    const bnd = readBnd4(dcxDecompress(partsbnd).data)
    // Each model has its own: WP_A_0550.anibnd for model 0, WP_A_0550_1.anibnd for model 1.
    const anibnds = bnd.entries.filter((e) => entryFileName(e).endsWith('.anibnd'))
    const entry =
      model > 0
        ? anibnds.find((e) => entryFileName(e).endsWith(`_${model}.anibnd`))
        : (anibnds.find((e) => !/_\d\.anibnd$/.test(entryFileName(e))) ?? anibnds[0])
    if (!entry) return null
    const inner = readBnd4(entry.data[0] === 0x44 ? dcxDecompress(entry.data).data : entry.data)
    const comp = inner.entries.find((e) => entryFileName(e).endsWith('.compendium'))
    const compendium = comp ? readCompendium(comp.data) : undefined
    const skel = inner.entries.find((e) => entryFileName(e) === 'skeleton.hkx')
    if (!skel) return null
    const bones = readSkeleton(readTagfile(skel.data, compendium)).map((b) => b.name)
    const clips = new Map<string, SampledClip>()
    for (const e of inner.entries) {
      const name = entryFileName(e)
      if (!/^a\d+_\d+\.hkx$/.test(name)) continue
      try {
        clips.set(name.replace(/\.hkx$/, ''), sampleClip(readAnimation(readTagfile(e.data, compendium)), name))
      } catch {
        /* skip a clip that doesn't read */
      }
    }
    return clips.size ? { bones, clips } : null
  } catch {
    return null
  }
}

/** Part file names for an armor piece: `bd_m_1810`, falling back across genders. */
export function armorPartNames(slot: 'hd' | 'bd' | 'am' | 'lg', modelId: number, female: boolean): string[] {
  const id = String(modelId).padStart(4, '0')
  return female ? [`${slot}_f_${id}`, `${slot}_m_${id}`] : [`${slot}_m_${id}`, `${slot}_f_${id}`]
}

export function weaponPartName(modelId: number): string {
  return `wp_a_${String(modelId).padStart(4, '0')}`
}
