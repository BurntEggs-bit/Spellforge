/**
 * Wwise Vorbis sounds (.wem, codec 0xFFFF) as standard Ogg Vorbis, which a
 * browser plays (AudioContext.decodeAudioData).
 *
 * A .wem is a RIFF file: 'fmt ', 'data' and sometimes markers and loops
 * (cue, smpl, LIST: not needed to play it); chunks aren't padded to even
 * sizes. Every Elden Ring sound (Wwise 2019) has the newer layout: a fmt of
 * 0x42 bytes, a WAVEFORMATEX (codec 0xFFFF, channels, sample rate, average
 * bytes a second; block align and bits per sample 0) with 0x30 bytes of
 * extra: u16 0, u32 channel mask, then the Vorbis fields (a 'vorb' chunk of
 * their own in older versions) from fmt + 0x18:
 *
 *   0x00 u32 sample count            0x10 u32 setup packet offset (in data)
 *   0x04 u32 "mod signal"            0x14 u32 first audio packet offset
 *   0x24 u32 encoder id              0x28 u8, u8 block size exponents (short, long)
 *
 * data holds a seek table (when the setup offset isn't 0), then the Vorbis
 * packets, each a u16 size and its bytes: no Ogg pages, no granule
 * positions. Wwise leaves out all it can rebuild:
 *   - the identification and comment headers (rebuilt from fmt);
 *   - in the setup header, the fields with one possible value (floor,
 *     mapping, window and transform types; the time-domain placeholders),
 *     and the residue type narrowed to 2 bits. Codebooks are 10-bit ids into
 *     a library every Wwise encoder shares (aoTuV 6.03's,
 *     data/er/wwise/packed_codebooks_aoTuV_603.bin), itself packed:
 *     dimensions in 4 bits, entries in 14, codeword lengths in as few bits
 *     as they need, the lookup type in 1;
 *   - in audio packets ("modified packets", which the mod signal tells; all
 *     of Elden Ring's), the packet-type bit and, for long blocks, the
 *     previous/next window flags, which follow from the modes of the packets
 *     either side.
 *
 * Conversion rebuilds the three headers and each audio packet's first bits,
 * then pages it all into Ogg: the identification header alone on the first
 * page, comment and setup on the next, audio on pages of about 4 KB (never
 * all on one: a short sound's last packet gets a page of its own, else
 * Chromium's decoder, FFmpeg's, cuts it short). A page's granule position
 * is the sample its last packet ends at, counted from the block sizes (a
 * packet adds a quarter of its own block and of the one before; the first
 * adds nothing); the last page's is the sample count, so a decoder trims
 * the encoder's padding at the end (always within the last packet).
 *
 * A bank may hold only a sound's first packets (prefetch; the whole .wem is
 * streamed from sd/wem/<first two digits>/<id>.wem): wemInfo says so
 * (truncated) and wemToOgg refuses it unless asked for the part that's there.
 * Older layouts (vorb chunks of 0x2A, 0x32, 0x34 bytes: 2- or 6-byte packet
 * headers, plain or modified packets) are read the way ww2ogg reads them;
 * the oldest (2009: full headers stored, 8-byte packet headers) and sounds
 * with codebooks of their own are refused.

 *
 * Credit: ww2ogg (Adam Gashlin; BSD-3-Clause, notice in
 * THIRD_PARTY_NOTICES.txt): the algorithm is ww2ogg's. Vorbis (Xiph.org
 * Foundation): the format, Tremor's codebook rules and the aoTuV codebooks.
 */

/** Codec ids of fmt (WAVE format tags; Wwise's own above 0x3000). */
const CODECS: Record<number, string> = {
  0x0001: 'pcm',
  0xfffe: 'pcm',
  0x0002: 'adpcm',
  0x0165: 'xma',
  0x0166: 'xma2',
  0x3039: 'opus',
  0x3040: 'opus',
  0x3041: 'opus',
  0x8311: 'ptadpcm',
  0xffff: 'vorbis',
}
const VORBIS = 0xffff

