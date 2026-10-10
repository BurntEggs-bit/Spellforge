/**
 * Reloading the player character in the running game (DS Anim Studio's
 * "Force In-game Entity Reload", F5), so saved animations, events and
 * behaviour show without restarting. Only for the game run offline with EAC
 * off (ModEngine 2 / me3), on Windows.
 *
 * How the game does it (verified on eldenring.exe 2.7.1.0 = 1.17.1; the
 * same requests DS Anim Studio and Smithbox make): WorldChrMan keeps a list
 * of character models to reload. Each frame, when the list isn't empty, the
 * game unloads every character of a listed model (the player's own c0000
 * included), loads it again from disk (ModEngine serves the mod's files),
 * then unlinks the request and frees it with its own allocator. So:
 *
 *   1. find WorldChrMan through its access pattern (the address is the
 *      instruction's RIP-relative operand), and the reload list's place
 *      through the allocator offset in the pattern of the code that frees
 *      requests (0x1E660 since 1.12: list head +8, size +0x10, timer +0x18);
 *   2. patch that free to free nothing (`mov rdx,rbx` -> `xor rdx,rdx`):
 *      the request lives in memory Spellforge allocated, which the game's
 *      allocator must not free (DS Anim Studio does the same; it stays
 *      patched until the game closes);
 *   3. write a request node (links, the model name "c0000" as UTF-16 with
 *      its capacity byte), link it after the list head, set the timer to
 *      10 s (how long the game waits for every character to unload), and
 *      set the size to 1 last, so the game never sees a half-made request;
 *   4. wait for the size to go back to 0 (done), then free the node.
 *
 * Nothing is run in the game process: only its memory is read and written,
 * with the user's permissions. me3 maps mod files at launch: files created
 * after the game started (a first save of a binder) need a restart.
 *
 * Credit: DS Anim Studio (Meowmaritus) and Smithbox (Vawser) reload characters
 * the same way; the requests follow theirs.
 */
import koffi from 'koffi'
import type * as A from '../../shared/api.ts'
import { errorMessage } from '../../shared/errors.ts'

/** WorldChrMan's global, read by `mov rax,[rip+x]` before the reload checks. */
const WORLD_CHR_MAN = '48 8B 05 ?? ?? ?? ?? 48 85 C0 74 0F 48 39 88 ?? ?? ?? ?? 75 06 89 B1'
/** The code that frees a reload request: its call through the allocator at [WorldChrMan + disp32 at byte 37]. */
const FREE_REQUEST =
  '80 65 ?? FD 48 C7 45 ?? 07 00 00 00 ?? 8D 45 48 4C 89 60 ?? 48 83 78 ?? 08 72 03 48 8B 00 66 44 89 20 49 8B 8F ?? ?? ?? ?? 48 8B 01 48 ?? ??'
/** Where in FREE_REQUEST the freed pointer is loaded (`mov rdx,rbx`), and what it's patched to (`xor rdx,rdx`). */
const PATCH_AT = 44
const PATCH_FROM = Buffer.from([0x48, 0x8b, 0xd3])
const PATCH_TO = Buffer.from([0x48, 0x31, 0xd2])

const PROCESS_ACCESS = 0x0008 | 0x0010 | 0x0020 | 0x0400 // VM_OPERATION | VM_READ | VM_WRITE | QUERY_INFORMATION
const TH32CS_SNAPPROCESS = 0x2
const TH32CS_SNAPMODULE = 0x8 | 0x10
const MEM_COMMIT_RESERVE = 0x3000
const MEM_RELEASE = 0x8000
const PAGE_READWRITE = 0x04
const PAGE_EXECUTE_READWRITE = 0x40

export type GameLinkStatus = A.GameLinkStatus

type Win = {
  CreateToolhelp32Snapshot: (flags: number, pid: number) => unknown
  Process32FirstW: (h: unknown, entry: Buffer) => number
  Process32NextW: (h: unknown, entry: Buffer) => number
  Module32FirstW: (h: unknown, entry: Buffer) => number
  OpenProcess: (access: number, inherit: number, pid: number) => unknown
  CloseHandle: (h: unknown) => number
  ReadProcessMemory: (h: unknown, addr: bigint, buf: Buffer, size: number, read: Buffer | null) => number
  WriteProcessMemory: (h: unknown, addr: bigint, buf: Buffer, size: number, written: Buffer | null) => number
  VirtualAllocEx: (h: unknown, addr: bigint, size: number, type: number, protect: number) => bigint
  VirtualFreeEx: (h: unknown, addr: bigint, size: number, type: number) => number
  VirtualProtectEx: (h: unknown, addr: bigint, size: number, protect: number, old: Buffer) => number
}

