/**
 * Environment lighting from the game's own files, for the effect preview.
 *
 *  - other/modelviewer_default_rem.dds / _iem.dds: FromSoft's model-viewer
 *    environment — radiance (reflections) and irradiance (diffuse light)
 *    cubemaps, half-float RGBA (D3DFMT 113).
 *  - map/.../*_envmap_*.tpfbnd.dcx: per-area reflection probes
 *    (GILM####_rem), BC6H cubemaps — see bc6h.ts.
 *
 * Cubemaps are converted to equirectangular float images, which the
 * renderer pre-filters for image-based lighting.
 */
import path from 'node:path'
import { decodeBc6hBlock, halfToFloat } from '../formats/bc6h.ts'
import { dcxDecompress } from '../formats/dcx.ts'
import { readBnd4 } from '../formats/bnd4.ts'
import { readTpf } from '../formats/textures.ts'

export { halfToFloat }

export interface HdrImage {
  width: number
  height: number
  /** RGBA float32, linear */
  data: Float32Array
}

export type CubeFaces = HdrImage[] // +X, -X, +Y, -Y, +Z, -Z (D3D order)

interface DdsLayout {
  width: number
  height: number
  mipCount: number
  format: 'RGBA16F' | 'BC6H_UF16' | 'BC6H_SF16'
  dataOffset: number
  faces: number
}

function ddsLayout(dds: Buffer): DdsLayout {
  if (dds.toString('ascii', 0, 4) !== 'DDS ') throw new Error('Not a DDS')
  const height = dds.readUInt32LE(0x0c)
  const width = dds.readUInt32LE(0x10)
  const mipCount = Math.max(1, dds.readUInt32LE(0x1c))
  const four = dds.toString('ascii', 0x54, 0x58)
  const caps2 = dds.readUInt32LE(0x70)
  if (four === 'DX10') {
    const dxgi = dds.readUInt32LE(0x80)
    const misc = dds.readUInt32LE(0x88)
    const arraySize = dds.readUInt32LE(0x8c)
    const faces = misc & 0x4 ? 6 * Math.max(1, arraySize / 6 >= 1 ? arraySize / 6 : 1) : arraySize
    const format = dxgi === 10 ? 'RGBA16F' : dxgi === 95 ? 'BC6H_UF16' : dxgi === 96 ? 'BC6H_SF16' : null
    if (!format) throw new Error(`Unsupported environment format DXGI ${dxgi}`)
    return { width, height, mipCount, format, dataOffset: 0x94, faces: misc & 0x4 ? 6 : faces }
  }
  if (dds.readUInt32LE(0x54) === 113) {
    return { width, height, mipCount, format: 'RGBA16F', dataOffset: 0x80, faces: caps2 & 0x200 ? 6 : 1 }
  }
  throw new Error(`Unsupported environment DDS format ${JSON.stringify(four)}`)
}

function levelSize(format: DdsLayout['format'], w: number, h: number): number {
  if (format === 'RGBA16F') return w * h * 8
  return Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * 16
}

/** One mip level (default: the top) of each of the six faces. */
export function decodeCubeFaces(dds: Buffer, mip = 0): CubeFaces {
  const l = ddsLayout(dds)
  if (l.faces !== 6) throw new Error('Not a cubemap')
  mip = Math.min(mip, l.mipCount - 1)
  // Each face stores its whole mip chain before the next face starts.
  let faceBytes = 0
  for (let m = 0, w = l.width, h = l.height; m < l.mipCount; m++, w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
    faceBytes += levelSize(l.format, w, h)
  }
  let skip = 0
  let width = l.width
  let height = l.height
  for (let m = 0; m < mip; m++) {
    skip += levelSize(l.format, width, height)
    width = Math.max(1, width >> 1)
    height = Math.max(1, height >> 1)
  }
  const faces: CubeFaces = []
  for (let f = 0; f < 6; f++) {
    const at = l.dataOffset + f * faceBytes + skip
    const data = new Float32Array(width * height * 4)
    if (l.format === 'RGBA16F') {
      for (let i = 0; i < width * height * 4; i++) data[i] = halfToFloat(dds.readUInt16LE(at + i * 2))
    } else {
      const signed = l.format === 'BC6H_SF16'
      const bw = Math.ceil(width / 4)
      const block = new Float32Array(48)
      for (let by = 0; by < Math.ceil(height / 4); by++) {
        for (let bx = 0; bx < bw; bx++) {
          decodeBc6hBlock(dds, at + (by * bw + bx) * 16, signed, block)
          for (let py = 0; py < 4; py++) {
            for (let px = 0; px < 4; px++) {
              const x = bx * 4 + px
              const y = by * 4 + py
              if (x >= width || y >= height) continue
              const s = (py * 4 + px) * 3
              const d = (y * width + x) * 4
              data[d] = block[s]
              data[d + 1] = block[s + 1]
              data[d + 2] = block[s + 2]
              data[d + 3] = 1
            }
          }
        }
      }
    }
    faces.push({ width, height, data })
  }
  return faces
}

