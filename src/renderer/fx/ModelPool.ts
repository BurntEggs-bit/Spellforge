/** Effect models: a model emitter's particles drawn with the model's own meshes. */
import * as THREE from 'three'
import type { ModelMeshView, PreviewEmitter } from '../../shared/api.ts'
import { fxExposure, FX_GLOW_GAIN, FX_ALPHA_BOOST } from './constants.ts'
import { fxAdditiveGain } from './glow.ts'
import { isAdditive, drawLayer } from './shaders.ts'
import type { ModelRig } from './rig.ts'
import type { TextureRef } from './textures.ts'

const rigQa = new THREE.Quaternion()
const rigQb = new THREE.Quaternion()

/**
 * Draws a model emitter's particles with the model's real mesh. Additive
 * models glow (unlit, HDR colour); others are PBR-shaded by the area's light
 * and the effect's lights, with their emissive texture when they have one.
 * Geometry and materials are shared; one Group per live particle.
 */
export class ModelPool {
  readonly root = new THREE.Group()
  private template: THREE.Group
  private materials: (THREE.MeshBasicMaterial | THREE.MeshStandardMaterial)[] = []
  private pool: THREE.Group[] = []
  /** Animated models: each copy's own bones (it plays from its own emission). */
  private poolBones: THREE.Bone[][] = []
  /** [template texture, per-copy handle, template version last copied]. */
  private textureCopies: [THREE.Texture, THREE.Texture, number][] = []
  private rig: ModelRig | null

