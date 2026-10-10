/**
 * The effect preview's panel: the effect live (PreviewScene) with its
 * controls: play, restart, fly forward, which way its axis points, and the
 * lighting (an area's probes, exposure, bloom, glow, backdrop, ground, figure).
 */
import { useEffect, useRef, useState } from 'react'
import type { EnvironmentAreaView, EnvironmentView, PreviewSpec } from '../../../shared/api.ts'
import { errorMessage } from '../../../shared/errors.ts'
import { MAX_LIGHTS } from '../../fx/constants.ts'
import { GlowSlider } from '../../fx/GlowSlider.tsx'
import { useLatest } from '../../lib/hooks.ts'
import { call } from '../../lib/ipc.ts'
import { loadAreas } from '../../lib/envlight.ts'
import { guessUpright } from './guessUpright.ts'
import { startPreviewScene, type PreviewControls, type PreviewOrbit, type PreviewScene } from './PreviewScene.ts'
import {
  DEFAULT_PREVIEW_LIGHTING,
  loadPreviewLighting,
  savePreviewLighting,
  type PreviewLighting,
} from './previewPrefs.ts'

/**
 * The effect, live. With `scale`, as scaling it would make it (Scale…), framed
 * as the unscaled effect is so it visibly grows or shrinks beside the figure
 * (`figure` shows it whatever the preference).
 */
