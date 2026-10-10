/** The Appearance dialog (theme, colours, text size) and Spellforge's mark. */
import { useState } from 'react'
import type { ThemeSettings } from '../../shared/api.ts'
import { COLOR_TOKENS, DEFAULT_THEME, PRESETS, applyTheme, presetById, resolvePalette } from './theme.ts'
import { ModalShell } from '../shared/Modal.tsx'

/**
 * Theme editor: pick a preset, override any colour, adjust text size and
 * density. Changes apply live; Save keeps them, Cancel restores the old theme.
 */
export function AppearanceDialog({
  theme,
  onSave,
  onClose,
}: {
  theme: ThemeSettings
  onSave: (t: ThemeSettings) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<ThemeSettings>(theme)
  const palette = resolvePalette(draft)

  const update = (t: ThemeSettings) => {
    setDraft(t)
    applyTheme(t)
  }
  const cancel = () => {
    applyTheme(theme)
    onClose()
  }

  return (
    <ModalShell onClose={cancel} style={{ width: 'min(880px, 94vw)' }}>
      <header>
        <h2 className="grow">Appearance</h2>
        <button className="ghost icon" onClick={cancel} aria-label="Close">
          ✕
        </button>
      </header>
      <div className="body">
        <div className="panel-title">Theme</div>
        <div className="preset-grid">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className={`preset${draft.preset === p.id ? ' active' : ''}`}
              onClick={() => update({ ...draft, preset: p.id, overrides: {} })}
            >
              <div className="preset-swatches">
                {['bg', 'panel', 'raised', 'accent', 'text', 'shared'].map((k) => (
                  <span key={k} style={{ background: p.palette[k] }} />
                ))}
              </div>
              <span>{p.name}</span>
            </button>
          ))}
        </div>

        <div className="row">
          <div className="panel-title grow">Colors</div>
          {Object.keys(draft.overrides).length > 0 && (
            <button className="ghost" onClick={() => update({ ...draft, overrides: {} })}>
              Reset to {presetById(draft.preset).name}
            </button>
          )}
        </div>
        <div className="color-grid">
          {COLOR_TOKENS.map((t) => (
            <label key={t.key} className="color-row">
              <input
                type="color"
                value={palette[t.key]}
                onChange={(e) => update({ ...draft, overrides: { ...draft.overrides, [t.key]: e.target.value } })}
              />
              <span className="labels">
                <span>
                  {t.label}
                  {draft.overrides[t.key] && <span className="faint"> (custom)</span>}
                </span>
                <span>{t.hint}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="panel-title">Text & spacing</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 18 }}>
          <label className="row">
            Text size
            <input
              type="range"
              min={11}
              max={17}
              value={draft.fontSize}
              onChange={(e) => update({ ...draft, fontSize: Number(e.target.value) })}
            />
            <span className="mono">{draft.fontSize}px</span>
          </label>
          <label className="row">
            Density
            <select
              value={draft.density}
              onChange={(e) => update({ ...draft, density: e.target.value as ThemeSettings['density'] })}
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
        </div>
      </div>
      <footer>
        <button className="ghost" onClick={() => update(DEFAULT_THEME)}>
          Restore defaults
        </button>
        <span className="grow" />
        <button onClick={cancel}>Cancel</button>
        <button
          className="primary"
          onClick={() => {
            onSave(draft)
            onClose()
          }}
        >
          Save
        </button>
      </footer>
    </ModalShell>
  )
}

/** Spellforge's mark: a rune-like flame. Drawn in the accent colour. */
export function BrandMark({ className = 'brand-mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M16 2c1.5 4.5 6 7.2 6 13a6 6 0 0 1-12 0c0-2.8 1.4-4.6 2.6-6.1.3 2 1.2 3.1 2.4 3.6C14.2 9.3 14.6 5.4 16 2Z"
        fill="currentColor"
        opacity="0.95"
      />
      <path d="M16 19.5 18.6 24 16 30 13.4 24Z" fill="currentColor" opacity="0.6" />
      <path d="M8 24h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
    </svg>
  )
}