  constructor(
    meshes: ModelMeshView[],
    appearance: PreviewEmitter['appearance'],
    texture: (t: TextureRef | null | undefined) => THREE.Texture | null,
    rig: ModelRig | null = null,
  ) {
    this.rig = rig && rig.meshes.some(Boolean) ? rig : null
    this.template = new THREE.Group()
    for (const [i, m] of meshes.entries()) {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3))
      if (m.uvs) g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uvs, 2))
      g.setIndex(m.indices)
      const skin = this.rig?.meshes[i]
      if (skin && skin.skinIndex.length === (m.positions.length / 3) * 4) {
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skin.skinIndex, 4))
        g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skin.skinWeight, 4))
      }
      let mat: THREE.MeshBasicMaterial | THREE.MeshStandardMaterial
      if (appearance.lit) {
        g.computeVertexNormals()
        // Glowing materials (MATBIN GXFT_Emissive) light themselves through
        // their emissive texture, or their albedo when they have none.
        const emissiveMap = texture(m.emissive) ?? (m.glow ? texture(m.texture) : null)
        mat = new THREE.MeshStandardMaterial({
          map: texture(m.texture),
          emissiveMap,
          emissive: emissiveMap ? 0xffffff : 0x000000,
          roughness: 0.55,
          metalness: 0.05,
          transparent: true,
          side: THREE.DoubleSide,
          // Cut-outs in the texture (frill edges on the dragon heads) are
          // dropped, not blended: blended-away pixels still wrote depth and
          // hid the parts of the model behind them. Low enough that a model
          // fading out (opacity) still fades.
          alphaTest: 0.1,
        })
        if (m.glow) mat.userData.glow = m.glow
      } else {
        mat = new THREE.MeshBasicMaterial({ map: texture(m.texture), transparent: true, side: THREE.DoubleSide })
        if (isAdditive(appearance.blendMode)) {
          mat.blending = THREE.AdditiveBlending
          mat.depthWrite = false
        }
      }
      this.materials.push(mat)
      const mesh = new THREE.Mesh(g, mat)
      mesh.renderOrder = drawLayer(appearance.blendMode)
      this.template.add(mesh)
    }
  }

  /**
   * Gives a copy its own skeleton (reference pose) and swaps its skinned
   * meshes for SkinnedMeshes bound to it. Bones hang off the copy's group, so
   * the particle's position, rotation and size carry the whole rig.
   */
  private skin(g: THREE.Group, rig: ModelRig): THREE.Bone[] {
    const bones = rig.bones.map((b) => {
      const o = new THREE.Bone()
      o.name = b.name
      o.position.set(b.t[0], b.t[1], b.t[2])
      o.quaternion.set(b.r[0], b.r[1], b.r[2], b.r[3])
      o.scale.set(b.s[0], b.s[1], b.s[2])
      return o
    })
    bones.forEach((o, i) =>
      (rig.bones[i].parent >= 0 && bones[rig.bones[i].parent] ? bones[rig.bones[i].parent] : g).add(o),
    )
    g.updateMatrixWorld(true)
    const skeleton = new THREE.Skeleton(bones)
    for (const o of [...g.children]) {
      if (!(o instanceof THREE.Mesh) || o instanceof THREE.SkinnedMesh || !o.geometry.getAttribute('skinIndex'))
        continue
      const sm = new THREE.SkinnedMesh(o.geometry, o.material)
      sm.frustumCulled = false
      sm.renderOrder = o.renderOrder
      g.remove(o)
      g.add(sm)
      sm.bind(skeleton, new THREE.Matrix4())
    }
    return bones
  }

  /** Poses a copy's bones at its particle age (played once unless the model loops). */
  private pose(bones: THREE.Bone[], rig: ModelRig, age: number): void {
    let t = age * rig.speed
    t = rig.loop && rig.duration > 0 ? t % rig.duration : Math.min(t, rig.duration)
    const f = Math.max(0, Math.min(rig.frames - 1, t / Math.max(1e-6, rig.frameDuration)))
    const f0 = Math.floor(f)
    const f1 = Math.min(rig.frames - 1, f0 + 1)
    const a = f - f0
    const d = rig.data
    const n = rig.tracks.length
    for (let i = 0; i < n; i++) {
      const bone = bones[rig.tracks[i]]
      if (!bone) continue
      const o0 = (f0 * n + i) * 10
      const o1 = (f1 * n + i) * 10
      bone.position.set(
        d[o0] + (d[o1] - d[o0]) * a,
        d[o0 + 1] + (d[o1 + 1] - d[o0 + 1]) * a,
        d[o0 + 2] + (d[o1 + 2] - d[o0 + 2]) * a,
      )
      rigQa.set(d[o0 + 3], d[o0 + 4], d[o0 + 5], d[o0 + 6])
      rigQb.set(d[o1 + 3], d[o1 + 4], d[o1 + 5], d[o1 + 6])
      bone.quaternion.slerpQuaternions(rigQa, rigQb, a)
      bone.scale.set(
        d[o0 + 7] + (d[o1 + 7] - d[o0 + 7]) * a,
        d[o0 + 8] + (d[o1 + 8] - d[o0 + 8]) * a,
        d[o0 + 9] + (d[o1 + 9] - d[o0 + 9]) * a,
      )
    }
  }

  update(
    instances: {
      pos: THREE.Vector3
      scale: number[]
      color: number[]
      quat: THREE.Quaternion
      uv?: number[]
      age?: number
    }[],
  ): void {
    while (this.pool.length < instances.length) {
      // Each copy gets its own materials (and texture handles, sharing the
      // image) so every model particle fades and scrolls on its own: stacked
      // rings with one shared texture position blur into a single band.
      const g = this.template.clone()
      g.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        const m = (o.material as THREE.MeshBasicMaterial | THREE.MeshStandardMaterial).clone()
        const copy = (t: THREE.Texture) => {
          const c = t.clone()
          // Model UVs often run past 1 (the dragon heads' go to 2): tile.
          c.wrapS = c.wrapT = THREE.RepeatWrapping
          // FLVER UVs are DirectX-style (v down), like the character viewport's.
          c.flipY = false
          this.textureCopies.push([t, c, t.version])
          return c
        }
        if (m.map) m.map = copy(m.map)
        if (m instanceof THREE.MeshStandardMaterial && m.emissiveMap) m.emissiveMap = copy(m.emissiveMap)
        o.material = m
        this.materials.push(m)
      })
      this.poolBones.push(this.rig ? this.skin(g, this.rig) : [])
      this.pool.push(g)
      this.root.add(g)
    }
    // Textures arrive after the copies were made: pick up the loaded image.
    for (const pair of this.textureCopies) {
      const [orig, c, seen] = pair
      if (orig.version === seen) continue
      pair[2] = orig.version
      c.image = orig.image
      c.flipY = false
      c.needsUpdate = true
    }
    const k = fxExposure.value
    this.pool.forEach((g, i) => {
      const inst = instances[i]
      g.visible = !!inst
      if (!inst) return
      g.position.copy(inst.pos)
      g.quaternion.copy(inst.quat)
      g.scale.set(inst.scale[0] || 1, inst.scale[1] || inst.scale[0] || 1, inst.scale[2] || inst.scale[0] || 1)
      if (this.rig && this.poolBones[i].length) this.pose(this.poolBones[i], this.rig, inst.age ?? 0)
      const c = inst.color
      const shift = inst.uv
      g.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        const m = o.material as THREE.MeshBasicMaterial | THREE.MeshStandardMaterial
        // Scrolling model textures.
        if (shift) {
          for (const t of [m.map, m instanceof THREE.MeshStandardMaterial ? m.emissiveMap : null]) {
            if (!t) continue
            if (t.wrapS !== THREE.RepeatWrapping) {
              t.wrapS = t.wrapT = THREE.RepeatWrapping
              t.needsUpdate = true
            }
            // Unflipped textures: v runs down the image, the way the game scrolls it.
            t.offset.set(shift[0], shift[1])
          }
        }
        const a = c[3] ?? 1
        m.opacity = Math.max(0, Math.min(1, a))
        if (m instanceof THREE.MeshStandardMaterial) {
          // Glowing models keep HDR colour; lit ones split it into albedo tint
          // (<= 1) and emissive strength. Colours above 1 are glow (e.g.
          // "ShiningStone" crystals): keep the hue as albedo and send the
          // brightness to emission.
          const peak = Math.max(c[0], c[1], c[2], 1e-6)
          const glow = m.userData.glow as number[] | undefined
          if (glow) {
            // Self-lit crystal: the particle colour tints the material's glow.
            m.color.setRGB(Math.min(1, c[0]), Math.min(1, c[1]), Math.min(1, c[2]))
            const e = k * FX_GLOW_GAIN
            m.emissive.setRGB(glow[0] * c[0] * e, glow[1] * c[1] * e, glow[2] * c[2] * e)
          } else if (peak > 1) {
            m.color.setRGB(c[0] / peak, c[1] / peak, c[2] / peak)
            m.emissive.setRGB(c[0] * k, c[1] * k, c[2] * k)
          } else {
            m.color.setRGB(c[0], c[1], c[2])
            if (m.emissiveMap) m.emissive.setRGB(c[0] * k, c[1] * k, c[2] * k)
            else m.emissive.setRGB(0, 0, 0)
          }
        } else {
          // Additive: alpha past 1 is extra intensity (see FRAGMENT).
          const boost =
            m.blending === THREE.AdditiveBlending ? fxAdditiveGain.value * Math.min(FX_ALPHA_BOOST, Math.max(1, a)) : 1
          m.color.setRGB(c[0] * k * boost, c[1] * k * boost, c[2] * k * boost)
        }
      })
    })
  }

  dispose(): void {
    // Only the per-copy texture handles: the originals belong to the texture cache.
    for (const [, t] of this.textureCopies) t.dispose()
    for (const m of this.materials) m.dispose()
    this.template.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose()
    })
  }
}