let win: Win | null = null
function api(): Win {
  if (win) return win
  if (process.platform !== 'win32') throw new Error('Reloading in game works on Windows only')
  const k = koffi.load('kernel32.dll')
  win = {
    CreateToolhelp32Snapshot: k.func('void* __stdcall CreateToolhelp32Snapshot(uint32_t flags, uint32_t pid)'),
    Process32FirstW: k.func('int __stdcall Process32FirstW(void* snap, void* entry)'),
    Process32NextW: k.func('int __stdcall Process32NextW(void* snap, void* entry)'),
    Module32FirstW: k.func('int __stdcall Module32FirstW(void* snap, void* entry)'),
    OpenProcess: k.func('void* __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)'),
    CloseHandle: k.func('int __stdcall CloseHandle(void* h)'),
    ReadProcessMemory: k.func(
      'int __stdcall ReadProcessMemory(void* h, uint64_t addr, void* buf, size_t size, void* read)',
    ),
    WriteProcessMemory: k.func(
      'int __stdcall WriteProcessMemory(void* h, uint64_t addr, void* buf, size_t size, void* written)',
    ),
    VirtualAllocEx: k.func(
      'uint64_t __stdcall VirtualAllocEx(void* h, uint64_t addr, size_t size, uint32_t type, uint32_t protect)',
    ),
    VirtualFreeEx: k.func('int __stdcall VirtualFreeEx(void* h, uint64_t addr, size_t size, uint32_t type)'),
    VirtualProtectEx: k.func(
      'int __stdcall VirtualProtectEx(void* h, uint64_t addr, size_t size, uint32_t protect, void* old)',
    ),
  } as unknown as Win
  return win
}

/** The running game's process id and exe path, or null. */
function findGame(): { pid: number; exe: string | null } | null {
  const w = api()
  const snap = w.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
  if (!snap) return null
  try {
    // PROCESSENTRY32W: dwSize at 0, th32ProcessID at 8, szExeFile (260 UTF-16) at 44; 568 bytes.
    const e = Buffer.alloc(568)
    e.writeUInt32LE(568, 0)
    for (let ok = w.Process32FirstW(snap, e); ok; ok = w.Process32NextW(snap, e)) {
      const name = utf16z(e, 44, 520)
      if (name.toLowerCase() === 'eldenring.exe')
        return { pid: e.readUInt32LE(8), exe: moduleOf(e.readUInt32LE(8))?.path ?? null }
    }
  } finally {
    w.CloseHandle(snap)
  }
  return null
}

/** The process's main module: its base address, size and path. */
function moduleOf(pid: number): { base: bigint; size: number; path: string } | null {
  const w = api()
  const snap = w.CreateToolhelp32Snapshot(TH32CS_SNAPMODULE, pid)
  if (!snap) return null
  try {
    // MODULEENTRY32W: dwSize 0, modBaseAddr 24, modBaseSize 32, szExePath (260 UTF-16) at 560; 1080 bytes.
    const e = Buffer.alloc(1080)
    e.writeUInt32LE(1080, 0)
    if (!w.Module32FirstW(snap, e)) return null
    return { base: e.readBigUInt64LE(24), size: e.readUInt32LE(32), path: utf16z(e, 560, 520) }
  } finally {
    w.CloseHandle(snap)
  }
}

function utf16z(b: Buffer, at: number, max: number): string {
  let e = at
  while (e + 1 < at + max && b.readUInt16LE(e) !== 0) e += 2
  return b.toString('utf16le', at, e)
}

/** "48 8B ?? …" as bytes and a mask of the bytes that must match. */
function pattern(text: string): { bytes: Buffer; mask: boolean[] } {
  const parts = text.trim().split(/\s+/)
  return {
    bytes: Buffer.from(parts.map((p) => (p === '??' ? 0 : parseInt(p, 16)))),
    mask: parts.map((p) => p !== '??'),
  }
}

/** Every offset in `buf` where the pattern matches. */
export function findPattern(buf: Buffer, text: string): number[] {
  const { bytes, mask } = pattern(text)
  const out: number[] = []
  const first = bytes[0]
  for (let i = buf.indexOf(first); i >= 0 && i + bytes.length <= buf.length; i = buf.indexOf(first, i + 1)) {
    let ok = true
    for (let k = 1; k < bytes.length; k++) {
      if (mask[k] && buf[i + k] !== bytes[k]) {
        ok = false
        break
      }
    }
    if (ok) out.push(i)
  }
  return out
}

