/**
 * FLVER2 model reading — enough to draw a model in the preview: positions,
 * normals, UVs and triangles per mesh, each mesh's material textures, and
 * for characters the bones, skin weights and dummy polys (attachment points).
 *
 * Layout (little-endian; Elden Ring is version 0x2001A):
 *   0x00 "FLVER\0" "L\0"; 0x08 version; 0x0C dataOffset; 0x10 dataLength
 *   0x14 dummyCount 0x18 materialCount 0x1C boneCount 0x20 meshCount
 *   0x24 vertexBufferCount 0x28 bbox min (3f) 0x34 bbox max (3f)
 *   0x48 u8 vertexIndexSize 0x49 u8 unicode
 *   0x50 faceSetCount 0x54 bufferLayoutCount 0x58 textureCount
 *   0x80 then, back to back: dummies (0x40 each), materials (0x20),
 *   bones (0x80), meshes (0x30), face sets (0x20), vertex buffers (0x20),
 *   buffer layouts (0x10), textures (0x20).
 * Offsets inside records are absolute, except vertex and index data, which
 * are relative to dataOffset.
 *
 * Checked against every model in the effect bundles: indices in range,
 * positions inside the header's bounding box.
 *
 * Credit: SoulsFormats (TKGP; GPL-3.0, read as documentation only) documents
 * the FLVER layout and its names for vertex layout types.
 */
import { fileNameOf } from './paths.ts'

export interface FlverTexture {
  /** e.g. N:\...\s88072_a.tif */
  path: string
  /** e.g. g_DiffuseTexture */
  type: string
}

export interface FlverMesh {
  /** xyz per vertex */
  positions: Float32Array
  /** uv per vertex, or null if the mesh has none */
  uvs: Float32Array | null
  /** triangle list */
  indices: Uint32Array
  material: { name: string; mtd: string; textures: FlverTexture[] }
  /** Skinned (dynamic) meshes: vertices are in model space, weighted to bones. */
  dynamic: boolean
  /** Static meshes follow this bone (their positions are already moved onto it). */
  defaultBone: number
  /** xyz per vertex, if stored. */
  normals: Float32Array | null
  /** Four FLVER bone indices and weights per vertex (skinned meshes). */
  boneIndices: Uint16Array | null
  boneWeights: Float32Array | null
  /**
   * Static meshes: the bone each vertex rides on (the normal's W), when the
   * mesh mixes bones; a katana's blade mesh holds parts of its scabbard on
   * the Case bone. Positions are already moved onto these bones. Null when
   * every vertex is on the default bone.
   */
  vertexBones: Uint16Array | null
}

export interface FlverBone {
  name: string
  parent: number
  /** Local transform: translation, euler rotation (radians, applied X, Z, Y), scale. */
  t: number[]
  r: number[]
  s: number[]
  /** Its bounding box in its own space (min, max), as the model stores it. */
  bbMin: number[]
  bbMax: number[]
}

/** A dummy poly: an attachment point (effects, hitboxes, weapons) on a bone. */
export interface FlverDummy {
  id: number
  position: number[]
  forward: number[]
  up: number[]
  /** Bone the position is relative to (-1: model space). */
  parentBone: number
  /** Bone it moves with. */
  attachBone: number
}

export interface Flver {
  version: number
  boundsMin: number[]
  boundsMax: number[]
  meshes: FlverMesh[]
  bones: FlverBone[]
  dummies: FlverDummy[]
}

const Semantic = { Position: 0, BoneWeights: 1, BoneIndices: 2, Normal: 3, UV: 5 } as const

/** Byte size of each vertex member type. */
const TYPE_SIZE: Record<number, number> = {
  0x01: 8, // Float2
  0x02: 12, // Float3
  0x03: 16, // Float4
  0x10: 4, // Byte4A
  0x11: 4, // Byte4B
  0x12: 4, // Short2toFloat2
  0x13: 4, // Byte4C
  0x15: 4, // UV (2 x s16)
  0x16: 8, // UVPair (4 x s16)
  0x18: 8, // ShortBoneIndices
  0x1a: 8, // Short4toFloat4A
  0x2e: 8, // Short4toFloat4B
  0x2f: 4, // Byte4E
}

