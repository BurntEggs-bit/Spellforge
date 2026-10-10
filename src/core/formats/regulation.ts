/**
 * regulation.bin — Elden Ring's param bundle.
 *
 * Layout: AES-256-CBC (16-byte IV prepended) wrapping a DCX stream, which
 * decompresses to a BND4 holding 194 `.param` files. Elden Ring's regulation
 * key is public and is the same one every souls param editor uses.
 *
 * Credit: Smithbox (Vawser and contributors) and the param editors before it
 * published the key and the layout.
 *
 * Verified against retail regulation.bin: the inner stream is DCX/ZSTD and
 * yields Bullet.param, AtkParam_Pc.param, SpEffectParam.param and the rest.
 */
import crypto from 'node:crypto'
import { dcxCompress, dcxDecompress, type DcxInfo } from './dcx.ts'
import { readBnd4, writeBnd4, type Bnd4 } from './bnd4.ts'

const ER_REGULATION_KEY = Buffer.from('99BFFC366A6BC8C6F5827D093602D676C42892A01C207FB024D3AF4E493FEF99', 'hex')

const BLOCK_SIZE = 16

export interface RegulationBundle {
  bnd: Bnd4
  /** Captured so a re-write matches how the original was packed. */
  dcx: DcxInfo
  iv: Buffer
}

function decrypt(buf: Buffer): Buffer {
  const iv = buf.subarray(0, BLOCK_SIZE)
  const decipher = crypto.createDecipheriv('aes-256-cbc', ER_REGULATION_KEY, iv)
  decipher.setAutoPadding(false)
  return Buffer.concat([decipher.update(buf.subarray(BLOCK_SIZE)), decipher.final()])
}

function encrypt(plain: Buffer, iv: Buffer): Buffer {
  // The payload must be a whole number of AES blocks; FromSoft zero-pads.
  const padding = (BLOCK_SIZE - (plain.length % BLOCK_SIZE)) % BLOCK_SIZE
  const padded = padding === 0 ? plain : Buffer.concat([plain, Buffer.alloc(padding)])
  const cipher = crypto.createCipheriv('aes-256-cbc', ER_REGULATION_KEY, iv)
  cipher.setAutoPadding(false)
  return Buffer.concat([iv, cipher.update(padded), cipher.final()])
}

export function readRegulation(buf: Buffer): RegulationBundle {
  const iv = Buffer.from(buf.subarray(0, BLOCK_SIZE))
  const inner = decrypt(buf)
  const { data, info } = dcxDecompress(inner)
  return { bnd: readBnd4(data), dcx: info, iv }
}

export interface WriteRegulationOptions {
  /** Reuse the original IV instead of a fresh random one (used by round-trip tests). */
  reuseIv?: boolean
}

export function writeRegulation(bundle: RegulationBundle, options: WriteRegulationOptions = {}): Buffer {
  const bnd = writeBnd4(bundle.bnd)
  // Level 15 is what Smithbox writes: ~1 s instead of ~12 s at retail's 21,
  // for a file about 15% larger.
  const dcx = bundle.dcx.format === 'ZSTD' ? { format: 'ZSTD' as const, level: 15 } : bundle.dcx
  const compressed = dcxCompress(bnd, dcx)
  const iv = options.reuseIv ? bundle.iv : crypto.randomBytes(BLOCK_SIZE)
  return encrypt(compressed, iv)
}

const SEP = String.fromCharCode(92)

/** `N:\GR\data\...\Bullet.param` -> `Bullet` */
export function paramNameFromPath(path: string): string {
  const base = path.slice(Math.max(path.lastIndexOf(SEP), path.lastIndexOf('/')) + 1)
  return base.replace(/\.param$/i, '')
}