export function EffectPreview({
  effectId,
  version,
  scale = 1,
  shift,
  figure: forceFigure = false,
  flight,
}: {
  effectId: number
  version: number
  scale?: number
  /** With `scale`: moved by this much too (scaled about a weapon's grip). */
  shift?: number[]
  figure?: boolean
  /** The moving bullet that carries it: it starts flying at that bullet's speed. */
  flight?: { bullet: number; name: string; speed: number; life: number }
}) {
  const host = useRef<HTMLDivElement>(null)
  /** The camera's orbit, kept while the same effect is shown again (edits, a new size). */
  const orbit = useRef<PreviewOrbit | null>(null)
  const liveScene = useRef<PreviewScene | null>(null)
  const [spec, setSpec] = useState<PreviewSpec | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(true)
  const [fly, setFly] = useState(false)
  const [flySpeed, setFlySpeed] = useState(8)
  /** Which way the effect's +Z points: guessed per effect, or chosen. */
  const [axisMode, setAxisMode] = useState<'auto' | 'projectile' | 'upright'>('auto')
  const [stats, setStats] = useState('')
  const [prefs, setPrefsState] = useState<PreviewLighting>(loadPreviewLighting)
  const [areas, setAreas] = useState<EnvironmentAreaView[]>([])
  const [env, setEnv] = useState<EnvironmentView | null>(null)
  const [envError, setEnvError] = useState<string | null>(null)
  const controls = useLatest<PreviewControls>({
    playing,
    fly,
    flySpeed,
    lighting: forceFigure ? { ...prefs, figure: true } : prefs,
  })
  const restart = useRef(0)

  const setPrefs = (patch: Partial<PreviewLighting>) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch }
      savePreviewLighting(next)
      return next
    })
  }

  useEffect(() => setAxisMode('auto'), [effectId])
  // A bullet's own effect flies at the bullet's speed, as in game: parts emitted per metre moved only appear then.
  useEffect(() => {
    setFly(!!flight)
    if (flight) setFlySpeed(Math.round(flight.speed))
  }, [effectId, flight?.bullet, flight?.speed])
  const guessedUpright = spec ? guessUpright(spec) : false
  const upright = axisMode === 'upright' || (axisMode === 'auto' && guessedUpright)

  useEffect(() => {
    setError(null)
    call('effect:preview', scale !== 1 ? { id: effectId, scale, shift } : { id: effectId })
      .then(setSpec)
      .catch((e) => setError(errorMessage(e)))
  }, [effectId, version, scale, shift?.join(',')])

  useEffect(() => {
    loadAreas()
      .then(setAreas)
      .catch((e) => setEnvError(errorMessage(e)))
  }, [])

  // Fall back to an area that exists in this game folder.
  const area =
    areas.find((a) => a.id === prefs.area) ?? areas.find((a) => a.id === DEFAULT_PREVIEW_LIGHTING.area) ?? areas[0]
  const time =
    area && area.times.length ? (area.times.some((t) => t.index === prefs.time) ? prefs.time : area.times[0].index) : 0

  useEffect(() => {
    if (!area) return
    let stale = false
    setEnvError(null)
    call('env:get', { area: area.id, time, probe: prefs.probe })
      .then((v) => {
        if (!stale) setEnv(v)
      })
      .catch((e) => {
        if (!stale) setEnvError(errorMessage(e))
      })
    return () => {
      stale = true
    }
  }, [area?.id, time, prefs.probe])

  useEffect(() => {
    if (!spec || !host.current) return
    const scene = startPreviewScene(host.current, spec, {
      effectId,
      scale,
      upright,
      controls,
      restart,
      orbit,
      onStats: setStats,
    })
    liveScene.current = scene
    return () => {
      liveScene.current = null
      scene.dispose()
    }
  }, [spec, upright])

  // Hand the probe to the renderer (also after it is rebuilt for a new effect).
  useEffect(() => {
    liveScene.current?.setEnvironment(env)
  }, [env, spec, upright])

  const lightCount = spec?.emitters.filter((e) => e.appearance.kind === 'light').length ?? 0

  return (
    <section className="section">
      <header>
        <h3>Preview</h3>
        <span className="faint ellipsis" title={stats}>
          {stats}
        </span>
        {spec && spec.notes.length > 0 && (
          <span className="faint" style={{ cursor: 'help' }} title={spec.notes.join('\n\n')}>
            ⓘ
          </span>
        )}
        <span className="grow" />
        <button className="ghost" onClick={() => setPlaying(!playing)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button className="ghost" onClick={() => (restart.current += 1)}>
          Restart
        </button>
      </header>
      <div ref={host} className="preview-canvas" title="Drag to orbit, wheel to zoom" />
      <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="row">
          <label
            className="row"
            title={
              flight
                ? `${flight.name} (Bullet ${flight.bullet}) carries it at ${flight.speed} m/s for ${flight.life} s: it starts flying that fast`
                : 'Move it like a projectile, to see its trails'
            }
          >
            <input type="checkbox" checked={fly} onChange={(e) => setFly(e.target.checked)} />
            Fly forward
          </label>
          <input
            type="range"
            min={1}
            max={Math.max(40, Math.ceil(flight?.speed ?? 0))}
            value={flySpeed}
            disabled={!fly}
            onChange={(e) => setFlySpeed(Number(e.target.value))}
            style={{ width: 120 }}
          />
          <span className="mono faint">{flySpeed} m/s</span>
          <label
            className="row"
            title="Which way the effect's own Z axis points. Projectiles fly along it; effects on items or the ground stand on it."
          >
            Axis
            <select value={axisMode} onChange={(e) => setAxisMode(e.target.value as 'auto' | 'projectile' | 'upright')}>
              <option value="auto">Auto ({guessedUpright ? 'upright' : 'projectile'})</option>
              <option value="projectile">Projectile (Z forward)</option>
              <option value="upright">Upright (Z up)</option>
            </select>
          </label>
        </div>
        <div className="row preview-lighting">
          <span className="faint">Lighting</span>
          <select
            value={area?.id ?? ''}
            onChange={(e) => setPrefs({ area: e.target.value, probe: 0 })}
            disabled={!areas.length}
            title="Area whose light probes light the preview"
          >
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {area && area.times.length > 0 && (
            <select value={time} onChange={(e) => setPrefs({ time: Number(e.target.value) })} title="Time of day">
              {area.times.map((t) => (
                <option key={t.index} value={t.index}>
                  {t.label}
                </option>
              ))}
            </select>
          )}
          {env && env.probes > 1 && (
            <span className="row" title={`Light probe ${env.probeName}. Areas have one probe per spot.`}>
              <button className="ghost" disabled={env.probe <= 0} onClick={() => setPrefs({ probe: env.probe - 1 })}>
                ‹
              </button>
              <span className="mono faint">
                spot {env.probe + 1}/{env.probes}
              </span>
              <button
                className="ghost"
                disabled={env.probe >= env.probes - 1}
                onClick={() => setPrefs({ probe: env.probe + 1 })}
              >
                ›
              </button>
            </span>
          )}
        </div>
        <div className="row preview-lighting">
          <label className="row" title="Exposure on top of the automatic eye adaptation">
            Exposure
            <input
              type="range"
              min={-3}
              max={3}
              step={0.25}
              value={prefs.ev}
              onChange={(e) => setPrefs({ ev: Number(e.target.value) })}
              style={{ width: 90 }}
            />
            <span className="mono faint">
              {prefs.ev > 0 ? '+' : ''}
              {prefs.ev}
            </span>
          </label>
          <label className="row" title="Glow around bright colours (0 = off)">
            Bloom
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={prefs.bloom}
              onChange={(e) => setPrefs({ bloom: Number(e.target.value) })}
              style={{ width: 70 }}
            />
          </label>
          <GlowSlider />
          <label className="row" title="Turn the area around the effect">
            Turn
            <input
              type="range"
              min={0}
              max={360}
              step={5}
              value={prefs.turn}
              onChange={(e) => setPrefs({ turn: Number(e.target.value) })}
              style={{ width: 70 }}
            />
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={prefs.backdrop}
              onChange={(e) => setPrefs({ backdrop: e.target.checked })}
            />
            Backdrop
          </label>
          <label className="row">
            <input type="checkbox" checked={prefs.ground} onChange={(e) => setPrefs({ ground: e.target.checked })} />
            Ground
          </label>
          <label className="row" title="A 1.75 m figure behind the effect, for scale">
            <input
              type="checkbox"
              checked={prefs.figure || forceFigure}
              disabled={forceFigure}
              onChange={(e) => setPrefs({ figure: e.target.checked })}
            />
            Figure
          </label>
        </div>
        {lightCount > MAX_LIGHTS && (
          <div className="faint" style={{ fontSize: 11 }}>
            This effect has {lightCount} lights; the preview shows the first {MAX_LIGHTS}.
          </div>
        )}
        {(error || envError) && <div className="error">{error ?? envError}</div>}
      </div>
    </section>
  )
}
