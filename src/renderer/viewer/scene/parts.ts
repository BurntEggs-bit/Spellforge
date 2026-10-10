/**
 * The models in the scene: meshes built from the main process's part views,
 * skinned to the skeleton (armour, the body) or riding a hand bone (weapons,
 * posed by their own clips), with their textures and mask groups.
 */
import * as THREE from 'three'
import type { PartView } from '../../../shared/api.ts'
import { BoundedMap } from '../../../shared/collections.ts'
import { base64Floats, base64Uint16, base64Uint32 } from '../../lib/base64.ts'
import { weaponFlip } from './dummies.ts'
import type { ViewerState, LoadedPart } from './state.ts'

/** A dummy's local frame from its position and forward / up vectors. */
function dummyFrame(pos: number[], fwd: number[], up: number[]): THREE.Matrix4 {
  const z = new THREE.Vector3(...fwd)
  const y = new THREE.Vector3(...up)
  if (z.lengthSq() < 1e-8) z.set(0, 0, 1)
  if (y.lengthSq() < 1e-8) y.set(0, 1, 0)
  z.normalize()
  const x = new THREE.Vector3().crossVectors(y, z)
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0)
  x.normalize()
  y.crossVectors(z, x).normalize()
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(pos[0], pos[1], pos[2])
}

const texLoader = new THREE.TextureLoader()
const texCache = new BoundedMap<string, THREE.Texture>(64)

/**
 * A model texture (a PNG data URL from the main process), shared by every
 * model using it while it's among the last 64 used. Data URLs are long, so
 * the key is their length and last characters.
 */
function texture(url: string, srgb: boolean): THREE.Texture {
  const key = `${srgb}:${url.length}:${url.slice(-64)}`
  let t = texCache.get(key)
  if (!t) {
    t = texLoader.load(url)
    t.flipY = false
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    t.anisotropy = 4
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    texCache.set(key, t)
  }
  return t
}

/** A material's mask group: FromSoftware names toggleable model parts #NN# (Margit's hammer is #08#). */
function maskGroup(material: string | undefined): number {
  const m = /#(\d+)#/.exec(material ?? '')
  return m ? Number(m[1]) : -1
}

/**
 * A model in the scene from its view: skinned meshes on the actor (armour,
 * the body), or meshes riding their bone (weapons), turned to sit in the hand;
 * with its dummy polys, bone binds and the weapon's own clips.
 */
export function makePart(s: ViewerState, slot: string, view: PartView, rigid: boolean): LoadedPart {
  const objects: THREE.Object3D[] = []
  const posed: LoadedPart['posed'] = []
  for (const m of view.meshes) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(base64Floats(m.positions), 3))
    if (m.normals) g.setAttribute('normal', new THREE.BufferAttribute(base64Floats(m.normals), 3))
    if (m.uvs) g.setAttribute('uv', new THREE.BufferAttribute(base64Floats(m.uvs), 2))
    g.setIndex(new THREE.BufferAttribute(base64Uint32(m.indices), 1))
    if (!m.normals) g.computeVertexNormals()
    const orm = m.ormMap && view.textures[m.ormMap] ? texture(view.textures[m.ormMap], false) : null
    const normal = m.normalMap && view.textures[m.normalMap] ? texture(view.textures[m.normalMap], false) : null
    const mat = new THREE.MeshStandardMaterial({
      color: m.albedo ? 0xffffff : 0x8a8478,
      map: m.albedo && view.textures[m.albedo] ? texture(view.textures[m.albedo], true) : null,
      normalMap: normal,
      roughnessMap: orm,
      metalnessMap: orm,
      roughness: orm ? 1 : 0.72,
      metalness: orm ? 1 : 0.15,
      side: THREE.DoubleSide,
      alphaTest: m.alphaTest ? 0.5 : 0,
    })
    // The game's normal maps are DirectX-style (green down).
    if (normal) mat.normalScale.set(1, -1)
    if (m.skinIndex && m.skinWeight && s.skeleton) {
      g.setAttribute('skinIndex', new THREE.BufferAttribute(base64Uint16(m.skinIndex), 4))
      g.setAttribute('skinWeight', new THREE.BufferAttribute(base64Floats(m.skinWeight), 4))
      const mesh = new THREE.SkinnedMesh(g, mat)
      mesh.userData.mask = maskGroup(m.material)
      mesh.frustumCulled = false
      mesh.castShadow = true
      s.actor.add(mesh)
      mesh.bind(s.skeleton, new THREE.Matrix4())
      objects.push(mesh)
    } else if (m.bone >= 0 && s.bones[m.bone]) {
      const mesh = new THREE.Mesh(g, mat)
      mesh.castShadow = true
      const flip = weaponFlip(slot)
      mesh.matrixAutoUpdate = false
      mesh.matrix.copy(flip)
      // Its place on the bone in the hand (placeWeapons moves it from there when held otherwise).
      mesh.userData.natural = flip.clone()
      s.bones[m.bone].add(mesh)
      objects.push(mesh)
      if (m.ownBone) posed.push({ mesh, bone: m.ownBone, flip })
    }
  }
  const anim = view.weaponAnim
  const weaponClips = anim
    ? {
        bones: anim.bones,
        clips: new Map(
          Object.entries(anim.clips).map(([k, c]) => [
            k,
            {
              frames: c.frames,
              frameDuration: c.frameDuration,
              tracks: c.tracks,
              data: base64Floats(c.data),
            },
          ]),
        ),
      }
    : null
  const part: LoadedPart = {
    slot,
    view,
    objects,
    rigid,
    dummyFrames: view.dummies.map((d) => dummyFrame(d.position, d.forward, d.up)),
    binds: view.bones.map((b) => new THREE.Matrix4().fromArray(b.bind)),
    posed,
    weaponClips,
  }
  poseWeapon(part, [], 0)
  return part
}