/** Mod signals of files whose audio packets are plain Vorbis (any other value: modified packets). */
const PLAIN_PACKET_SIGNALS = [0x4a, 0x4b, 0x69, 0x70]

/** Audio pages are closed once they hold this many bytes (libogg's choice). */
const PAGE_BYTES = 4096

/* ---------------------------------- RIFF ---------------------------------- */

interface Chunk {
  at: number
  size: number
}

interface Riff {
  fmt: Chunk
  data: Chunk
  vorb?: Chunk
  /** The file says it's longer than it is: a bank's prefetch copy of a streamed sound. */
  truncated: boolean
}

function readRiff(wem: Buffer): Riff {
  if (wem.length < 12) throw new Error('Not a .wem sound (too short)')
  const magic = wem.toString('latin1', 0, 4)
  if (magic === 'RIFX') throw new Error('Big-endian (console) .wem sounds aren’t supported')
  if (magic !== 'RIFF' || wem.toString('latin1', 8, 12) !== 'WAVE')
    throw new Error('Not a .wem sound (no RIFF/WAVE header)')
  const end = 8 + wem.readUInt32LE(4)
  const chunks = new Map<string, Chunk>()
  for (let at = 12; at + 8 <= Math.min(end, wem.length);) {
    const tag = wem.toString('latin1', at, at + 4)
    const size = wem.readUInt32LE(at + 4)
    if (!chunks.has(tag)) chunks.set(tag, { at: at + 8, size })
    at += 8 + size
  }
  const fmt = chunks.get('fmt ')
  const data = chunks.get('data')
  if (!fmt || fmt.size < 0x10 || fmt.at + fmt.size > wem.length) throw new Error('The .wem has no format (fmt) chunk')
  if (!data) throw new Error('The .wem has no data chunk')
  const vorb = chunks.get('vorb')
  if (vorb && vorb.at + vorb.size > wem.length) throw new Error('The .wem’s vorb chunk runs past its end')
  return { fmt, data, vorb, truncated: end > wem.length || data.at + data.size > wem.length }
}

interface Fmt {
  codec: number
  channels: number
  sampleRate: number
  avgBytesPerSecond: number
  bitsPerSample: number
}

function readFmt(wem: Buffer, riff: Riff): Fmt {
  const at = riff.fmt.at
  return {
    codec: wem.readUInt16LE(at),
    channels: wem.readUInt16LE(at + 2),
    sampleRate: wem.readUInt32LE(at + 4),
    avgBytesPerSecond: wem.readUInt32LE(at + 8),
    bitsPerSample: wem.readUInt16LE(at + 14),
  }
}

/** The Vorbis fields: where the packets are and how they're stored. */
interface Vorb {
  samples: number
  /** Bytes before each packet: 2 (u16 size) or 6 (u16 size, u32 granule). */
  header: number
  /** Audio packets lack their type bit and window flags. */
  modPackets: boolean
  setupOffset: number
  audioOffset: number
  blocksize0: number
  blocksize1: number
}

function readVorb(wem: Buffer, riff: Riff, fmtSize: number): Vorb {
  let at: number
  let size: number // -1: inside fmt
  if (riff.vorb) {
    if (fmtSize !== 0x28 && fmtSize !== 0x18 && fmtSize !== 0x12)
      throw new Error(`Unknown Wwise Vorbis layout (fmt of 0x${fmtSize.toString(16)} bytes beside a vorb chunk)`)
    at = riff.vorb.at
    size = riff.vorb.size
  } else {
    if (fmtSize !== 0x42)
      throw new Error(`Unknown Wwise Vorbis layout (fmt of 0x${fmtSize.toString(16)} bytes, no vorb chunk)`)
    at = riff.fmt.at + 0x18
    size = -1
  }
  if (size === 0x28 || size === 0x2c)
    throw new Error('Wwise Vorbis from 2009 (headers stored whole, 8-byte packet headers) isn’t supported')
  if (size !== -1 && size !== 0x2a && size !== 0x32 && size !== 0x34)
    throw new Error(`Unknown Wwise Vorbis layout (vorb chunk of 0x${size.toString(16)} bytes)`)
  // Newer: 2-byte packet headers, offsets at 0x10, block sizes at 0x28. Older (0x32, 0x34): 6-byte headers, 0x18, 0x30.
  const newer = size === -1 || size === 0x2a
  const offsets = at + (newer ? 0x10 : 0x18)
  const blocks = at + (newer ? 0x28 : 0x30)
  return {
    samples: wem.readUInt32LE(at),
    header: newer ? 2 : 6,
    modPackets: newer && !PLAIN_PACKET_SIGNALS.includes(wem.readUInt32LE(at + 4)),
    setupOffset: wem.readUInt32LE(offsets),
    audioOffset: wem.readUInt32LE(offsets + 4),
    blocksize0: wem[blocks],
    blocksize1: wem[blocks + 1],
  }
}

