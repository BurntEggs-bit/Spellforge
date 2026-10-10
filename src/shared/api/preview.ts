/** IPC contract: an effect as the preview plays it (built by core/effects/preview.ts): its emitters, their curves and forces. */

/** A value over a particle's life, sampled. */
export interface PreviewCurve {
  /** Samples evenly spaced over the particle's life, 0..1. */
  samples: number[][]
}

export interface PreviewEmitter {
  effectId: number
  nodeIndex: number
  label: string
  /** Node position relative to the effect root. */
  offset: number[]
  /**
   * Node rotation relative to the effect root (3x3, row-major), from the
   * Static/RandomNodeTransform rotations down the node tree. Shapes, local
   * directions and local sprite axes are in this frame.
   */
  rotation: number[]
  offsetVariance: number[]
  delay: number
  /** Seconds the node is active; <= 0 means until the effect ends. */
  nodeDuration: number
  emission:
    | { kind: 'once' }
    | { kind: 'periodic'; interval: number; perEmission: number; total: number; maxConcurrent: number }
    | { kind: 'distance'; threshold: number; total: number; maxConcurrent: number }
  /** Cylinders: `yAxis` false means the axis is Z (a ring in the XY plane). */
  shape: {
    kind: 'point' | 'disk' | 'rect' | 'sphere' | 'box' | 'cylinder'
    size: number[]
    emitInside?: boolean
    yAxis?: boolean
  }
  /**
   * FXR InitialDirection of the emitter shape: 0 depends on the shape (point,
   * disk, rect: +Z; sphere: outward; box: out of the face, or along a random
   * axis when emitting inside; cylinder: out from the axis), 1/4 up, 2/5
   * down, 3/6 +Z.
   */
  direction: number
  /** Cone half-angle in degrees around the emission direction. */
  spread: number
  /** Particle lifetime in seconds; <= 0 lives as long as the node. */
  lifetime: number
  /** Particles move with the node (ParticleAttributes.attachment), rather than staying where they were emitted. */
  attached: boolean
  speed: PreviewCurve
  gravity: PreviewCurve
  appearance: {
    kind: 'sprite' | 'point' | 'trail' | 'model' | 'line' | 'light' | 'gpu' | 'distortion' | 'radialBlur' | 'lensFlare'
    action: string
    texture?: { id: number; type: string }
    model?: number
    /** Animated models: the anibnd skeleton and the clip they play from emission. */
    modelAnimation?: { anibnd: number; animation: number; loop: boolean; speed: number }
    blendMode: number
    columns: number
    totalFrames: number
    /** Trail persistence in seconds. */
    trailDuration?: number
    /** Tracer ribbon: seconds between segments, texture width per segment (or per trail when uvAttached), UV scroll. */
    trail?: { interval: number; textureFraction: number; uvAttached: boolean; speedU: number }
    /**
     * Screen effects. `strength` holds [intensity, radius] for distortion and
     * [blurRadius, 1] for radial blur, over the particle's life.
     * Distortion modes: 0 stir, 1/3 normal map, 2 twist; shapes: 0 rectangle,
     * 1 hemiellipsoid, 2 ellipsoid.
     */
    screen?: {
      mode: number
      shape: number
      normalMap?: { id: number; type: string }
      normalScale: number[]
      normalSpeed: number[]
      stirSpeed: number
      iterations: number
      strength: PreviewCurve
    }
    /** Lens flares: up to four layers placed along the source-to-centre line. */
    flare?: {
      sourceSize: number
      /** Seconds for the flare to fade in or out when its source is hidden or shown. */
      fadeTime: number
      layers: {
        texture?: { id: number; type: string }
        /** Flares fade when the screen centre leaves a sphere of attenuationRadius / |offset| around the source (<= 0: never). */
        attenuationRadius: number
        size: number[]
        color: number[]
        count: number
        offset: number
        offsetVariation: number
        reflection: number
        scaleVariation: number[]
      }[]
    }
    /**
     * Flipbook frame over the particle's life (frameIndex + frameIndexOffset),
     * plus a random start offset [min, max] and whether to blend between frames.
     */
    frames?: PreviewCurve
    frameRandom?: [number, number]
    interpolateFrames?: boolean
    /**
     * Texture scrolling: per layer, the UV shift [u, v] (offset plus scrolled
     * distance) and UV scale [u, v] over the particle's life. layer2 is the mask.
     */
    uv?: {
      layer1?: { shift: PreviewCurve; scale: PreviewCurve }
      layer2?: { shift: PreviewCurve; scale: PreviewCurve }
    }
    /** Models: texture UV shift [u, v] over the particle's life. */
    modelUv?: PreviewCurve
    /** Models: random extra UV offset per particle, [[uMin, uMax], [vMin, vMax]]. */
    modelUvRandom?: [number, number][]
    /** Second texture layer (MultiTextureBillboardEx `layer2`), multiplied into the alpha. */
    mask?: { id: number; type: string }
    /** Texture alpha below this (0-1) is hidden, above it stretched (`alphaFadeThreshold`). */
    alphaFade: number
    /**
     * The same over the particle's life when it changes (a lightning arc
     * flashes in and dissolves away); `alphaFade` is then its start.
     */
    alphaFadeCurve?: PreviewCurve
    /**
     * FXR OrientationMode: 1/6 face the camera, 0/2/3 face -Z (across the
     * flight path), 5 faces +X, 4 stands upright and turns to the camera,
     * 7 stretches along the particle's direction and rolls to face the camera.
     */
    orientation: number
    /** Each particle's width/height is multiplied by a random number between this and 1. */
    scaleVariation: [number, number]
    /** Width and height share one random variation. */
    uniformScale: boolean
    /**
     * Models: initial rotation and spin per axis (X, Y, Z), each [min, max] in
     * degrees / degrees per second. `orientation` is then the RichModel mode:
     * 0/3 north, 1 camera plane, 2 particle direction, 4 global yaw.
     */
    rotation3?: [number, number][]
    spin3?: [number, number][]
    /** Models with a finite life: spin angle so far (degrees, per axis, before the multiplier) over life. */
    spinAngle3?: PreviewCurve
    /** Per-axis spin multiplier range, picked per particle. */
    spinMul3?: [number, number][]
    /** Seconds spinAngle3 covers (the lifetime, or 1 s for endless particles). */
    spinSpan?: number
    /** Initial roll in degrees, [min, max] (random per particle). */
    rotation: [number, number]
    /** Roll speed in degrees per second, [min, max]. */
    spin: [number, number]
    /** Lit by scene lighting (FXR `lighting` = Lit); otherwise emissive. */
    lit: boolean
    /** Extra bloom colour (rgb x strength), when the action enables it. */
    bloom: number[] | null
    /** Point/spot lights: reach in metres (the colour curve is the light colour). */
    light?: { radius: number; spot: boolean }
  }
  /** [width, height] over life, in game units. */
  size: PreviewCurve
  /** RGBA over life, already multiplied through all color properties. */
  color: PreviewCurve
  /**
   * [rgb, alpha] multipliers over the time the effect has been active, when
   * they change (rgbMultiplier and alphaMultiplier take ActiveTime): a fade
   * the whole node shares, like Margit's spear's 0 → 1 in its first 0.1 s.
   * Sampled over `span` seconds, then held (or repeated when `loop`).
   */
  activeColor?: PreviewCurve & { span: number; loop: boolean }
  /** Base node motion (NodeSpeed / NodeAcceleration along Z). */
  nodeSpeedZ: number
  /**
   * Node motion in effect space, including what it inherits from its parents:
   * starting velocity and acceleration (m/s, m/s^2) along the nodes' own Z,
   * plus accelerationY along the scene's up.
   */
  nodeMotion: { vel: number[]; acc: number[]; accY: number }
  /** NodeTranslation (effect space), sampled every TRANSLATION_STEP seconds of node time. */
  translation?: number[][]
  /**
   * The nearest spinning node (itself or a parent): its origin, axes (3x3) and
   * spin in degrees/s about its X, Y, Z. The pivot moves with the motion and
   * translation that node inherits, so only offsets below it orbit.
   */
  nodeSpin?: {
    pivot: number[]
    axes: number[]
    rates: number[]
    motion: { vel: number[]; acc: number[] }
    translation?: number[][]
  }
  /** RandomNodeTransform rotationVariance of the node itself, in degrees. */
  rotationVariance?: number[]
  /** Random turns: particles change direction by up to `angle` degrees every `interval` seconds. */
  turns?: { angle: number; interval: number }
  /** ParticleForceSpeed/Acceleration: how strongly the particles are pushed by force fields (WindForce). */
  forceResponse?: { speed: number; acceleration: number }
  /** NodeAttachToCamera (on this node or a parent): the node rides on the camera. */
  attachToCamera?: { followRotation: boolean }
  /**
   * GPU particle systems: per-particle velocity (base + random min..max per
   * axis, node axes), acceleration, size growth (m/s) and colour variation.
   */
  gpu?: {
    velocity: number[]
    velocityMin: number[]
    velocityMax: number[]
    acceleration: number[]
    growth: number[]
    colorMin: number[]
    colorMax: number[]
    /** Bounce off the ground; bounciness 0-1. */
    collision: boolean
    bounciness: number
  }
}

/** A WindForce volume: pushes particles that respond to forces. */
export interface PreviewForce {
  /** Position and push direction (the node's +Z) in effect space. */
  position: number[]
  direction: number[]
  strength: number
  /** ForceVolumeShape: 0 everywhere, 1 sphere, 2 box, 3 cylinder, 4 square prism. */
  shape: number
  /** Sphere radius / box size / cylinder [radius, height] / prism [apothem, height]. */
  size: number[]
}

export interface PreviewSpec {
  forces: PreviewForce[]
  effectId: number
  /** Seconds after which the preview loops. */
  loop: number
  emitters: PreviewEmitter[]
  notes: string[]
}
