/** Textures drawn on a canvas: stand-ins until an effect's own load, and the preview's ground fade. */
import * as THREE from 'three'

/**
 * Stand-in for a 3D model until meshes are rendered: a soft shard, tinted by
 * the model's colour. Honest about position, motion and colour only.
 */
export function shardTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 32, 64, 32)
  grad.addColorStop(0, 'rgba(255,255,255,0.15)')
  grad.addColorStop(0.7, 'rgba(255,255,255,0.95)')
  grad.addColorStop(1, 'rgba(255,255,255,0.6)')
  g.fillStyle = grad
  g.beginPath()
  g.moveTo(2, 32)
  g.lineTo(44, 22)
  g.lineTo(62, 32)
  g.lineTo(44, 42)
  g.closePath()
  g.fill()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** A soft round dot, used when an emitter has no texture. */
export function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.4, 'rgba(255,255,255,0.5)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Alpha map for the ground: opaque in the middle, fading out at the rim. */
export function fadeTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgb(255,255,255)')
  grad.addColorStop(0.45, 'rgb(235,235,235)')
  grad.addColorStop(1, 'rgb(0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}