/** A packet's payload (after its header), or null when it runs past `end`. */
function packetAt(wem: Buffer, at: number, header: number, end: number): Chunk | null {
  if (at + header > end) return null
  const size = wem.readUInt16LE(at)
  if (at + header + size > end) return null
  return { at: at + header, size }
}

/* ---------------------------------- info ---------------------------------- */

export interface WemInfo {
  /** fmt's codec id: 0xFFFF Wwise Vorbis (every Elden Ring sound), 0xFFFE PCM, 0x0002 ADPCM, 0x3040 Opus... */
  codec: number
  codecName: string
  channels: number
  sampleRate: number
  /** Samples per channel, when the file says (Vorbis) or they follow from its size (PCM). */
  samples?: number
  durationSec: number
  /** The file holds only the start of the sound (a bank's prefetch copy; the whole .wem is streamed). */
  truncated: boolean
}

export function wemInfo(wem: Buffer): WemInfo {
  const riff = readRiff(wem)
  const fmt = readFmt(wem, riff)
  let samples: number | undefined
  if (fmt.codec === VORBIS) {
    // The sample count leads the Vorbis fields in every layout.
    const at = riff.vorb ? riff.vorb.at : riff.fmt.size >= 0x1c ? riff.fmt.at + 0x18 : -1
    if (at >= 0) samples = wem.readUInt32LE(at)
  } else if (CODECS[fmt.codec] === 'pcm' && fmt.channels && fmt.bitsPerSample)
    samples = Math.floor(riff.data.size / (fmt.channels * (fmt.bitsPerSample / 8)))
  const durationSec =
    samples !== undefined && fmt.sampleRate
      ? samples / fmt.sampleRate
      : fmt.avgBytesPerSecond
        ? riff.data.size / fmt.avgBytesPerSecond
        : 0
  return {
    codec: fmt.codec,
    codecName: CODECS[fmt.codec] ?? 'unknown',
    channels: fmt.channels,
    sampleRate: fmt.sampleRate,
    samples,
    durationSec,
    truncated: riff.truncated,
  }
}

/* ------------------------------- bit streams ------------------------------- */

/** Reads bits least significant first (Vorbis's order) from bytes [start, end) of a buffer. */
class BitReader {
  /** Bits read so far. */
  pos = 0
  private readonly b: Uint8Array
  private readonly start: number
  private readonly end: number
  private readonly what: string
  constructor(b: Uint8Array, start: number, end: number, what: string) {
    this.b = b
    this.start = start
    this.end = end
    this.what = what
  }
  read(n: number): number {
    let v = 0
    for (let i = 0; i < n;) {
      const at = this.start + (this.pos >>> 3)
      if (at >= this.end) throw new Error(`${this.what} ends early`)
      const off = this.pos & 7
      const take = Math.min(8 - off, n - i)
      v += ((this.b[at] >>> off) & ((1 << take) - 1)) * 2 ** i
      i += take
      this.pos += take
    }
    return v
  }
}