const wpT = new THREE.Vector3()
const wpQ = new THREE.Quaternion()
const wpS = new THREE.Vector3()
const wpM = new THREE.Matrix4()

/**
 * Poses a weapon's own bones from its own clips: the one named like the
 * character's animation (a katana drawing during its skill), else its
 * default pose a999_000000, which for a katana scales the scabbard to
 * nothing so only the blade is in the hand.
 */
export function poseWeapon(p: LoadedPart, names: (string | null | undefined)[], time: number): void {
  if (!p.posed.length || !p.weaponClips) return
  const { bones, clips } = p.weaponClips
  let clip = null
  let t = 0
  for (const n of names) {
    const c = n ? clips.get(n.toLowerCase()) : undefined
    if (c) {
      clip = c
      t = time
      break
    }
  }
  if (!clip) clip = clips.get('a999_000000') ?? null
  const frame = clip ? Math.min(clip.frames - 1, Math.max(0, Math.floor(t / Math.max(1e-6, clip.frameDuration)))) : 0
  for (const { mesh, bone, flip } of p.posed) {
    const track = clip ? clip.tracks.findIndex((b) => bones[b] === bone) : -1
    if (!clip || track < 0) {
      mesh.matrix.copy(flip)
    } else {
      const d = clip.data
      const o = (frame * clip.tracks.length + track) * 10
      wpM.compose(
        wpT.set(d[o], d[o + 1], d[o + 2]),
        wpQ.set(d[o + 3], d[o + 4], d[o + 5], d[o + 6]),
        wpS.set(d[o + 7], d[o + 8], d[o + 9]),
      )
      mesh.matrix.multiplyMatrices(flip, wpM)
    }
    ;((mesh.userData.natural as THREE.Matrix4 | undefined) ?? (mesh.userData.natural = new THREE.Matrix4())).copy(
      mesh.matrix,
    )
    mesh.matrixWorldNeedsUpdate = true
  }
}

/** Takes a model out of the scene and frees its geometry and materials (textures stay cached). */
export function removePart(p: LoadedPart): void {
  for (const o of p.objects) {
    o.parent?.remove(o)
    const m = o as THREE.Mesh
    m.geometry?.dispose()
    ;(m.material as THREE.Material)?.dispose()
  }
}

/** Fades a model's materials (SetOpacityKeyframe); nearly clear ones stop hiding what is behind them. */
export function setOpacity(objects: THREE.Object3D[], op: number): void {
  for (const o of objects) {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
    if (!m || !('opacity' in m)) continue
    m.transparent = op < 0.999
    m.opacity = op
    m.depthWrite = op > 0.5
    m.needsUpdate = true
  }
}
