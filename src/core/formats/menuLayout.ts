/**
 * Menu sprite sheet layouts (menu/hi/01_common.sblytbnd.dcx): one .layout
 * per atlas texture of 01_common.tpf.dcx, in the TexturePacker XML format:
 *
 *   <TextureAtlas imagePath="SB_Icon_00.png">
 *     <SubTexture name="MENU_ItemIcon_00001.png" x="1476" y="1804" width="160" height="160" half="0"/>
 *
 * Item icons are MENU_ItemIcon_<id, 5 digits> (160×160) on the SB_Icon_*
 * sheets, status icons MENU_StatusIcon_<id> on SB_Status_*, map icons
 * MENU_MAP_<id> on SB_MapCursor*.
 */

export interface SubTexture {
  /** The atlas texture's name in the TPF (SB_Icon_00). */
  sheet: string
  /** The sprite's name without ".png" (MENU_ItemIcon_00001). */
  name: string
  x: number
  y: number
  width: number
  height: number
}

export function readSbLayout(xml: string, sheetName?: string): SubTexture[] {
  const sheet = sheetName ?? /imagePath="([^"]+)"/.exec(xml)?.[1]?.replace(/\.[a-z]+$/i, '') ?? ''
  const out: SubTexture[] = []
  for (const m of xml.matchAll(/<SubTexture\s([^>]*?)\/?>/g)) {
    const a = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]]))
    if (!a.name) continue
    out.push({
      sheet,
      name: a.name.replace(/\.png$/i, ''),
      x: Number(a.x),
      y: Number(a.y),
      width: Number(a.width),
      height: Number(a.height),
    })
  }
  return out
}