/** Writes bits least significant first; the last byte is padded with zeros. */
class BitWriter {
  /** Bits written so far. */
  pos = 0
  private b: Uint8Array
  constructor(capacity = 256) {
    this.b = new Uint8Array(Math.max(16, capacity))
  }
  private room(bits: number): void {
    const need = ((this.pos + bits) >>> 3) + 2
    if (need <= this.b.length) return
    const grown = new Uint8Array(Math.max(need, this.b.length * 2))
    grown.set(this.b)
    this.b = grown
  }
  /** The low n bits (n ≤ 32) of v. */
  write(v: number, n: number): void {
    if (!(v >= 0 && v < 2 ** n)) throw new Error(`${v} doesn’t fit in ${n} bits`)
    this.room(n)
    for (let i = 0; i < n;) {
      const off = this.pos & 7
      const take = Math.min(8 - off, n - i)
      this.b[this.pos >>> 3] |= (Math.floor(v / 2 ** i) & ((1 << take) - 1)) << off
      i += take
      this.pos += take
    }
  }
  /** Bytes [start, end) of src, at whatever bit the writer is. */
  bytes(src: Uint8Array, start: number, end: number): void {
    const n = end - start
    if (n <= 0) return
    this.room(n * 8)
    const off = this.pos & 7
    let at = this.pos >>> 3
    if (off === 0) this.b.set(src.subarray(start, end), at)
    else {
      const back = 8 - off
      for (let i = start; i < end; i++) {
        const c = src[i]
        this.b[at] |= (c << off) & 0xff
        this.b[++at] = c >>> back
      }
    }
    this.pos += n * 8
  }
  /** The first `bits` bits of src (another writer's result). */
  bits(src: Uint8Array, bits: number): void {
    this.bytes(src, 0, bits >>> 3)
    if (bits & 7) this.write(src[bits >>> 3] & ((1 << (bits & 7)) - 1), bits & 7)
  }
  result(): Uint8Array {
    return this.b.slice(0, (this.pos + 7) >>> 3)
  }
}

function ilog(v: number): number {
  let r = 0
  for (; v; v >>>= 1) r++
  return r
}

function writeAscii(w: BitWriter, s: string): void {
  for (let i = 0; i < s.length; i++) w.write(s.charCodeAt(i) & 0xff, 8)
}

/** Lookup type 1's value count: the largest v with v^dimensions ≤ entries (Tremor's _book_maptype1_quantvals). */
function quantvals(entries: number, dimensions: number): number {
  if (!entries || !dimensions) throw new Error('A codebook with a lookup table has no entries or dimensions')
  let vals = Math.floor(entries / 2 ** Math.floor(((ilog(entries) - 1) * (dimensions - 1)) / dimensions))
  for (;;) {
    let acc = 1
    let acc1 = 1
    for (let i = 0; i < dimensions; i++) {
      acc *= vals
      acc1 *= vals + 1
    }
    if (acc <= entries && acc1 > entries) return vals
    vals += acc > entries ? -1 : 1
  }
}

/* -------------------------------- codebooks -------------------------------- */

/** A packed codebook library: the codebooks, then a table of where each starts, the table's own place last. */
interface CodebookLibrary {
  data: Buffer
  /** One more than there are codebooks: the last is where the table starts. */
  offsets: number[]
  /** Codebooks already expanded, by id: their bits as a Vorbis setup header has them. */
  expanded: Map<number, { bytes: Uint8Array; bits: number }>
}

const libraries = new WeakMap<Buffer, CodebookLibrary>()

function codebookLibrary(buf: Buffer): CodebookLibrary {
  const known = libraries.get(buf)
  if (known) return known
  const bad = () => new Error('Not a packed Vorbis codebook library (packed_codebooks_aoTuV_603.bin)')
  if (buf.length < 8) throw bad()
  const table = buf.readUInt32LE(buf.length - 4)
  if (table > buf.length - 8 || (buf.length - table) % 4) throw bad()
  const offsets: number[] = []
  for (let at = table; at < buf.length; at += 4) {
    const o = buf.readUInt32LE(at)
    if (o > table || (offsets.length && o < offsets[offsets.length - 1])) throw bad()
    offsets.push(o)
  }
  const lib: CodebookLibrary = { data: buf, offsets, expanded: new Map() }
  libraries.set(buf, lib)
  return lib
}