/** Face set flags that mark something other than the full-detail mesh. */
const FACESET_LOD_OR_BLUR = 0x01000000 | 0x02000000 | 0x80000000 | 0x40000000

export function readFlver(buf: Buffer): Flver {
  if (buf.toString('ascii', 0, 6) !== 'FLVER\0') throw new Error('Not a FLVER model')
  if (buf.toString('ascii', 6, 8) !== 'L\0') throw new Error('Big-endian FLVER is not supported')
  const i32 = (o: number) => buf.readInt32LE(o)
  const version = i32(0x08)
  const dataOffset = i32(0x0c)
  const counts = {
    dummies: i32(0x14),
    materials: i32(0x18),
    bones: i32(0x1c),
    meshes: i32(0x20),
    vertexBuffers: i32(0x24),
    faceSets: i32(0x50),
    layouts: i32(0x54),
    textures: i32(0x58),
  }
  const defaultIndexSize = buf[0x48]
  const unicode = buf[0x49] === 1
  const boundsMin = [0x28, 0x2c, 0x30].map((o) => buf.readFloatLE(o))
  const boundsMax = [0x34, 0x38, 0x3c].map((o) => buf.readFloatLE(o))
  // UVs are fixed-point; newer versions use 1/2048.
  const uvFactor = version >= 0x2000f ? 2048 : 1024

  const str = (o: number): string => {
    if (o <= 0 || o >= buf.length) return ''
    if (unicode) {
      let e = o
      while (e + 1 < buf.length && buf.readUInt16LE(e) !== 0) e += 2
      return buf.toString('utf16le', o, e)
    }
    let e = o
    while (e < buf.length && buf[e] !== 0) e++
    return buf.toString('latin1', o, e)
  }

  let p = 0x80
  p += counts.dummies * 0x40
  const materialsAt = p
  p += counts.materials * 0x20
  p += counts.bones * 0x80
  const meshesAt = p
  p += counts.meshes * 0x30
  const faceSetsAt = p
  p += counts.faceSets * 0x20
  const buffersAt = p
  p += counts.vertexBuffers * 0x20
  const layoutsAt = p
  p += counts.layouts * 0x10
  const texturesAt = p

  const textures: FlverTexture[] = []
  for (let i = 0; i < counts.textures; i++) {
    const o = texturesAt + i * 0x20
    textures.push({ path: str(i32(o)), type: str(i32(o + 4)) })
  }

  const materials = Array.from({ length: counts.materials }, (_, i) => {
    const o = materialsAt + i * 0x20
    const texCount = i32(o + 8)
    const texIndex = i32(o + 12)
    return {
      name: str(i32(o)),
      mtd: str(i32(o + 4)),
      textures: textures.slice(texIndex, texIndex + texCount),
    }
  })

  const layouts = Array.from({ length: counts.layouts }, (_, i) => {
    const o = layoutsAt + i * 0x10
    const memberCount = i32(o)
    const membersAt = i32(o + 12)
    const members: { offset: number; type: number; semantic: number; index: number }[] = []
    for (let m = 0; m < memberCount; m++) {
      const mo = membersAt + m * 0x14
      members.push({
        offset: i32(mo + 4),
        type: buf.readUInt32LE(mo + 8),
        semantic: buf.readUInt32LE(mo + 12),
        index: i32(mo + 16),
      })
    }
    return members
  })

  const v3 = (at: number) => [buf.readFloatLE(at), buf.readFloatLE(at + 4), buf.readFloatLE(at + 8)]
  // Bones: translation, name, euler rotation (radians), parent, scale.
  const bonesAt = materialsAt + counts.materials * 0x20
  const bones: FlverBone[] = Array.from({ length: counts.bones }, (_, i) => {
    const o = bonesAt + i * 0x80
    // 0x30 bounding box min, 0x3C flags, 0x40 bounding box max.
    return {
      name: str(i32(o + 0xc)),
      t: v3(o),
      r: v3(o + 0x10),
      s: v3(o + 0x20),
      parent: buf.readInt16LE(o + 0x1c),
      bbMin: v3(o + 0x30),
      bbMax: v3(o + 0x40),
    }
  })
  // Dummy polys.
  const dummies: FlverDummy[] = Array.from({ length: counts.dummies }, (_, i) => {
    const o = 0x80 + i * 0x40
    return {
      position: v3(o),
      forward: v3(o + 0x10),
      id: buf.readInt16LE(o + 0x1c),
      parentBone: buf.readInt16LE(o + 0x1e),
      up: v3(o + 0x20),
      attachBone: buf.readInt16LE(o + 0x2c),
    }
  })
  /** The bone and its ancestors, innermost first. */
  const boneChain = (index: number): Bone[] => {
    const out: Bone[] = []
    const seen = new Set<number>()
    for (let i = index; i >= 0 && i < bones.length && !seen.has(i); i = bones[i].parent) {
      seen.add(i)
      out.push(bones[i])
    }
    return out
  }

  const meshes: FlverMesh[] = []
  for (let mi = 0; mi < counts.meshes; mi++) {
    const o = meshesAt + mi * 0x30
    const materialIndex = i32(o + 4)
    const faceSetCount = i32(o + 0x20)
    const faceSetIdx = i32(o + 0x24)
    const bufferCount = i32(o + 0x28)
    const bufferIdx = i32(o + 0x2c)

    // Vertex attributes may be split across several buffers.
    let vertexCount = 0
    let positions: Float32Array | null = null
    let uvs: Float32Array | null = null
    let normals: Float32Array | null = null
    let boneIndices: Uint16Array | null = null
    let boneWeights: Float32Array | null = null
    let normalW: Uint16Array | null = null
    for (let b = 0; b < bufferCount; b++) {
      const vb = buffersAt + i32(bufferIdx + b * 4) * 0x20
      const layout = layouts[i32(vb + 4)] ?? []
      const vertexSize = i32(vb + 8)
      const count = i32(vb + 12)
      const start = dataOffset + i32(vb + 0x1c)
      vertexCount = count
      for (const m of layout) {
        if (m.semantic === Semantic.Position && !positions && (m.type === 0x02 || m.type === 0x03)) {
          positions = new Float32Array(count * 3)
          for (let v = 0; v < count; v++) {
            const a = start + v * vertexSize + m.offset
            positions[v * 3] = buf.readFloatLE(a)
            positions[v * 3 + 1] = buf.readFloatLE(a + 4)
            positions[v * 3 + 2] = buf.readFloatLE(a + 8)
          }
        } else if (m.semantic === Semantic.UV && !uvs && m.index === 0) {
          const uv = new Float32Array(count * 2)
          let ok = true
          for (let v = 0; v < count; v++) {
            const a = start + v * vertexSize + m.offset
            if (m.type === 0x01) {
              uv[v * 2] = buf.readFloatLE(a)
              uv[v * 2 + 1] = buf.readFloatLE(a + 4)
            } else if (m.type === 0x15 || m.type === 0x16) {
              uv[v * 2] = buf.readInt16LE(a) / uvFactor
              uv[v * 2 + 1] = buf.readInt16LE(a + 2) / uvFactor
            } else {
              ok = false
              break
            }
          }
          if (ok) uvs = uv
        } else if (m.semantic === Semantic.Normal && !normals) {
          normals = readVec(buf, start, vertexSize, m.offset, m.type, count, 3, 'normal')
          normalW = readNormalW(buf, start, vertexSize, m.offset, m.type, count)
        } else if (m.semantic === Semantic.BoneWeights && !boneWeights) {
          boneWeights = readVec(buf, start, vertexSize, m.offset, m.type, count, 4, 'weight')
        } else if (m.semantic === Semantic.BoneIndices && !boneIndices) {
          const out = new Uint16Array(count * 4)
          const wide = m.type === 0x18
          for (let v = 0; v < count; v++) {
            const a = start + v * vertexSize + m.offset
            for (let k = 0; k < 4; k++) out[v * 4 + k] = wide ? buf.readUInt16LE(a + k * 2) : buf[a + k]
          }
          boneIndices = out
        }
      }
      void TYPE_SIZE
    }
    if (!positions) continue

    // Full-detail face set: first one without LOD / motion-blur flags.
    let indices: Uint32Array | null = null
    for (let f = 0; f < faceSetCount && !indices; f++) {
      const fo = faceSetsAt + i32(faceSetIdx + f * 4) * 0x20
      const flags = buf.readUInt32LE(fo)
      if (flags & FACESET_LOD_OR_BLUR) continue
      const strip = buf[fo + 4] === 1
      const count = i32(fo + 8)
      const at = dataOffset + i32(fo + 12)
      let size = version > 0x20005 ? i32(fo + 0x18) : 0
      if (!size) size = defaultIndexSize || 16
      const raw: number[] = []
      for (let k = 0; k < count; k++)
        raw.push(size === 32 ? buf.readUInt32LE(at + k * 4) : buf.readUInt16LE(at + k * 2))
      indices = new Uint32Array(strip ? stripToList(raw, size === 32 ? 0xffffffff : 0xffff) : raw)
    }
    if (!indices) continue

    // Static meshes store vertices relative to a bone; the file's bounding box
    // is after that bone's transform. Skinned meshes (dynamic) are already in
    // model space. Most static meshes sit wholly on their default bone, but
    // some mix bones vertex by vertex (the normal's W names the bone): a
    // katana's blade mesh holds its scabbard's shell on the Case bone, which
    // the game folds away while the blade is drawn.
    const dynamic = buf[o] !== 0
    const defaultBone = i32(o + 0x10)
    let vertexBones: Uint16Array | null = null
    if (!dynamic && normalW && defaultBone >= 0 && defaultBone < counts.bones) {
      let onDefault = false
      let elsewhere = false
      for (let v = 0; v < normalW.length; v++) {
        if (normalW[v] === defaultBone) onDefault = true
        else if (normalW[v] < counts.bones) elsewhere = true
      }
      if (onDefault && elsewhere) {
        vertexBones = new Uint16Array(normalW.length)
        for (let v = 0; v < normalW.length; v++) vertexBones[v] = normalW[v] < counts.bones ? normalW[v] : defaultBone
      }
    }
    if (!dynamic && defaultBone >= 0 && defaultBone < counts.bones) {
      const chains = new Map<number, Bone[]>()
      const chainOf = (b: number) => {
        let c = chains.get(b)
        if (!c) chains.set(b, (c = boneChain(b)))
        return c
      }
      for (let v = 0; v < vertexCount && v * 3 < positions.length; v++) {
        let x = positions[v * 3]
        let y = positions[v * 3 + 1]
        let z = positions[v * 3 + 2]
        for (const bone of chainOf(vertexBones ? vertexBones[v] : defaultBone)) [x, y, z] = applyBone(bone, x, y, z)
        positions[v * 3] = x
        positions[v * 3 + 1] = y
        positions[v * 3 + 2] = z
      }
      // Normals turn with their bone like the positions did.
      if (normals) {
        for (let v = 0; v * 3 < normals.length; v++) {
          let x = normals[v * 3]
          let y = normals[v * 3 + 1]
          let z = normals[v * 3 + 2]
          for (const bone of chainOf(vertexBones ? vertexBones[v] : defaultBone))
            [x, y, z] = applyBone({ ...bone, t: [0, 0, 0] }, x, y, z)
          normals[v * 3] = x
          normals[v * 3 + 1] = y
          normals[v * 3 + 2] = z
        }
      }
    }

    meshes.push({
      positions,
      uvs,
      indices,
      material: materials[materialIndex] ?? { name: '', mtd: '', textures: [] },
      dynamic,
      defaultBone,
      normals,
      boneIndices: dynamic ? boneIndices : null,
      boneWeights: dynamic ? boneWeights : null,
      vertexBones,
    })
  }

  return { version, boundsMin, boundsMax, meshes, bones, dummies }
}

