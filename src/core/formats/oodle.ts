/**
 * Oodle (Kraken) compression via FFI.
 *
 * Elden Ring ships `oo2core_6_win64.dll` in its game directory and every souls
 * modding tool reuses that copy rather than redistributing it. We do the same:
 * the DLL is located from the user's configured game path.
 *
 * Credit: Oodle (RAD Game Tools, Epic Games): the compressor itself, loaded
 * from the player's own game folder (oo2core); Spellforge doesn't ship it.
 */
import koffi from 'koffi'
import fs from 'node:fs'
import path from 'node:path'

export type OodleCompressor =
  | 'LZH'
  | 'LZHLW'
  | 'LZNIB'
  | 'None'
  | 'LZB16'
  | 'LZBLW'
  | 'LZA'
  | 'LZNA'
  | 'Kraken'
  | 'Mermaid'
  | 'BitKnit'
  | 'Selkie'
  | 'Hydra'
  | 'Leviathan'

const COMPRESSOR_IDS: Record<OodleCompressor, number> = {
  LZH: 0,
  LZHLW: 1,
  LZNIB: 2,
  None: 3,
  LZB16: 4,
  LZBLW: 5,
  LZA: 6,
  LZNA: 7,
  Kraken: 8,
  Mermaid: 9,
  BitKnit: 10,
  Selkie: 11,
  Hydra: 12,
  Leviathan: 13,
}

/** Oodle's block, and the seek chunk the game unpacks on its own: 256 KB of raw data. */
export const SEEK_CHUNK = 0x40000

/** Candidate DLL names, newest first. AC6 shipped Oodle 8 (`oo2core_8`). */
const DLL_NAMES = ['oo2core_9_win64.dll', 'oo2core_8_win64.dll', 'oo2core_6_win64.dll']

interface OodleBinding {
  decompress: (comp: Buffer, uncompressedSize: number) => Buffer
  compress: (raw: Buffer, compressor: OodleCompressor, level: number) => Buffer
  dllPath: string
}

let cached: OodleBinding | null = null
let searchPaths: string[] = []

/**
 * Register directories to search for the Oodle DLL. Call this before any
 * compression happens — normally with the game directory and the app's own
 * folder.
 */
export function setOodleSearchPaths(paths: string[]): void {
  searchPaths = paths.filter(Boolean)
  cached = null
}

function findOodleDll(): string | null {
  for (const dir of searchPaths) {
    for (const name of DLL_NAMES) {
      const p = path.join(dir, name)
      try {
        if (fs.statSync(p).isFile()) return p
      } catch {
        /* keep looking */
      }
    }
  }
  return null
}

