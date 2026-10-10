/**
 * MATBIN (Elden Ring material instances), read-only: just the texture
 * samplers. FLVER materials in ER often leave texture paths blank and name a
 * material file instead (the "mtd" path); the textures live in the MATBIN
 * of the same name in material/allmaterial*.matbinbnd.dcx, e.g.
 *
 *   S[ShiningStone].matbin   C_Crystal__snp_Texture2D_1_AlbedoMap = ...\Sfx\Tex\s34050_a.tif
 *
 * Layout ("MAB\0", version 2): shader path offset (i64), source path offset
 * (i64), key, param count, sampler count, 0x14 padding; params 0x28 each,
 * then samplers 0x30 each: type offset (i64), path offset (i64), key,
 * 2 floats, 0x14 padding. Strings are UTF-16.
 *
 * Credit: SoulsFormats (TKGP; GPL-3.0, read as documentation only) documents
 * the MATBIN layout.
 */
import { readBnd4 } from './bnd4.ts'
import { dcxDecompress } from './dcx.ts'
import { fileNameOf } from './paths.ts'

export interface MatbinSampler {
  type: string
  path: string
}

function utf16(buf: Buffer, at: number): string {
  if (at <= 0 || at >= buf.length) return ''
  let e = at
  while (e + 1 < buf.length && buf.readUInt16LE(e) !== 0) e += 2
  return buf.toString('utf16le', at, e)
}

/**
 * Shader parameters by name: booleans/ints as one number, vectors as their
 * floats (type 0 bool, 1/4 int, 5 float2, 8 float, 9 float2, 10 float3,
 * 11 float4, 12 float5).
 */
function readMatbinParams(buf: Buffer): Map<string, number[]> {
  if (buf.toString('ascii', 0, 4) !== 'MAB\0') throw new Error('Not a MATBIN')
  const count = buf.readInt32LE(0x1c)
  const floats: Record<number, number> = { 5: 2, 8: 1, 9: 2, 10: 3, 11: 4, 12: 5 }
  const out = new Map<string, number[]>()
  for (let i = 0; i < count; i++) {
    const o = 0x38 + i * 0x28
    if (o + 0x28 > buf.length) break
    const name = utf16(buf, Number(buf.readBigInt64LE(o)))
    const at = Number(buf.readBigInt64LE(o + 8))
    const type = buf.readUInt32LE(o + 0x14)
    if (at <= 0 || at >= buf.length) continue
    if (type === 0) out.set(name, [buf[at]])
    else if (type === 1 || type === 4) out.set(name, [buf.readInt32LE(at)])
    else if (floats[type] && at + floats[type] * 4 <= buf.length)
      out.set(
        name,
        Array.from({ length: floats[type] }, (_, k) => buf.readFloatLE(at + k * 4)),
      )
  }
  return out
}

function readMatbinSamplers(buf: Buffer): MatbinSampler[] {
  if (buf.toString('ascii', 0, 4) !== 'MAB\0') throw new Error('Not a MATBIN')
  const paramCount = buf.readInt32LE(0x1c)
  const samplerCount = buf.readInt32LE(0x20)
  const samplersAt = 0x38 + paramCount * 0x28
  const out: MatbinSampler[] = []
  for (let i = 0; i < samplerCount; i++) {
    const o = samplersAt + i * 0x30
    if (o + 0x30 > buf.length) break
    out.push({ type: utf16(buf, Number(buf.readBigInt64LE(o))), path: utf16(buf, Number(buf.readBigInt64LE(o + 8))) })
  }
  return out
}

/** Material name (file name without extension, lower case) of an mtd/matxml/matbin path. */
function materialKey(path: string): string {
  return fileNameOf(path)
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
}

/**
 * Every MATBIN in the given binders, by material key. Later binders (DLC,
 * devpatch) override earlier ones.
 */
export class MatbinIndex {
  private entries = new Map<string, Buffer>()

  constructor(binders: Buffer[]) {
    for (const raw of binders) {
      try {
        const bnd = readBnd4(raw.toString('ascii', 0, 3) === 'DCX' ? dcxDecompress(raw).data : raw)
        for (const e of bnd.entries)
          if (e.name.toLowerCase().endsWith('.matbin')) this.entries.set(materialKey(e.name), e.data)
      } catch {
        /* unreadable binder: skip */
      }
    }
  }

  get size(): number {
    return this.entries.size
  }

  samplers(mtdPath: string): MatbinSampler[] {
    const data = this.entries.get(materialKey(mtdPath))
    if (!data) return []
    try {
      return readMatbinSamplers(data)
    } catch {
      return []
    }
  }

  /**
   * Glow colour of an emissive material (GXFT_Emissive): the shader's
   * "Glow ... color_1" (S[ShiningStone]: 0.25, 0.5, 1 = Glintstone blue),
   * scaled by g_GlowScale. Null when the material doesn't glow.
   */
  glow(mtdPath: string): number[] | null {
    const data = this.entries.get(materialKey(mtdPath))
    if (!data) return null
    try {
      const p = readMatbinParams(data)
      if (!p.get('GXFT_Emissive')?.[0]) return null
      const color = [...p.entries()].find(([k]) => /glow.*_color_1$/i.test(k))?.[1] ?? [1, 1, 1]
      const scale = p.get('g_GlowScale') ?? [1, 1, 1]
      return [0, 1, 2].map((i) => (color[i] ?? 1) * (scale[i] ?? 1))
    } catch {
      return null
    }
  }
}
