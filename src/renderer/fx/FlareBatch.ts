/** Lens flares, drawn for the effect preview (the viewer leaves them out). */
import * as THREE from 'three'
import type { PreviewEmitter } from '../../shared/api.ts'
import { FX_BLOOM_GAIN, GROUND_Y } from './constants.ts'
import { VERTEX, FRAGMENT, identityUv, applyBlend } from './shaders.ts'
import type { TextureRef } from './textures.ts'

/**
 * Lens flares: each layer is a set of sprites placed along the line from the
 * flare's source to the centre of the screen (Radial) or its mirror across the
 * vertical centre line (Horizontal), at the source's depth.
 */
export class FlareBatch {
  readonly group = new THREE.Group()
  private fadeTime: number
  private layers: {
    def: NonNullable<PreviewEmitter['appearance']['flare']>['layers'][number]
    mesh: THREE.Mesh
    geometry: THREE.InstancedBufferGeometry
    material: THREE.ShaderMaterial
    aPos: THREE.InstancedBufferAttribute
    aSize: THREE.InstancedBufferAttribute
    aColor: THREE.InstancedBufferAttribute
    picks: { f: number; sx: number; sy: number }[]
  }[] = []

  constructor(
    spec: PreviewEmitter,
    bloomPass: { value: number },
    loadTexture: (ref: TextureRef, apply: (t: THREE.Texture) => void) => void,
  ) {
    const MAX = 64
    this.fadeTime = spec.appearance.flare?.fadeTime ?? 0
    for (const def of spec.appearance.flare?.layers ?? []) {
      const plane = new THREE.PlaneGeometry(1, 1)
      const g = new THREE.InstancedBufferGeometry()
      g.index = plane.index
      g.setAttribute('position', plane.getAttribute('position'))
      g.setAttribute('uv', plane.getAttribute('uv'))
      const attr = (n: number) =>
        new THREE.InstancedBufferAttribute(new Float32Array(MAX * n), n).setUsage(THREE.DynamicDrawUsage)
      const aPos = attr(3)
      const aSize = attr(2)
      const aColor = attr(4)
      g.setAttribute('iPos', aPos)
      g.setAttribute('iSize', aSize)
      g.setAttribute('iColor', aColor)
      g.setAttribute('iFrame', attr(1))
      g.setAttribute('iRot', attr(1))
      g.setAttribute('iDir', attr(3))
      g.setAttribute('iUv', new THREE.InstancedBufferAttribute(identityUv(MAX), 4))
      g.setAttribute('iUv2', new THREE.InstancedBufferAttribute(identityUv(MAX, 0.5), 4))
      g.instanceCount = 0
      const material = new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          uMap: { value: null },
          uHasMap: { value: 0 },
          uMask: { value: null },
          uHasMask: { value: 0 },
          uAlphaFade: { value: 0 },
          uCols: { value: 1 },
          uRows: { value: 1 },
          uFrames: { value: 1 },
          uInterp: { value: 0 },
          uOrient: { value: 1 },
          uLocalX: { value: new THREE.Vector3(1, 0, 0) },
          uLocalY: { value: new THREE.Vector3(0, 1, 0) },
          uLocalZ: { value: new THREE.Vector3(0, 0, 1) },
          uLight: { value: new THREE.Vector3(1, 1, 1) },
          uBloom: { value: new THREE.Vector3(0, 0, 0) },
          uBloomPass: bloomPass,
          uBloomGain: { value: FX_BLOOM_GAIN },
          // Flare colours top out near 1 (an in-camera glint), so they skip the effect-colour scale.
          uExposure: { value: 1 },
        },
      })
      applyBlend(material, spec.appearance.blendMode)
      material.depthTest = false
      const mesh = new THREE.Mesh(g, material)
      mesh.frustumCulled = false
      this.group.add(mesh)
      if (def.texture)
        loadTexture(def.texture, (t) => {
          material.uniforms.uMap.value = t
          material.uniforms.uHasMap.value = 1
        })
      const picks = Array.from({ length: Math.min(MAX, def.count) }, () => ({
        f: def.offset * (def.offsetVariation + Math.random() * (1 - def.offsetVariation)),
        sx: def.scaleVariation[0] + Math.random() * (1 - def.scaleVariation[0]),
        sy: def.scaleVariation[1] + Math.random() * (1 - def.scaleVariation[1]),
      }))
      this.layers.push({ def, mesh, geometry: g, material, aPos, aSize, aColor, picks })
    }
  }

  private visibility = 0

  update(sources: { pos: THREE.Vector3; color: number[] }[], camera: THREE.PerspectiveCamera, dt: number): void {
    const ndc = new THREE.Vector3()
    const at = new THREE.Vector3()
    // The source is hidden when the ground is between it and the camera;
    // flares fade in and out over the effect's transition time.
    const shown = sources.some((src) => !(camera.position.y > GROUND_Y && src.pos.y < GROUND_Y))
    const step = this.fadeTime > 0 ? dt / this.fadeTime : 1
    this.visibility = Math.max(0, Math.min(1, this.visibility + (shown ? step : -step)))
    const focal = camera.projectionMatrix.elements[5]
    for (const L of this.layers) {
      let n = 0
      for (const src of sources) {
        ndc.copy(src.pos).project(camera)
        if (ndc.z > 1 || Math.abs(ndc.x) > 1.2 || Math.abs(ndc.y) > 1.2) continue // source off screen
        const dist = Math.max(1e-3, camera.position.distanceTo(src.pos))
        const fromCentre = Math.hypot(ndc.x * camera.aspect, ndc.y)
        const vx = L.def.reflection === 1 || L.def.reflection === 2 ? -2 * ndc.x : 0
        const vy = L.def.reflection === 1 ? -2 * ndc.y : 0
        for (const pick of L.picks) {
          if (n >= 64) break
          // Attenuation: fade as the screen centre leaves the sphere of
          // radius attenuationRadius / |offset| around the source.
          let fade = this.visibility
          if (L.def.attenuationRadius > 0 && pick.f !== 0) {
            const r = (L.def.attenuationRadius / Math.abs(pick.f) / dist) * focal
            fade *= 1 - THREE.MathUtils.smoothstep(fromCentre, 0.6 * r, r)
          }
          if (fade <= 0.001) continue
          at.set(ndc.x + vx * pick.f, ndc.y + vy * pick.f, ndc.z).unproject(camera)
          L.aPos.setXYZ(n, at.x, at.y, at.z)
          L.aSize.setXY(n, L.def.size[0] * pick.sx, L.def.size[1] * pick.sy)
          const c = L.def.color
          L.aColor.setXYZW(
            n,
            c[0] * src.color[0],
            c[1] * src.color[1],
            c[2] * src.color[2],
            (c[3] ?? 1) * (src.color[3] ?? 1) * fade,
          )
          n++
        }
      }
      L.geometry.instanceCount = n
      for (const a of [L.aPos, L.aSize, L.aColor]) a.needsUpdate = true
    }
  }

  dispose(): void {
    for (const L of this.layers) {
      L.geometry.dispose()
      L.material.dispose()
    }
  }
}