function load(): OodleBinding {
  if (cached) return cached

  const dllPath = findOodleDll()
  if (!dllPath) {
    throw new Error(
      `Could not find an Oodle DLL (${DLL_NAMES.join(', ')}).\n` +
        `Searched: ${searchPaths.join(', ') || '(no paths configured)'}\n` +
        `Set your Elden Ring game directory — the DLL ships with the game.`,
    )
  }

  const lib = koffi.load(dllPath)

  // int64_t OodleLZ_Decompress(const void *compBuf, intptr_t compBufSize,
  //   void *rawBuf, intptr_t rawLen, OodleLZ_FuzzSafe fuzzSafe,
  //   OodleLZ_CheckCRC checkCRC, OodleLZ_Verbosity verbosity,
  //   void *decBufBase, intptr_t decBufSize, void *fpCallback,
  //   void *callbackUserData, void *decoderMemory, intptr_t decoderMemorySize,
  //   OodleLZ_Decode_ThreadPhase threadPhase)
  const OodleLZ_Decompress = lib.func(
    'int64_t OodleLZ_Decompress(void* compBuf, int64_t compBufSize, void* rawBuf, int64_t rawLen,' +
      ' int fuzzSafe, int checkCRC, int verbosity, void* decBufBase, int64_t decBufSize,' +
      ' void* fpCallback, void* callbackUserData, void* decoderMemory, int64_t decoderMemorySize,' +
      ' int threadPhase)',
  )

  // intptr_t OodleLZ_Compress(OodleLZ_Compressor compressor, const void *rawBuf,
  //   intptr_t rawLen, void *compBuf, OodleLZ_CompressionLevel level,
  //   const OodleLZ_CompressOptions *pOptions, const void *dictionaryBase,
  //   const void *lrm, void *scratchMem, intptr_t scratchSize)
  const OodleLZ_Compress = lib.func(
    'int64_t OodleLZ_Compress(int compressor, void* rawBuf, int64_t rawLen, void* compBuf,' +
      ' int level, void* pOptions, void* dictionaryBase, void* lrm,' +
      ' void* scratchMem, int64_t scratchSize)',
  )

  // const OodleLZ_CompressOptions *OodleLZ_CompressOptions_GetDefault(
  //   OodleLZ_Compressor compressor, OodleLZ_CompressionLevel lzLevel)
  const OodleLZ_CompressOptions_GetDefault = lib.func(
    'void* OodleLZ_CompressOptions_GetDefault(int compressor, int level)',
  )

  /**
   * The level's default options, with every 256 KB seek chunk made independent
   * (seekChunkReset). Elden Ring unpacks a DCX one seek chunk at a time, and
   * every retail file is packed this way. By default each chunk refers back to
   * the ones before it: the game can't unpack those chunks, reads garbage past
   * the first 256 KB, and crashes at startup.
   *
   * OodleLZ_CompressOptions is 12 4-byte fields in Oodle 2.6: verbosity,
   * minMatchLen, seekChunkReset (+8), seekChunkLen (+12), … Later versions add
   * fields after those, where zero is their default. The defaults are copied
   * out with decode: Electron forbids koffi.view (memory outside V8's heap).
   */
  const OptionFields = koffi.array('int32_t', 12, 'Array')
  const seekableOptions = (compressor: number, level: number): Buffer => {
    const options = Buffer.alloc(256)
    const defaults = OodleLZ_CompressOptions_GetDefault(compressor, level)
    if (defaults) (koffi.decode(defaults, OptionFields) as number[]).forEach((v, i) => options.writeInt32LE(v, i * 4))
    options.writeInt32LE(1, 8)
    options.writeInt32LE(SEEK_CHUNK, 12)
    return options
  }

  cached = {
    dllPath,

    decompress(comp, uncompressedSize) {
      // Oodle can read slightly past the end of the output buffer, so pad it.
      const out = Buffer.allocUnsafe(uncompressedSize + 64)
      const written = Number(
        OodleLZ_Decompress(
          comp,
          comp.length,
          out,
          uncompressedSize,
          1 /* fuzzSafe: Yes */,
          0 /* checkCRC: No */,
          0 /* verbosity: None */,
          null,
          0,
          null,
          null,
          null,
          0,
          3 /* threadPhase: Unthreaded */,
        ),
      )
      if (written !== uncompressedSize) {
        throw new Error(`Oodle decompress returned ${written} bytes, expected ${uncompressedSize}`)
      }
      return Buffer.from(out.subarray(0, written))
    },

    compress(raw, compressor, level) {
      const id = COMPRESSOR_IDS[compressor]
      if (id === undefined) throw new Error(`Unknown Oodle compressor: ${compressor}`)
      // Worst-case expansion per Oodle docs: rawLen + 274 * ceil(rawLen / 0x40000)
      const bound = raw.length + 274 * Math.ceil(raw.length / 0x40000) + 64
      const out = Buffer.allocUnsafe(bound)
      const written = Number(
        OodleLZ_Compress(id, raw, raw.length, out, level, seekableOptions(id, level), null, null, null, 0),
      )
      if (written <= 0) throw new Error('Oodle compress failed')
      return Buffer.from(out.subarray(0, written))
    },
  }

  return cached
}

export function oodleAvailable(): boolean {
  try {
    load()
    return true
  } catch {
    return false
  }
}

export function oodleDllPath(): string | null {
  try {
    return load().dllPath
  } catch {
    return null
  }
}

export function oodleDecompress(comp: Buffer, uncompressedSize: number): Buffer {
  return load().decompress(comp, uncompressedSize)
}

export function oodleCompress(raw: Buffer, compressor: OodleCompressor = 'Kraken', level = 6): Buffer {
  return load().compress(raw, compressor, level)
}