/** A library codebook as a Vorbis setup header stores it. */
function expandCodebook(lib: CodebookLibrary, id: number): { bytes: Uint8Array; bits: number } {
  const known = lib.expanded.get(id)
  if (known) return known
  const count = lib.offsets.length - 1
  if (id >= count)
    throw new Error(
      `The setup header names codebook ${id}, which the library (${count} codebooks) doesn’t have: the sound may carry codebooks of its own, which isn’t supported`,
    )
  const start = lib.offsets[id]
  const end = lib.offsets[id + 1]
  const r = new BitReader(lib.data, start, end, `Codebook ${id} of the library`)
  const w = new BitWriter(end - start + 16)
  const dimensions = r.read(4)
  const entries = r.read(14)
  w.write(0x564342, 24) // "BCV"
  w.write(dimensions, 16)
  w.write(entries, 24)
  const ordered = r.read(1)
  w.write(ordered, 1)
  if (ordered) {
    w.write(r.read(5), 5) // initial length
    let entry = 0
    while (entry < entries) {
      const bits = ilog(entries - entry)
      const n = r.read(bits)
      w.write(n, bits)
      entry += n
    }
    if (entry > entries) throw new Error(`Codebook ${id} of the library has more lengths than entries`)
  } else {
    // Packed: lengths take only as many bits as they need (stored: 5).
    const lengthBits = r.read(3)
    const sparse = r.read(1)
    if (lengthBits === 0 || lengthBits > 5)
      throw new Error(`Codebook ${id} of the library has nonsense codeword lengths`)
    w.write(sparse, 1)
    for (let i = 0; i < entries; i++) {
      let present = 1
      if (sparse) {
        present = r.read(1)
        w.write(present, 1)
      }
      if (present) w.write(r.read(lengthBits), 5)
    }
  }
  const lookup = r.read(1) // packed: 1 bit (stored: 4)
  w.write(lookup, 4)
  if (lookup === 1) {
    w.write(r.read(32), 32) // minimum value
    w.write(r.read(32), 32) // delta
    const valueBits = r.read(4)
    w.write(valueBits, 4)
    w.write(r.read(1), 1) // sequence flag
    const n = quantvals(entries, dimensions)
    for (let i = 0; i < n; i++) w.write(r.read(valueBits + 1), valueBits + 1)
  }
  // Each packed codebook ends in its last byte, with at least one bit to spare.
  if ((r.pos >>> 3) + 1 !== end - start)
    throw new Error(`Codebook ${id} of the library reads as ${(r.pos >>> 3) + 1} bytes, not its ${end - start}`)
  const out = { bytes: w.result(), bits: w.pos }
  lib.expanded.set(id, out)
  return out
}

/* ---------------------------------- setup ---------------------------------- */

/**
 * Rebuilds the setup header from Wwise's packed one (external codebooks):
 * the fields Wwise left out are put back. Returns each mode's block flag.
 */