/**
 * Samples a cubemap (D3D face order and orientation) into an
 * equirectangular image. Directions use three.js axes: +Y up, and the
 * game's left-handed Z is flipped to right-handed.
 */
export function cubeToEquirect(faces: CubeFaces, width = 256, height = 128): HdrImage {
  const out = new Float32Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const theta = ((y + 0.5) / height) * Math.PI // 0 at top
    for (let x = 0; x < width; x++) {
      const phi = ((x + 0.5) / width) * 2 * Math.PI - Math.PI
      // Direction in three.js space, then into D3D's left-handed space.
      const dx = Math.sin(theta) * Math.sin(phi)
      const dy = Math.cos(theta)
      const dz = -Math.sin(theta) * Math.cos(phi)
      const px = dx
      const py = dy
      const pz = -dz
      const ax = Math.abs(px)
      const ay = Math.abs(py)
      const az = Math.abs(pz)
      let face: number
      let u: number
      let v: number
      if (ax >= ay && ax >= az) {
        face = px > 0 ? 0 : 1
        u = px > 0 ? -pz / ax : pz / ax
        v = -py / ax
      } else if (ay >= az) {
        face = py > 0 ? 2 : 3
        u = px / ay
        v = py > 0 ? pz / ay : -pz / ay
      } else {
        face = pz > 0 ? 4 : 5
        u = pz > 0 ? px / az : -px / az
        v = -py / az
      }
      // Bilinear within the face (clamped at its edges).
      const f = faces[face]
      const fx = Math.min(f.width - 1, Math.max(0, ((u + 1) / 2) * f.width - 0.5))
      const fy = Math.min(f.height - 1, Math.max(0, ((v + 1) / 2) * f.height - 0.5))
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const x1 = Math.min(f.width - 1, x0 + 1)
      const y1 = Math.min(f.height - 1, y0 + 1)
      const tx = fx - x0
      const ty = fy - y0
      const d = (y * width + x) * 4
      for (let c = 0; c < 3; c++) {
        const a = f.data[(y0 * f.width + x0) * 4 + c] * (1 - tx) + f.data[(y0 * f.width + x1) * 4 + c] * tx
        const b = f.data[(y1 * f.width + x0) * 4 + c] * (1 - tx) + f.data[(y1 * f.width + x1) * 4 + c] * tx
        out[d + c] = a * (1 - ty) + b * ty
      }
      out[d + 3] = 1
    }
  }
  return { width, height, data: out }
}

/** Average color of an HDR image (used as ambient / exposure reference). */
export function averageColor(img: HdrImage): number[] {
  const sum = [0, 0, 0]
  const n = img.width * img.height
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) sum[c] += img.data[i * 4 + c]
  return sum.map((v) => v / n)
}

/** Luminance (Rec. 709) of a linear RGB triple. */
function luminance(c: number[]): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/**
 * Lighting presets. Areas point at a map folder whose envmap bundles hold
 * the area's light probes; open-world and most legacy dungeons have one
 * bundle per time of day (envmap_00..06), underground areas only one.
 */
export interface EnvironmentArea {
  id: string
  name: string
  /** Map folder under map/, e.g. m60/m60_42_36_00. Absent for the studio. */
  map?: string
}

