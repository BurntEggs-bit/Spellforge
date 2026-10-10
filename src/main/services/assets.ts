/**
 * Textures, models and lighting for the open project's effects and views: the asset browser,
 * model meshes, rigs and materials, thumbnails and menu icons, and the game's light probes.
 */
import { textureEntryPath, modelEntryPath, anibndEntryPath } from '../../core/effects/effects.ts'
import { readModelRig } from '../../core/effects/modelAnim.ts'
import { MatbinIndex } from '../../core/formats/matbin.ts'
import { readFlver, effectTextureFromPath } from '../../core/formats/flver.ts'
import { indexBehaviorInvocations, type BehaviorInvocation } from '../../core/formats/tae.ts'
import { readBnd4 } from '../../core/formats/bnd4.ts'
import { dcxDecompress } from '../../core/formats/dcx.ts'
import { tpfThumbnail } from '../../core/formats/textures.ts'
import { ENVIRONMENT_AREAS, TIME_NAMES, areaTimes, loadEnvironment } from '../../core/effects/environment.ts'
import { isIconKind } from './icons.ts'
import type * as A from '../../shared/api.ts'
import { judgeOfBehaviorRow } from '../../core/params/behaviorIds.ts'
import { BoundedMap } from '../../shared/collections.ts'
import type { Session } from '../session.ts'

export class AssetService {
  private readonly session: Session

  constructor(session: Session) {
    this.session = session
  }

  assets(resource: 'texture' | 'model', query: string): A.AssetEntry[] {
    const o = this.session.requireOpen()
    const out: A.AssetEntry[] = []
    const seen = new Set<string>()
    const q = query.trim()
    // Textures named after a model (s88681_a) belong to it: label them so.
    const models = new Set<number>()
    if (resource === 'texture') {
      for (const rel of o.lib.bundleRels) {
        for (const e of o.lib.bundle(rel).bnd.entries) {
          const m = /[\\/]model[\\/]s(\d+)\.flver$/i.exec(e.name)
          if (m) models.add(Number(m[1]))
        }
      }
    }
    for (const rel of o.lib.bundleRels) {
      for (const e of o.lib.bundle(rel).bnd.entries) {
        const m =
          resource === 'texture'
            ? /[\\/]tex[\\/]s(\d+)_([a-z0-9]+)\.tpf$/i.exec(e.name)
            : /[\\/]model[\\/]s(\d+)\.flver$/i.exec(e.name)
        if (!m) continue
        const id = Number(m[1])
        const key = `${id}:${m[2] ?? ''}`
        if (seen.has(key) || (q && !String(id).includes(q))) continue
        seen.add(key)
        out.push({
          resource,
          id,
          textureType: resource === 'texture' ? m[2] : undefined,
          bundle: rel,
          owner: resource === 'texture' && models.has(id) ? id : undefined,
        })
      }
    }
    return out.sort((a, b) => a.id - b.id)
  }

  /**
   * The textures a model draws with: named in its file, in its material's
   * MATBIN, or sharing its id (s88681 -> s88681_a). Placeholders (ids under
   * 100) and textures the effect bundles don't hold are left out.
   */
  modelTextures(id: number): A.ModelTextureView[] {
    this.session.requireOpen()
    const out: A.ModelTextureView[] = []
    const add = (t: { id: number; type: string } | null, source: A.ModelTextureView['source'], slot = '') => {
      if (!t || t.id < 100 || !this.session.effects.hasEffectTexture(t.id, t.type)) return
      if (out.some((x) => x.id === t.id && x.type === t.type)) return
      out.push({ id: t.id, type: t.type, source, slot })
    }
    const data = this.session.effects.effectEntry(modelEntryPath(id))
    if (data) {
      try {
        for (const m of readFlver(data).meshes) {
          for (const t of m.material.textures) add(effectTextureFromPath(t.path), 'model', t.type)
          for (const s of this.matbins().samplers(m.material.mtd))
            add(effectTextureFromPath(s.path), 'material', s.type)
        }
      } catch {
        /* unreadable model: only same-id textures */
      }
    }
    for (const type of ['a', 'n', 'm', 'em', '3m', 'd']) add({ id, type }, 'same id')
    return out
  }

