/**
 * Weapon models (parts/wp_a_NNNN.partsbnd.dcx, and the low-detail copy the
 * game shows from afar, wp_a_NNNN_l): copied under a new id, and given a
 * model or textures of your own.
 *
 * A model's binder holds its textures (a TPF: WP_A_0500_a, _m, _n…) and its
 * model (a FLVER naming those textures). A copy renames every one of them:
 * the binder's entries, and the names inside the TPF and the FLVER, which
 * are the same length (WP_A_0500 → WP_A_8000), so they're replaced where
 * they are. With its own names the copy's textures can't be mistaken for
 * the original's when both are loaded.
 */
import { readBnd4, writeBnd4, type Bnd4 } from '../formats/bnd4.ts'
import { readTpf, writeTpf, tpfFormatFor } from '../formats/textures.ts'
import { readFlver } from '../formats/flver.ts'

/** A model's name inside its files: WP_A_0500. */
export function modelName(id: number): string {
  return `WP_A_${String(id).padStart(4, '0')}`
}

/** Every copy of a name in a file (UTF-16 and single-byte, upper and lower case) replaced by another of its length. */
function replaceName(data: Buffer, from: string, to: string): Buffer {
  const out = Buffer.from(data)
  for (const enc of ['utf16le', 'latin1'] as const)
    for (const [f, t] of [
      [from.toUpperCase(), to.toUpperCase()],
      [from.toLowerCase(), to.toLowerCase()],
    ]) {
      const needle = Buffer.from(f, enc)
      const repl = Buffer.from(t, enc)
      for (let at = out.indexOf(needle); at >= 0; at = out.indexOf(needle, at + needle.length)) repl.copy(out, at)
    }
  return out
}

/** A model binder (a partsbnd, decompressed) as the copy for another model id. */
export function renameModelBinder(binder: Buffer, fromId: number, toId: number): Buffer {
  const from = modelName(fromId)
  const to = modelName(toId)
  const bnd: Bnd4 = readBnd4(binder)
  bnd.entries = bnd.entries.map((e) => ({
    ...e,
    name: e.name.replace(new RegExp(from, 'gi'), (m) => (m === m.toLowerCase() ? to.toLowerCase() : to)),
    // A binder inside (a weapon's own animations) is rebuilt with its names; any other file is renamed in place.
    data: /\.(anibnd|bnd)$/i.test(e.name) ? renameModelBinder(e.data, fromId, toId) : replaceName(e.data, from, to),
  }))
  return writeBnd4(bnd)
}

/**
 * A model binder with a new model (a FLVER) and textures in it: a texture
 * named like one in its TPF replaces it, any other is added. Returns the
 * binder and the textures it changed.
 */
export function putModelFiles(
  binder: Buffer,
  flver: Buffer | null,
  textures: { name: string; dds: Buffer }[],
): { binder: Buffer; replaced: string[]; added: string[] } {
  const bnd: Bnd4 = readBnd4(binder)
  const replaced: string[] = []
  const added: string[] = []
  if (flver) {
    readFlver(flver) // a file the game can't read is refused here
    const entry = bnd.entries.find((e) => /\.flver$/i.test(e.name))
    if (!entry) throw new Error('This model’s binder has no .flver to replace')
    entry.data = flver
  }
  if (textures.length) {
    const entry = bnd.entries.find((e) => /\.tpf$/i.test(e.name))
    if (!entry) throw new Error('This model’s binder has no textures (TPF)')
    const tpf = readTpf(entry.data)
    for (const t of textures) {
      const format = tpfFormatFor(t.dds)
      const has = tpf.find((x) => x.name.toLowerCase() === t.name.toLowerCase())
      if (has) {
        has.dds = t.dds
        has.format = format
        replaced.push(has.name)
      } else {
        tpf.push({ name: t.name, format, dds: t.dds, type: 0, mipmaps: 0, flags: 0 })
        added.push(t.name)
      }
    }
    entry.data = writeTpf(
      tpf.map((x) => ({ name: x.name, format: x.format, dds: x.dds, type: x.type, flags: x.flags })),
    )
  }
  return { binder: writeBnd4(bnd), replaced, added }
}