type Bone = Pick<FlverBone, 't' | 'r' | 's' | 'parent'>

/** The normal's fourth value as a whole number: in static meshes, the bone the vertex is bound to. */
function readNormalW(
  buf: Buffer,
  start: number,
  stride: number,
  offset: number,
  type: number,
  count: number,
): Uint16Array | null {
  const out = new Uint16Array(count)
  for (let v = 0; v < count; v++) {
    const a = start + v * stride + offset
    switch (type) {
      case 0x03:
        out[v] = Math.max(0, Math.round(buf.readFloatLE(a + 12)))
        break
      case 0x10:
      case 0x11:
      case 0x13:
      case 0x2f:
        out[v] = buf[a + 3]
        break
      case 0x12:
      case 0x1a:
      case 0x2e:
        out[v] = Math.max(0, buf.readInt16LE(a + 6))
        break
      default:
        return null
    }
  }
  return out
}

/** Reads a 3- or 4-component vertex member as floats. */
function readVec(
  buf: Buffer,
  start: number,
  stride: number,
  offset: number,
  type: number,
  count: number,
  dims: number,
  kind: 'normal' | 'weight',
): Float32Array | null {
  const out = new Float32Array(count * dims)
  for (let v = 0; v < count; v++) {
    const a = start + v * stride + offset
    for (let k = 0; k < dims; k++) {
      let x: number
      switch (type) {
        case 0x02:
        case 0x03:
          x = buf.readFloatLE(a + k * 4)
          break
        case 0x10:
        case 0x11:
        case 0x13:
        case 0x2f:
          // Normals: unsigned bytes centred on 127; weights: 0..255.
          x = kind === 'normal' ? (buf[a + k] - 127) / 127 : buf[a + k] / 255
          break
        case 0x12:
        case 0x1a:
        case 0x2e:
          x = buf.readInt16LE(a + k * 2) / 32767
          break
        default:
          return null
      }
      out[v * dims + k] = x
    }
  }
  return out
}

