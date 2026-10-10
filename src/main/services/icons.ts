/**
 * The game's menu icons, by the ids params use: an item's iconId
 * (EquipParamWeapon, Goods, Protector, Accessory, Gem, ShopLineupParam), a
 * SpEffect's status icon, a grace's or map point's map icon. Kinds and
 * sheets as Smithbox's icon configurations (Assets/PARAM/ER/Icon
 * Configurations): every icon of a kind is a sprite named prefix + id on
 * one of its sheets in menu/hi/01_common (layouts in .sblytbnd, textures in
 * .tpf), the project's own copies first, so its custom icons show too.
 *
 * The texture file is 200 MB unpacked: it's read only when an icon isn't
 * cached yet, and let go after a while. Icons are kept as PNG in memory and
 * on disk (keyed by the file they came from, so a game update or a custom
 * icon file gets its own).
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { Project } from '../../core/project/project.ts'
import { readBnd4 } from '../../core/formats/bnd4.ts'
import { dcxDecompress } from '../../core/formats/dcx.ts'
import { readTpf, decodeRegion, downscale, encodePng } from '../../core/formats/textures.ts'
import { readSbLayout, type SubTexture } from '../../core/formats/menuLayout.ts'

export type IconKind = 'Item' | 'Status' | 'MapIcon' | 'CharacterCreator'

const LAYOUTS = 'menu/hi/01_common.sblytbnd.dcx'
const TEXTURES = 'menu/hi/01_common.tpf.dcx'

/** Sprite name prefix and the sheets each kind is on (Smithbox's Icon Configurations). */
const KINDS: Record<IconKind, { prefix: string; sheets: RegExp }> = {
  Item: { prefix: 'MENU_ItemIcon_', sheets: /^SB_Icon_/i },
  Status: { prefix: 'MENU_StatusIcon_', sheets: /^SB_Status_/i },
  MapIcon: { prefix: 'MENU_MAP_', sheets: /^SB_MapCursor/i },
  CharacterCreator: { prefix: 'MENU_ItemIcon_', sheets: /^SB_Chara_01$/i },
}

export const isIconKind = (k: string): k is IconKind => k in KINDS

/** How long the unpacked texture file is kept after its last use. */
const RELEASE_MS = 90_000

export class IconService {
  private project: Project
  private cacheDir: string | null
  private sprites: Map<string, SubTexture> | null = null
  private textures: { byName: Map<string, Buffer>; timer: NodeJS.Timeout | null } | null = null
  private pngs = new Map<string, string | null>()
  private source: string | null = null

  constructor(project: Project, cacheDir?: string) {
    this.project = project
    this.cacheDir = cacheDir ?? null
  }

  /** Every sprite of 01_common, by lower-case name. */
  private layout(): Map<string, SubTexture> {
    if (this.sprites) return this.sprites
    const out = new Map<string, SubTexture>()
    try {
      const bnd = readBnd4(dcxDecompress(this.project.read(LAYOUTS).data).data)
      for (const e of bnd.entries) {
        if (!/\.layout$/i.test(e.name)) continue
        const sheet = e.name
          .split(/[\\/]/)
          .pop()!
          .replace(/\.layout$/i, '')
        for (const s of readSbLayout(e.data.toString('utf8'), sheet)) out.set(s.name.toLowerCase(), s)
      }
    } catch {
      /* no menu layouts: no icons */
    }
    this.sprites = out
    return out
  }

  /** Which file the icons come from (the project's copy or the game's), for the disk cache. */
  private sourceKey(): string {
    if (this.source) return this.source
    let key = 'none'
    try {
      const where = this.project.resolve(TEXTURES)?.source
      if (where === 'project') {
        const st = fs.statSync(this.project.projectPath(TEXTURES))
        key = `project-${st.size}-${Math.round(st.mtimeMs)}-${crypto.createHash('sha1').update(this.project.config.modDir).digest('hex').slice(0, 8)}`
      } else if (where === 'game') key = `game-${this.project.game.fingerprint(TEXTURES) ?? 'unknown'}`
    } catch {
      /* no key: no disk cache */
    }
    this.source = key.replace(/[^\w.-]+/g, '_')
    return this.source
  }

  /** The sprite an icon id names, or null when the game has no such icon. */
  sprite(kind: IconKind, id: number): SubTexture | null {
    if (!Number.isInteger(id) || id < 0) return null
    const { prefix, sheets } = KINDS[kind]
    const sprites = this.layout()
    // Items pad to 5 digits (MENU_ItemIcon_00001), map icons to 2 (MENU_MAP_04, MENU_MAP_208).
    for (const width of [5, 4, 3, 2, 1]) {
      const s = sprites.get(`${prefix}${String(id).padStart(width, '0')}`.toLowerCase())
      if (s && sheets.test(s.sheet)) return s
    }
    // Named ones: MENU_MAP_01_Bonfire.
    const named = `${prefix}${String(id).padStart(2, '0')}_`.toLowerCase()
    for (const [name, s] of sprites) if (name.startsWith(named) && sheets.test(s.sheet)) return s
    return null
  }

  private texture(sheet: string): Buffer | null {
    if (!this.textures) {
      const byName = new Map<string, Buffer>()
      try {
        for (const t of readTpf(dcxDecompress(this.project.read(TEXTURES).data).data))
          byName.set(t.name.toLowerCase(), t.dds)
      } catch {
        /* unreadable: no icons */
      }
      this.textures = { byName, timer: null }
    }
    const t = this.textures
    if (t.timer) clearTimeout(t.timer)
    t.timer = setTimeout(() => {
      if (this.textures === t) this.textures = null
    }, RELEASE_MS)
    t.timer.unref?.()
    return t.byName.get(sheet.toLowerCase()) ?? null
  }

  /** An icon as a PNG data URL, at most `size` pixels across (default: as stored). */
  icon(kind: IconKind, id: number, size = 0): string | null {
    const key = `${kind}:${id}:${size}`
    if (this.pngs.has(key)) return this.pngs.get(key)!
    const sprite = this.sprite(kind, id)
    let url: string | null = null
    if (sprite) {
      const file = this.cacheDir ? path.join(this.cacheDir, this.sourceKey(), `${kind}-${id}-${size}.png`) : null
      if (file && fs.existsSync(file)) url = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64')
      else {
        const dds = this.texture(sprite.sheet)
        if (dds) {
          try {
            let img = decodeRegion(dds, sprite.x, sprite.y, sprite.width, sprite.height)
            if (size > 0 && Math.max(img.width, img.height) > size) img = downscale(img, size)
            const png = encodePng(img)
            url = 'data:image/png;base64,' + png.toString('base64')
            if (file) {
              try {
                fs.mkdirSync(path.dirname(file), { recursive: true })
                fs.writeFileSync(file, png)
              } catch {
                /* the disk cache is only a speed-up */
              }
            }
          } catch {
            url = null
          }
        }
      }
    }
    if (this.pngs.size > 4000) this.pngs.clear()
    this.pngs.set(key, url)
    return url
  }

  /** Drops what was read (the project was saved over, say). */
  reset(): void {
    if (this.textures?.timer) clearTimeout(this.textures.timer)
    this.textures = null
    this.sprites = null
    this.pngs.clear()
    this.source = null
  }
}
