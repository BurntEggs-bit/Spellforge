/**
 * Elden Ring's game archives (Data0-3, DLC, sd): a .bhd header and a .bdt
 * data file. Read-only.
 *
 *   .bhd  RSA-encrypted with the game's public key (raw RSA, 256-byte blocks
 *         -> 255 plaintext bytes each), then "BHD5": buckets of file headers.
 *   file header (Elden Ring): u64 path hash, i32 padded size, i32 size,
 *         i64 offset in the .bdt, i64 SHA info offset, i64 AES key offset.
 *   AES key: 16-byte key, i32 range count, ranges (i64 start, i64 end) of
 *         the file that are AES-128-ECB encrypted; the rest is plain.
 *   path hash: lower-case path with forward slashes and a leading slash,
 *         hash = hash * 0x85 + char, 64-bit.

 *
 * Credit: BinderTool (Atvaark) and SoulsFormats (TKGP; read as documentation
 * only) document this format.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'

export interface Bhd5Entry {
  hash: bigint
  paddedSize: number
  size: number
  offset: number
  aes: { key: Buffer; ranges: [number, number][] } | null
}

const MASK64 = (1n << 64n) - 1n

/** Elden Ring's 64-bit path hash. */
export function erPathHash(path: string): bigint {
  let p = path.toLowerCase().replace(/\\/g, '/')
  if (!p.startsWith('/')) p = '/' + p
  let h = 0n
  for (let i = 0; i < p.length; i++) h = (h * 0x85n + BigInt(p.charCodeAt(i))) & MASK64
  return h
}

/** Decrypts a .bhd with its archive's public key. */
export function decryptBhd(data: Buffer, publicKeyPem: string): Buffer {
  const blocks = Math.floor(data.length / 256)
  const out = Buffer.alloc(blocks * 255)
  const key = crypto.createPublicKey(publicKeyPem)
  for (let i = 0; i < blocks; i++) {
    const dec = crypto.publicDecrypt(
      { key, padding: crypto.constants.RSA_NO_PADDING },
      data.subarray(i * 256, i * 256 + 256),
    )
    // Each block decrypts to a 255-byte number, left-padded to the modulus size.
    dec.copy(out, i * 255, dec.length - 255)
  }
  return out
}

export function isBhd5(decrypted: Buffer): boolean {
  return decrypted.toString('ascii', 0, 4) === 'BHD5'
}

/** File headers of a decrypted Elden Ring BHD5, by path hash. */
export function parseBhd5(b: Buffer): Map<bigint, Bhd5Entry> {
  if (!isBhd5(b)) throw new Error('Not a BHD5 header (wrong key or not an Elden Ring archive)')
  const bucketCount = b.readInt32LE(0x10)
  const bucketsOffset = b.readInt32LE(0x14)
  const entries = new Map<bigint, Bhd5Entry>()
  for (let i = 0; i < bucketCount; i++) {
    const count = b.readInt32LE(bucketsOffset + i * 8)
    const at = b.readInt32LE(bucketsOffset + i * 8 + 4)
    for (let j = 0; j < count; j++) {
      const o = at + j * 0x28
      const hash = b.readBigUInt64LE(o)
      const paddedSize = b.readInt32LE(o + 8)
      const size = b.readInt32LE(o + 12)
      const offset = Number(b.readBigInt64LE(o + 16))
      const aesOffset = Number(b.readBigInt64LE(o + 32))
      let aes: Bhd5Entry['aes'] = null
      if (aesOffset > 0) {
        const key = Buffer.from(b.subarray(aesOffset, aesOffset + 16))
        const n = b.readInt32LE(aesOffset + 16)
        const ranges: [number, number][] = []
        for (let k = 0; k < n; k++) {
          const r = aesOffset + 20 + k * 16
          ranges.push([Number(b.readBigInt64LE(r)), Number(b.readBigInt64LE(r + 8))])
        }
        aes = { key, ranges }
      }
      entries.set(hash, { hash, paddedSize, size, offset, aes })
    }
  }
  return entries
}

/** Reads one file out of a .bdt (an open file descriptor) and decrypts its encrypted ranges. */
export function readBdtEntry(fd: number, e: Bhd5Entry): Buffer {
  const length = e.paddedSize > 0 ? e.paddedSize : e.size
  const data = Buffer.alloc(length)
  let read = 0
  while (read < length) {
    const n = fs.readSync(fd, data, read, length - read, e.offset + read)
    if (n <= 0) break
    read += n
  }
  if (e.aes) {
    for (const [start, end] of e.aes.ranges) {
      if (start < 0 || end <= start || end > data.length) continue
      const decipher = crypto.createDecipheriv('aes-128-ecb', e.aes.key, null)
      decipher.setAutoPadding(false)
      const span = data.subarray(start, end)
      const plain = Buffer.concat([decipher.update(span), decipher.final()])
      plain.copy(data, start)
    }
  }
  return e.size > 0 && e.size <= data.length ? data.subarray(0, e.size) : data
}