function rebuildSetup(r: BitReader, w: BitWriter, lib: CodebookLibrary, channels: number): boolean[] {
  const copy = (bits: number): number => {
    const v = r.read(bits)
    w.write(v, bits)
    return v
  }
  const check = (ok: boolean, what: string) => {
    if (!ok) throw new Error(`The setup header has ${what}`)
  }
  w.write(5, 8)
  writeAscii(w, 'vorbis')

  const codebooks = copy(8) + 1
  for (let i = 0; i < codebooks; i++) {
    const cb = expandCodebook(lib, r.read(10))
    w.bits(cb.bytes, cb.bits)
  }
  // Time-domain transforms: one placeholder (Wwise drops it).
  w.write(0, 6)
  w.write(0, 16)

  const floors = copy(6) + 1
  for (let i = 0; i < floors; i++) {
    w.write(1, 16) // floor type: always 1
    const partitions = copy(5)
    const classOf: number[] = []
    let maxClass = -1
    for (let j = 0; j < partitions; j++) {
      classOf.push(copy(4))
      maxClass = Math.max(maxClass, classOf[j])
    }
    const dims: number[] = []
    for (let j = 0; j <= maxClass; j++) {
      dims.push(copy(3) + 1)
      const subclasses = copy(2)
      if (subclasses) check(copy(8) < codebooks, 'a floor master book out of range')
      for (let k = 0; k < 1 << subclasses; k++) check(copy(8) - 1 < codebooks, 'a floor subclass book out of range')
    }
    copy(2) // multiplier - 1
    const rangeBits = copy(4)
    for (const c of classOf) for (let k = 0; k < dims[c]; k++) copy(rangeBits)
  }

  const residues = copy(6) + 1
  for (let i = 0; i < residues; i++) {
    const type = r.read(2) // packed: 2 bits (stored: 16)
    check(type <= 2, `residue type ${type}`)
    w.write(type, 16)
    copy(24) // begin
    copy(24) // end
    copy(24) // partition size - 1
    const classifications = copy(6) + 1
    check(copy(8) < codebooks, 'a residue class book out of range')
    const cascade: number[] = []
    for (let j = 0; j < classifications; j++) {
      const low = copy(3)
      const high = copy(1) ? copy(5) : 0
      cascade.push(high * 8 + low)
    }
    for (const c of cascade)
      for (let k = 0; k < 8; k++) if (c & (1 << k)) check(copy(8) < codebooks, 'a residue book out of range')
  }

  const mappings = copy(6) + 1
  for (let i = 0; i < mappings; i++) {
    w.write(0, 16) // mapping type: always 0
    const submaps = copy(1) ? copy(4) + 1 : 1
    if (copy(1)) {
      // Square polar coupling: channel pairs.
      const steps = copy(8) + 1
      const bits = ilog(channels - 1)
      for (let j = 0; j < steps; j++) {
        const magnitude = copy(bits)
        const angle = copy(bits)
        check(magnitude !== angle && magnitude < channels && angle < channels, 'a bad channel coupling')
      }
    }
    check(copy(2) === 0, 'a mapping’s reserved field set')
    if (submaps > 1) for (let j = 0; j < channels; j++) check(copy(4) < submaps, 'a channel in a submap out of range')
    for (let j = 0; j < submaps; j++) {
      copy(8) // time-domain placeholder
      check(copy(8) < floors, 'a mapping’s floor out of range')
      check(copy(8) < residues, 'a mapping’s residue out of range')
    }
  }

  const modes = copy(6) + 1
  const blockflags: boolean[] = []
  for (let i = 0; i < modes; i++) {
    blockflags.push(copy(1) === 1)
    w.write(0, 16) // window type
    w.write(0, 16) // transform type
    check(copy(8) < mappings, 'a mode’s mapping out of range')
  }
  w.write(1, 1) // framing
  return blockflags
}

/* ----------------------------------- Ogg ----------------------------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let r = i << 24
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1
    t[i] = r >>> 0
  }
  return t
})()

/** Ogg's CRC-32 (polynomial 0x04C11DB7, most significant bit first, no reflection, no final xor). */
function oggCrc(b: Uint8Array, crc = 0): number {
  for (let i = 0; i < b.length; i++) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b[i]) & 0xff]) >>> 0
  return crc
}

/** Packets into the pages of one Ogg stream. */
class OggWriter {
  private readonly out: Buffer[] = []
  private lacing: number[] = []
  private parts: Uint8Array[] = []
  private size = 0
  /** Granule position of the last packet that ends on the page being filled (-1: none). */
  private granule = -1n
  /** The page being filled starts with the rest of a packet. */
  private continued = false
  private seq = 0
  private readonly serial: number
  constructor(serial: number) {
    this.serial = serial
  }

  /** Pages ended so far. */
  get pages(): number {
    return this.seq
  }

  packet(p: Uint8Array, granule: bigint): void {
    if (this.size >= PAGE_BYTES) this.page()
    // Lacing: 255-byte segments, then one shorter (maybe empty) that ends the packet.
    for (let at = 0; ;) {
      if (this.lacing.length === 255) this.page(at > 0)
      const n = Math.min(255, p.length - at)
      this.lacing.push(n)
      this.parts.push(p.subarray(at, at + n))
      this.size += n
      at += n
      if (n < 255) break
    }
    this.granule = granule
  }