export const ENVIRONMENT_AREAS: EnvironmentArea[] = [
  { id: 'studio', name: 'Studio (FromSoftware model viewer)' },
  { id: 'limgrave', name: 'Limgrave', map: 'm60/m60_42_36_00' },
  { id: 'caelid', name: 'Caelid', map: 'm60/m60_48_38_00' },
  { id: 'liurnia', name: 'Liurnia of the Lakes', map: 'm60/m60_35_47_00' },
  { id: 'altus', name: 'Altus Plateau', map: 'm60/m60_41_52_00' },
  { id: 'mountaintops', name: 'Mountaintops of the Giants', map: 'm60/m60_51_57_00' },
  { id: 'stormveil', name: 'Stormveil Castle', map: 'm10/m10_00_00_00' },
  { id: 'leyndell', name: 'Leyndell, Royal Capital', map: 'm11/m11_00_00_00' },
  { id: 'ashen', name: 'Leyndell, Ashen Capital', map: 'm11/m11_05_00_00' },
  { id: 'raya', name: 'Raya Lucaria Academy', map: 'm14/m14_00_00_00' },
  { id: 'haligtree', name: "Miquella's Haligtree", map: 'm15/m15_00_00_00' },
  { id: 'volcano', name: 'Volcano Manor', map: 'm16/m16_00_00_00' },
  { id: 'farum', name: 'Crumbling Farum Azula', map: 'm13/m13_00_00_00' },
  { id: 'siofra', name: 'Siofra River', map: 'm12/m12_02_00_00' },
  { id: 'ainsel', name: 'Ainsel River', map: 'm12/m12_01_00_00' },
  { id: 'shadow', name: 'Realm of Shadow', map: 'm61/m61_45_41_00' },
]

/** Names for envmap_00..06, judged from the probes themselves (sun/moon position, colour). */
export const TIME_NAMES = ['Morning', 'Day', 'Afternoon', 'Dusk', 'Night', 'Late night', 'Before dawn']

/** Read-only access to game files (loose or inside the packed archives): GameFiles. */
export interface GameFileReader {
  has(rel: string): boolean
  read(rel: string): Buffer
}

function envmapFile(map: string, time: number): string {
  const name = path.basename(map)
  return `map/${map}/${name}_envmap_${String(time).padStart(2, '0')}_high_00.tpfbnd.dcx`
}

/** Which times of day an area has (indices into TIME_NAMES). */
export function areaTimes(game: GameFileReader, area: EnvironmentArea): number[] {
  if (!area.map) return []
  return TIME_NAMES.map((_, i) => i).filter((i) => game.has(envmapFile(area.map!, i)))
}

export interface LoadedEnvironment {
  image: HdrImage
  /** Probes in this area/time bundle (the "spot" can pick any of them). */
  probes: number
  probe: number
  probeName: string
  /** Mean luminance of the probe, before any exposure. */
  luminance: number
}

/**
 * Reads one light probe (read-only) and unwraps it to an equirect HDR image.
 * `time` and `probe` are clamped to what exists.
 */
export function loadEnvironment(
  game: GameFileReader,
  areaId: string,
  time = 1,
  probe = 0,
  width = 512,
): LoadedEnvironment {
  const area = ENVIRONMENT_AREAS.find((a) => a.id === areaId) ?? ENVIRONMENT_AREAS[0]
  let faces: CubeFaces
  let probes = 1
  let probeName = 'modelviewer_default_rem'
  if (!area.map) {
    faces = decodeCubeFaces(game.read('other/modelviewer_default_rem.dds'))
    probe = 0
  } else {
    const times = areaTimes(game, area)
    if (!times.length) throw new Error(`No light probes found for ${area.name}`)
    const t = times.includes(time) ? time : times.includes(1) ? 1 : times[0]
    const bnd = readBnd4(dcxDecompress(game.read(envmapFile(area.map, t))).data)
    const rems = bnd.entries.filter((e) => e.name.endsWith('_rem.tpf'))
    if (!rems.length) throw new Error(`No light probes found for ${area.name}`)
    probes = rems.length
    probe = Math.max(0, Math.min(probes - 1, Math.floor(probe)))
    const tex = readTpf(rems[probe].data)[0]
    probeName = tex.name
    faces = decodeCubeFaces(tex.dds)
  }
  const image = cubeToEquirect(faces, width, width / 2)
  return { image, probes, probe, probeName, luminance: luminance(averageColor(image)) }
}