/**
 * One bone's local transform on a point: scale, rotate X, then Z, then Y,
 * then translate (the row-vector order SoulsFormats uses).
 */
function applyBone(b: Bone, x: number, y: number, z: number): [number, number, number] {
  x *= b.s[0]
  y *= b.s[1]
  z *= b.s[2]
  let c = Math.cos(b.r[0])
  let s = Math.sin(b.r[0])
  ;[y, z] = [y * c - z * s, y * s + z * c]
  c = Math.cos(b.r[2])
  s = Math.sin(b.r[2])
  ;[x, y] = [x * c - y * s, x * s + y * c]
  c = Math.cos(b.r[1])
  s = Math.sin(b.r[1])
  ;[x, z] = [x * c + z * s, -x * s + z * c]
  return [x + b.t[0], y + b.t[1], z + b.t[2]]
}

/** Triangle strip (with restart markers) to a triangle list. */
function stripToList(strip: number[], restart: number): number[] {
  const out: number[] = []
  let flip = false
  for (let i = 2; i < strip.length; i++) {
    const a = strip[i - 2]
    const b = strip[i - 1]
    const c = strip[i]
    if (a === restart || b === restart || c === restart) {
      flip = false
      continue
    }
    if (a !== b && b !== c && a !== c) out.push(...(flip ? [b, a, c] : [a, b, c]))
    flip = !flip
  }
  return out
}

/** `N:\...\s88072_a.tif` -> { id: 88072, type: 'a' } for effect-bundle textures. */
export function effectTextureFromPath(p: string): { id: number; type: string } | null {
  const m = /s(\d{5})_([a-z0-9]+)(?:\.[a-z]+)?$/i.exec(p.replace(/\\/g, '/').split('/').pop() ?? '')
  return m ? { id: Number(m[1]), type: m[2].toLowerCase() } : null
}

/** A material texture path's file name without extension, e.g. s88072_a. */
export function textureBaseName(p: string): string {
  const file = fileNameOf(p)
  return file.replace(/\.[^.]+$/, '')
}