  meshes = new Map<number, A.ModelMeshView[] | null>()

  /** judge id -> animations that fire it, from the player's animations. */
  animIndex: Map<number, BehaviorInvocation[]> | null = null

  /** Reads chr/c0000.anibnd.dcx (the project's copy if it has one) once. */
  private behaviorLinks(): Map<number, BehaviorInvocation[]> {
    if (this.animIndex) return this.animIndex
    const o = this.session.requireOpen()
    this.animIndex = new Map()
    try {
      // Edited animations count as soon as they're edited, not once saved.
      const files =
        o.anims.taeFiles() ??
        readBnd4(dcxDecompress(o.project.read('chr/c0000.anibnd.dcx').data).data)
          .entries.filter((e) => e.name.toLowerCase().endsWith('.tae'))
          .map((e) => [e.name, e.data] as [string, Buffer])
      this.animIndex = indexBehaviorInvocations(files)
    } catch {
      /* no readable player animations: links simply don't show */
    }
    return this.animIndex
  }

  behaviorAnimations(behaviorId: number): A.AnimationLink[] {
    return this.behaviorLinks().get(judgeOfBehaviorRow(behaviorId)) ?? []
  }

  modelMesh(id: number): A.ModelMeshView[] | null {
    this.session.requireOpen()
    if (this.meshes.has(id)) return this.meshes.get(id)!
    let out: A.ModelMeshView[] | null = null
    const data = this.session.effects.effectEntry(modelEntryPath(id))
    if (data) {
      try {
        out = readFlver(data).meshes.map((m) => {
          // Prefer the diffuse/albedo texture that the effect bundles hold.
          const named = m.material.textures.map((t) => effectTextureFromPath(t.path))
          // ER often leaves material paths blank: then use the material's
          // MATBIN (S[ShiningStone] -> s34050_a), else the textures named
          // after the model itself (s88681 -> s88681_a).
          const blank = m.material.textures.every((t) => !t.path)
          // s00000-s00099 are the game's shared placeholders (s00007_em is
          // plain black): no real texture.
          const fromMatbin = blank
            ? this.matbins()
                .samplers(m.material.mtd)
                .map((s) => effectTextureFromPath(s.path))
                .filter((t) => t && t.id >= 100)
            : []
          const find = (type: string) =>
            named.find((t) => t && t.type === type && this.session.effects.hasEffectTexture(t.id, t.type)) ??
            fromMatbin.find((t) => t && t.type === type && this.session.effects.hasEffectTexture(t.id, t.type)) ??
            (this.session.effects.hasEffectTexture(id, type) ? { id, type } : null)
          return {
            positions: Array.from(m.positions),
            uvs: m.uvs ? Array.from(m.uvs) : null,
            indices: Array.from(m.indices),
            texture: find('a'),
            emissive: find('em'),
            glow: this.matbins().glow(m.material.mtd),
          }
        })
      } catch {
        out = null
      }
    }
    this.meshes.set(id, out)
    return out
  }

  matbinIndex: MatbinIndex | null = null

  /** Every material file (MATBIN) of the game, the project's copies first; loaded on first use. */
  matbins(): MatbinIndex {
    if (this.matbinIndex) return this.matbinIndex
    const project = this.session.requireOpen().project
    const binders: Buffer[] = []
    for (const name of ['allmaterial', 'allmaterial_dlc01', 'allmaterial_dlc02']) {
      for (const rel of [`material/${name}.matbinbnd.dcx`, `material/${name}.matbinbnd.devpatch.dcx`]) {
        try {
          if (project.resolve(rel)) binders.push(project.read(rel).data)
        } catch {
          /* missing binder */
        }
      }
    }
    this.matbinIndex = new MatbinIndex(binders)
    return this.matbinIndex
  }

  rigs = new Map<string, A.ModelRigView | null>()