  /** Ends the page being filled (if any). */
  page(nextContinued = false, last = false): void {
    if (!this.lacing.length) return
    const head = Buffer.alloc(27 + this.lacing.length)
    head.write('OggS', 0, 'latin1')
    head[5] = (this.continued ? 1 : 0) | (this.seq === 0 ? 2 : 0) | (last ? 4 : 0)
    head.writeBigInt64LE(this.granule, 6)
    head.writeUInt32LE(this.serial, 14)
    head.writeUInt32LE(this.seq++, 18)
    head[26] = this.lacing.length
    head.set(this.lacing, 27)
    const body = Buffer.concat(this.parts)
    head.writeUInt32LE(oggCrc(body, oggCrc(head)), 22)
    this.out.push(head, body)
    this.lacing = []
    this.parts = []
    this.size = 0
    this.granule = -1n
    this.continued = nextContinued
  }

  /** The stream, its last page marked as such. */
  end(): Buffer {
    if (this.lacing.length) this.page(false, true)
    else if (this.out.length) {
      const head = this.out[this.out.length - 2]
      head[5] |= 4
      head.writeUInt32LE(0, 22)
      head.writeUInt32LE(oggCrc(this.out[this.out.length - 1], oggCrc(head)), 22)
    }
    return Buffer.concat(this.out)
  }
}

/* --------------------------------- convert --------------------------------- */

export interface WemToOggOptions {
  /** A bank's prefetch copy (only the sound's start): convert the packets that are there instead of refusing. */
  partial?: boolean
}

/**
 * A Wwise Vorbis .wem as an Ogg Vorbis file. `codebooks` is the packed
 * codebook library (data/er/wwise/packed_codebooks_aoTuV_603.bin); pass the
 * same Buffer each time, codebooks are expanded once per library.
 */