/** A PE image's executable sections: their offsets in the image (RVA) and sizes, from its headers. */
export function executableSections(headers: Buffer): { rva: number; size: number; fileOffset: number }[] {
  const pe = headers.readUInt32LE(0x3c)
  if (headers.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('Not a PE image')
  const count = headers.readUInt16LE(pe + 6)
  const optSize = headers.readUInt16LE(pe + 20)
  const table = pe + 24 + optSize
  const out: { rva: number; size: number; fileOffset: number }[] = []
  for (let i = 0; i < count; i++) {
    const s = table + i * 40
    const virtualSize = headers.readUInt32LE(s + 8)
    const rva = headers.readUInt32LE(s + 12)
    const rawSize = headers.readUInt32LE(s + 16)
    const raw = headers.readUInt32LE(s + 20)
    const flags = headers.readUInt32LE(s + 36)
    if (flags & 0x20000000) out.push({ rva, size: Math.max(virtualSize, rawSize), fileOffset: raw })
  }
  return out
}

/**
 * What the reload needs from the game's code, found in an image's
 * executable bytes (`code` from RVA `rva`): WorldChrMan's global (RVA),
 * the reload list's offsets in WorldChrMan, and the patch site (RVA).
 */
export function locate(
  code: Buffer,
  rva: number,
): { worldChrMan: number; list: number; player: number; patch: number; patchBytes: Buffer } | string {
  const w = findPattern(code, WORLD_CHR_MAN)
  const f = findPattern(code, FREE_REQUEST)
  if (w.length !== 1)
    return w.length
      ? 'the game’s code matched more than once (an unknown game version)'
      : 'WorldChrMan wasn’t found (an unknown game version)'
  if (f.length !== 1)
    return f.length
      ? 'the reload code matched more than once (an unknown game version)'
      : 'the reload code wasn’t found (an unknown game version)'
  const at = w[0]
  const worldChrMan = rva + at + 7 + code.readInt32LE(at + 3)
  const player = code.readInt32LE(at + 15)
  const list = code.readInt32LE(f[0] + 37)
  if (list < 0x1000 || list > 0x100000)
    return `the reload list isn’t where it should be (offset 0x${list.toString(16)})`
  return {
    worldChrMan,
    list,
    player,
    patch: rva + f[0] + PATCH_AT,
    patchBytes: Buffer.from(code.subarray(f[0] + PATCH_AT, f[0] + PATCH_AT + 3)),
  }
}

class Proc {
  private w = api()
  readonly h: unknown
  constructor(pid: number) {
    this.h = this.w.OpenProcess(PROCESS_ACCESS, 0, pid)
    if (!this.h)
      throw new Error(
        'Spellforge couldn’t open the game’s process (run it offline, with EAC off; Spellforge may need the same rights as the game)',
      )
  }
  read(addr: bigint, size: number): Buffer {
    const b = Buffer.alloc(size)
    if (!this.w.ReadProcessMemory(this.h, addr, b, size, null))
      throw new Error(`couldn’t read the game’s memory at 0x${addr.toString(16)}`)
    return b
  }
  /** Reads what it can of a range, page by page where a whole read fails. */
  readLoose(addr: bigint, size: number): Buffer {
    const b = Buffer.alloc(size)
    if (this.w.ReadProcessMemory(this.h, addr, b, size, null)) return b
    for (let o = 0; o < size; o += 0x1000) {
      const n = Math.min(0x1000, size - o)
      const page = Buffer.alloc(n)
      if (this.w.ReadProcessMemory(this.h, addr + BigInt(o), page, n, null)) page.copy(b, o)
    }
    return b
  }
  write(addr: bigint, data: Buffer, code = false): void {
    let old: Buffer | null = null
    if (code) {
      old = Buffer.alloc(4)
      if (!this.w.VirtualProtectEx(this.h, addr, data.length, PAGE_EXECUTE_READWRITE, old))
        throw new Error('couldn’t make the game’s code writable')
    }
    const ok = this.w.WriteProcessMemory(this.h, addr, data, data.length, null)
    if (old) this.w.VirtualProtectEx(this.h, addr, data.length, old.readUInt32LE(0), Buffer.alloc(4))
    if (!ok) throw new Error(`couldn’t write the game’s memory at 0x${addr.toString(16)}`)
  }
  u64(addr: bigint): bigint {
    return this.read(addr, 8).readBigUInt64LE(0)
  }
  u32(addr: bigint): number {
    return this.read(addr, 4).readUInt32LE(0)
  }
  alloc(size: number): bigint {
    const a = this.w.VirtualAllocEx(this.h, 0n, size, MEM_COMMIT_RESERVE, PAGE_READWRITE)
    if (!a) throw new Error('couldn’t allocate memory in the game')
    return BigInt(a)
  }
  free(addr: bigint): void {
    this.w.VirtualFreeEx(this.h, addr, 0, MEM_RELEASE)
  }
  close(): void {
    this.w.CloseHandle(this.h)
  }
}

const u64b = (v: bigint) => {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE(v)
  return b
}

/** Where things are in one running game (found once per process). */
interface Found {
  pid: number
  base: bigint
  worldChrMan: bigint
  list: number
  player: number
  patch: bigint
  patchBytes: Buffer
}

export class GameLink {
  private found: Found | null = null

  /** Whether the game is running, and whether a character is loaded. */
  status(): GameLinkStatus {
    let game: { pid: number; exe: string | null } | null
    try {
      game = findGame()
    } catch (e) {
      return { running: false, problem: errorMessage(e) }
    }
    if (!game) return { running: false }
    const out: GameLinkStatus = { running: true, pid: game.pid, ...(game.exe ? { exe: game.exe } : {}) }
    let p: Proc | null = null
    try {
      p = new Proc(game.pid)
      const f = this.locateIn(p, game.pid)
      const w = p.u64(f.worldChrMan)
      out.inGame = w !== 0n && p.u64(w + BigInt(f.player)) !== 0n
      if (!out.inGame) out.problem = 'No character is loaded yet: load your save first'
    } catch (e) {
      out.problem = errorMessage(e)
    } finally {
      p?.close()
    }
    return out
  }

  private locateIn(p: Proc, pid: number): Found {
    if (this.found?.pid === pid) return this.found
    const mod = moduleOf(pid)
    if (!mod) throw new Error('Spellforge couldn’t read the game’s modules')
    const headers = p.readLoose(mod.base, 0x1000)
    for (const s of executableSections(headers)) {
      const code = p.readLoose(mod.base + BigInt(s.rva), s.size)
      const r = locate(code, s.rva)
      if (typeof r === 'string') {
        if (/wasn’t found/.test(r)) continue
        throw new Error(`Can’t reload in this game version: ${r}`)
      }
      this.found = {
        pid,
        base: mod.base,
        worldChrMan: mod.base + BigInt(r.worldChrMan),
        list: r.list,
        player: r.player,
        patch: mod.base + BigInt(r.patch),
        patchBytes: r.patchBytes,
      }
      return this.found
    }
    throw new Error('Can’t reload in this game version: the game’s reload code wasn’t found')
  }

  /**
   * Asks the running game to reload a character model (the player: c0000)
   * from disk, and waits until it has (up to `timeoutMs`).
   */
  async reload(model = 'c0000', timeoutMs = 15000): Promise<{ ms: number }> {
    if (!/^c\d{4}$/.test(model)) throw new Error('A character model is c and four digits, e.g. c0000')
    const game = findGame()
    if (!game) throw new Error('Elden Ring isn’t running')
    const p = new Proc(game.pid)
    let node: bigint
    try {
      const f = this.locateIn(p, game.pid)
      const w = p.u64(f.worldChrMan)
      if (w === 0n || p.u64(w + BigInt(f.player)) === 0n)
        throw new Error('No character is loaded yet: load your save first, then reload')
      const head = w + BigInt(f.list + 8)
      const size = w + BigInt(f.list + 0x10)
      const timer = w + BigInt(f.list + 0x18)
      if (p.u32(size) !== 0) throw new Error('The game is still reloading: try again in a moment')
      const sentinel = p.u64(head)
      if (sentinel === 0n) throw new Error('The game’s reload list isn’t ready')
      // The request is freed by the game's allocator unless that free is patched to free nothing.
      const now = p.read(f.patch, 3)
      if (now.equals(PATCH_FROM)) p.write(f.patch, PATCH_TO, true)
      else if (!now.equals(PATCH_TO))
        throw new Error('Can’t reload in this game version: the code to patch isn’t what it should be')
      // The request, laid out as the game's are (and as DS Anim Studio writes
      // it): links to the list head at 0 and 8; the model name's pointer at
      // 0x58 and its capacity byte at 0x70 (0x1F: the name is out of line);
      // the name itself, UTF-16, at 0x100.
      node = p.alloc(0x200)
      const n = Buffer.alloc(0x200)
      n.writeBigUInt64LE(sentinel, 0x00)
      n.writeBigUInt64LE(sentinel, 0x08)
      n.writeBigUInt64LE(node + 0x100n, 0x58)
      n.writeUInt8(0x1f, 0x70)
      n.write(model.toLowerCase() + '\0', 0x100, 'utf16le')
      p.write(node, n)
      p.write(sentinel, u64b(node))
      p.write(sentinel + 8n, u64b(node))
      const t = Buffer.alloc(4)
      t.writeFloatLE(10, 0)
      p.write(timer, t)
      // The size last: from here on the game works through the list.
      const one = Buffer.alloc(4)
      one.writeUInt32LE(1, 0)
      p.write(size, one)
      const t0 = Date.now()
      while (Date.now() - t0 < timeoutMs) {
        await new Promise((r) => setTimeout(r, 100))
        if (p.u32(size) === 0) {
          p.free(node)
          node = 0n
          return { ms: Date.now() - t0 }
        }
      }
      // Still queued: leave the request where it is (the game may still read it).
      node = 0n
      throw new Error('The game didn’t finish reloading within 15 seconds (it may still do so)')
    } finally {
      p.close()
    }
  }
}