  /** An animated effect model's skeleton, clip and skinning (cached). */
  modelRig(model: number, anibnd: number, animation: number): A.ModelRigView | null {
    this.session.requireOpen()
    const key = `${model}:${anibnd}:${animation}`
    if (this.rigs.has(key)) return this.rigs.get(key)!
    const flver = this.session.effects.effectEntry(modelEntryPath(model))
    const bnd = this.session.effects.effectEntry(anibndEntryPath(anibnd))
    const rig = flver && bnd ? readModelRig(flver, bnd, anibnd, animation) : null
    const b64 = (a: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64')
    const view: A.ModelRigView | null = rig
      ? {
          bones: rig.skeleton.map((b) => ({ name: b.name, parent: b.parent, t: b.t, r: b.r, s: b.s })),
          frames: rig.clip.frames,
          frameDuration: rig.clip.frameDuration,
          duration: rig.clip.duration,
          tracks: rig.clip.tracks,
          data: b64(rig.clip.data),
          meshes: rig.meshes.map((m) => (m ? { skinIndex: b64(m.skinIndex), skinWeight: b64(m.skinWeight) } : null)),
        }
      : null
    this.rigs.set(key, view)
    return view
  }

  private envCache = new BoundedMap<string, A.EnvironmentView>(12)

  /** Lighting presets whose probes exist in this game folder. */
  environments(): A.EnvironmentAreaView[] {
    const game = this.session.gameFiles()
    const out: A.EnvironmentAreaView[] = []
    for (const area of ENVIRONMENT_AREAS) {
      if (!area.map) {
        if (game.has('other/modelviewer_default_rem.dds')) out.push({ id: area.id, name: area.name, times: [] })
        continue
      }
      const times = areaTimes(game, area)
      if (!times.length) continue
      out.push({
        id: area.id,
        name: area.name,
        times: times.length > 1 ? times.map((i) => ({ index: i, label: TIME_NAMES[i] })) : [],
      })
    }
    return out
  }

  /** One light probe as an HDR panorama. Reads the game folder, never writes it. */
  environment(area: string, time: number, probe: number): A.EnvironmentView {
    const key = `${area}:${time}:${probe}`
    const hit = this.envCache.get(key)
    if (hit) return hit
    const env = loadEnvironment(this.session.gameFiles(), area, time, probe)
    const { width, height, data } = env.image
    const rgb = new Float32Array(width * height * 3)
    for (let i = 0; i < width * height; i++) {
      rgb[i * 3] = data[i * 4]
      rgb[i * 3 + 1] = data[i * 4 + 1]
      rgb[i * 3 + 2] = data[i * 4 + 2]
    }
    const view: A.EnvironmentView = {
      area,
      time,
      width,
      height,
      rgb: Buffer.from(rgb.buffer).toString('base64'),
      probes: env.probes,
      probe: env.probe,
      probeName: env.probeName,
      luminance: env.luminance,
    }
    this.envCache.set(key, view)
    return view
  }

  thumbs = new Map<string, string | null>()

  /** The values each param field has in the installed game, by `param.field` (gameUses). */
  gameValues = new Map<string, Set<number>>()

  /** A menu icon (an item's, a status effect's, a map icon) as a PNG data URL, or null if the game has none with that id. */
  icon(kind: string, id: number, size = 0): string | null {
    const o = this.session.requireOpen()
    if (!isIconKind(kind)) throw new Error(`Unknown icon kind ${kind}`)
    return o.icons.icon(kind, id, Math.max(0, Math.min(512, size)))
  }

  thumbnail(
    resource: 'texture' | 'model',
    id: number,
    textureType = 'a',
    size = 96,
    greyAsAlpha: boolean | 'mask' = false,
  ): string | null {
    this.session.requireOpen()
    const max = Math.min(512, Math.max(16, size))
    const key = `${resource}:${id}:${textureType}:${max}:${greyAsAlpha}`
    const hit = this.thumbs.get(key)
    if (hit !== undefined) return hit
    let url: string | null = null
    // Models: show the model's own albedo texture, which sits beside it.
    const candidates = resource === 'texture' ? [textureType] : ['a', 'em', 'm']
    for (const type of candidates) {
      const tpf = this.session.effects.effectEntry(textureEntryPath(id, type))
      if (!tpf) continue
      try {
        url = 'data:image/png;base64,' + tpfThumbnail(tpf, max, greyAsAlpha).toString('base64')
        break
      } catch {
        /* undecodable texture: no thumbnail */
      }
    }
    this.thumbs.set(key, url)
    return url
  }
}