export function wemToOgg(wem: Buffer, codebooks: Buffer, options: WemToOggOptions = {}): Buffer {
  const riff = readRiff(wem)
  const fmt = readFmt(wem, riff)
  if (fmt.codec !== VORBIS)
    throw new Error(`Not a Wwise Vorbis sound (codec 0x${fmt.codec.toString(16)}, ${CODECS[fmt.codec] ?? 'unknown'})`)
  if (riff.truncated && !options.partial)
    throw new Error(
      'The .wem holds only the start of its sound (a bank’s prefetch copy: the whole .wem is streamed from sd/wem)',
    )
  if (fmt.channels < 1 || fmt.channels > 255) throw new Error(`A sound with ${fmt.channels} channels`)
  if (!fmt.sampleRate) throw new Error('A sound with a sample rate of 0')
  const v = readVorb(wem, riff, riff.fmt.size)
  if (v.blocksize0 < 6 || v.blocksize1 > 13 || v.blocksize0 > v.blocksize1)
    throw new Error(`Bad Vorbis block sizes (2^${v.blocksize0}, 2^${v.blocksize1})`)
  const lib = codebookLibrary(codebooks)
  const dataEnd = Math.min(riff.data.at + riff.data.size, wem.length)

  // Setup.
  const setup = packetAt(wem, riff.data.at + v.setupOffset, v.header, dataEnd)
  if (!setup) throw new Error('The setup header runs past the sound’s data')
  if (setup.at + setup.size !== riff.data.at + v.audioOffset)
    throw new Error('The first audio packet doesn’t follow the setup header')
  if (v.header === 6 && (wem.toString('latin1', setup.at + 1, setup.at + 4) === 'BCV' || setup.size > 0x200))
    throw new Error('Wwise Vorbis with codebooks of its own (inline or full setup) isn’t supported')
  const setupOut = new BitWriter(setup.size * 4)
  const r = new BitReader(wem, setup.at, setup.at + setup.size, 'The setup header')
  const blockflags = rebuildSetup(r, setupOut, lib, fmt.channels)
  if ((r.pos + 7) >>> 3 !== setup.size)
    throw new Error(
      `The setup header reads as ${(r.pos + 7) >>> 3} bytes, not its ${setup.size} (a different codebook library?)`,
    )
  const modeBits = ilog(blockflags.length - 1)

  // Audio packets, and the mode (so the block size) of each.
  const packets: Chunk[] = []
  for (let at = riff.data.at + v.audioOffset; at < dataEnd;) {
    const p = packetAt(wem, at, v.header, dataEnd)
    if (!p) {
      if (riff.truncated) break
      throw new Error(`Audio packet ${packets.length} runs past the sound’s data`)
    }
    packets.push(p)
    at = p.at + p.size
  }
  const modes = packets.map((p, i) => {
    if (!p.size) throw new Error(`Audio packet ${i} is empty`)
    const b = wem[p.at]
    if (!v.modPackets && b & 1) throw new Error(`Audio packet ${i} isn’t an audio packet`)
    const mode = (v.modPackets ? b : b >>> 1) & ((1 << modeBits) - 1)
    if (mode >= blockflags.length)
      throw new Error(`Audio packet ${i} uses mode ${mode}; the setup has ${blockflags.length}`)
    return mode
  })
  const long = (i: number) => i >= 0 && i < modes.length && blockflags[modes[i]]

  // Granule positions: the first packet decodes to nothing, the others to a quarter of their block and of the one before.
  const size = (i: number) => (long(i) ? 1 << v.blocksize1 : 1 << v.blocksize0)
  const granules: number[] = []
  let sample = 0
  for (let i = 0; i < packets.length; i++) {
    if (i) sample += (size(i - 1) + size(i)) / 4
    granules.push(sample)
  }
  // The last page says where the sound ends: the decoder drops the encoder's padding past it,
  // within the last packet only, so packets wholly past the end (none in Elden Ring) are left out.
  let count = packets.length
  if (!riff.truncated) {
    while (count > 2 && granules[count - 2] >= v.samples) count--
    if (count && v.samples < granules[count - 1]) granules[count - 1] = v.samples
  }

  // Headers: identification (alone on the first page), comment, setup.
  const ogg = new OggWriter(1)
  const id = new BitWriter(32)
  id.write(1, 8)
  writeAscii(id, 'vorbis')
  id.write(0, 32) // version
  id.write(fmt.channels, 8)
  id.write(fmt.sampleRate, 32)
  id.write(0, 32) // maximum bitrate
  id.write(Math.min(fmt.avgBytesPerSecond * 8, 0x7fffffff), 32) // nominal
  id.write(0, 32) // minimum
  id.write(v.blocksize0, 4)
  id.write(v.blocksize1, 4)
  id.write(1, 1) // framing
  ogg.packet(id.result(), 0n)
  ogg.page()
  const vendor = 'Spellforge, from Audiokinetic Wwise (after ww2ogg)'
  const comment = new BitWriter(vendor.length + 16)
  comment.write(3, 8)
  writeAscii(comment, 'vorbis')
  comment.write(vendor.length, 32)
  writeAscii(comment, vendor)
  comment.write(0, 32) // no user comments
  comment.write(1, 1) // framing
  ogg.packet(comment.result(), 0n)
  ogg.packet(setupOut.result(), 0n)
  ogg.page() // audio starts on a page of its own

  // Audio: modified packets get back their type bit and, for long blocks, the window flags.
  const firstAudioPage = ogg.pages
  for (let i = 0; i < count; i++) {
    // The first audio page is never the last: FFmpeg (so Chromium) skips its start-of-stream
    // reckoning on a page that ends the stream, then trims a packet too much off the end.
    if (i && i === count - 1 && ogg.pages === firstAudioPage) ogg.page()
    const p = packets[i]
    let out: Uint8Array
    if (v.modPackets) {
      const w = new BitWriter(p.size + 2)
      w.write(0, 1) // audio packet
      w.write(modes[i], modeBits)
      if (long(i)) {
        w.write(long(i - 1) ? 1 : 0, 1) // previous window long
        w.write(long(i + 1) ? 1 : 0, 1) // next window long
      }
      w.write(wem[p.at] >>> modeBits, 8 - modeBits)
      w.bytes(wem, p.at + 1, p.at + p.size)
      out = w.result()
    } else out = wem.subarray(p.at, p.at + p.size)
    ogg.packet(out, BigInt(granules[i]))
  }
  return ogg.end()
}
