/**
 * Effect textures: the game's textures as the main process renders them
 * (`assets:thumb`, a PNG data URL), loaded for three.js.
 */
import * as THREE from 'three'
import { call } from '../lib/ipc.ts'
import { clearOnProjectChange } from '../lib/projectCaches.ts'

/** One of an effect's textures: its id and type (the suffix of its file name). */
export type TextureRef = { id: number; type: string }

export interface TextureOptions {
  /** Greyscale textures become alpha; 'mask' also takes brightness as alpha for mask layers that have none. */
  greyAsAlpha?: boolean | 'mask'
  /** The longest side, in pixels. */
  size?: number
  /** Colour (sRGB), rather than data such as a normal map or a mask. */
  srgb?: boolean
}

/** A texture, loaded now; null when the game has none to show (or it can't be read). */
export function loadTexture(
  ref: TextureRef,
  { greyAsAlpha = false, size = 256, srgb = true }: TextureOptions = {},
): Promise<THREE.Texture | null> {
  return call('assets:thumb', { resource: 'texture', id: ref.id, textureType: ref.type, size, greyAsAlpha })
    .then((url) => (url ? new THREE.TextureLoader().loadAsync(url) : null))
    .then((t) => {
      if (t) t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
      return t
    })
    .catch(() => null)
}

const cache = new Map<string, Promise<THREE.Texture | null>>()
clearOnProjectChange(() => cache.clear())

/** A texture loaded once for the session: every effect playing in a viewer shares it. */
export function cachedTexture(ref: TextureRef, options: TextureOptions = {}): Promise<THREE.Texture | null> {
  const { greyAsAlpha = false, size = 256, srgb = true } = options
  const key = `${ref.id}_${ref.type}_${greyAsAlpha}_${size}_${srgb}`
  let p = cache.get(key)
  if (!p) {
    p = loadTexture(ref, options)
    cache.set(key, p)
  }
  return p
}

/**
 * A texture to hand a model right away: an sRGB texture whose image arrives
 * when `load` finishes, unless `live()` says by then it's no longer wanted.
 */
export function lateTexture(load: Promise<THREE.Texture | null>, live: () => boolean): THREE.Texture {
  const t = new THREE.Texture()
  t.colorSpace = THREE.SRGBColorSpace
  void load.then((loaded) => {
    if (!loaded || !live()) return
    t.image = loaded.image
    t.needsUpdate = true
  })
  return t
}
