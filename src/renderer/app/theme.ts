/**
 * Themes: every colour in the UI is a CSS variable, so a theme is just a set
 * of values for them. Presets can be customised per colour, and text size and
 * density are adjustable. The result is stored in settings.
 */
import type { ThemeSettings } from '../../shared/api.ts'
import { hexWithAlpha, mixHex } from '../lib/color.ts'

export interface ColorToken {
  key: string
  label: string
  hint: string
}

/** The colours a user can change, in the order the editor shows them. */
export const COLOR_TOKENS: ColorToken[] = [
  { key: 'accent', label: 'Accent', hint: 'buttons, highlights, selection' },
  { key: 'accentDim', label: 'Accent (muted)', hint: 'hover borders, focus rings' },
  { key: 'bg', label: 'Background', hint: 'behind everything, inputs' },
  { key: 'panel', label: 'Panels', hint: 'the three main columns' },
  { key: 'panel2', label: 'Sections', hint: 'section headers and previews inside panels' },
  { key: 'raised', label: 'Raised', hint: 'buttons, selected rows' },
  { key: 'line', label: 'Lines', hint: 'dividers and borders' },
  { key: 'text', label: 'Text', hint: 'main text' },
  { key: 'textDim', label: 'Text (secondary)', hint: 'labels' },
  { key: 'textFaint', label: 'Text (faint)', hint: 'ids, hints' },
  { key: 'added', label: 'New', hint: 'new rows and copies' },
  { key: 'changed', label: 'Edited', hint: 'edited rows, fields and slots' },
  { key: 'shared', label: 'Shared / links', hint: '“kept shared”, reference links, effect links' },
  { key: 'danger', label: 'Errors', hint: 'errors and missing files' },
]

export type Palette = Record<string, string>

export interface ThemePreset {
  id: string
  name: string
  dark: boolean
  palette: Palette
}

const base = {
  added: '#6fbf73',
  shared: '#7aa5d6',
  danger: '#e0695a',
}

export const PRESETS: ThemePreset[] = [
  {
    id: 'roundtable',
    name: 'Roundtable',
    dark: true,
    // The default: Roundtable Hold's stone and candlelight. Warm greys, parchment text, grace gold for what's
    // selected and the main action, amber for edits.
    palette: {
      added: '#8fbf78',
      shared: '#84a9cf',
      danger: '#e2614f',
      accent: '#dcb96a',
      accentDim: '#85703f',
      changed: '#e38b4c',
      bg: '#17181b',
      panel: '#1d1e22',
      panel2: '#212226',
      raised: '#292a2f',
      line: '#303238',
      text: '#e6e0d3',
      textDim: '#a8a194',
      textFaint: '#6f6a61',
    },
  },
  {
    id: 'glintstone',
    name: 'Glintstone',
    dark: true,
    // Deep blue-slate, a luminous glintstone cyan, warm amber for edits.
    palette: {
      added: '#6cc89c',
      shared: '#93a9ff',
      danger: '#f0716c',
      accent: '#5cc8db',
      accentDim: '#2d6b77',
      changed: '#e8b45f',
      bg: '#0b0f14',
      panel: '#11161d',
      panel2: '#161c25',
      raised: '#1d2530',
      line: '#232c38',
      text: '#e3e9ef',
      textDim: '#97a4b2',
      textFaint: '#5d6a79',
    },
  },
  {
    id: 'ember',
    name: 'Ember',
    dark: true,
    palette: {
      ...base,
      accent: '#d4a856',
      accentDim: '#8a6d37',
      changed: '#d4a856',
      bg: '#14120f',
      panel: '#1c1915',
      panel2: '#23201b',
      raised: '#2b2721',
      line: '#36312a',
      text: '#e9e2d4',
      textDim: '#a69d8c',
      textFaint: '#6f6759',
    },
  },
  {
    id: 'erdtree',
    name: 'Erdtree',
    dark: true,
    // Luminous gold on deep olive — distinct from Ember's gold on charcoal-brown.
    palette: {
      ...base,
      added: '#9bd36a',
      shared: '#8fc3e6',
      accent: '#f7d65a',
      accentDim: '#8e7b2a',
      changed: '#f2b84b',
      bg: '#0e110b',
      panel: '#151a10',
      panel2: '#1b2215',
      raised: '#242c1c',
      line: '#323c27',
      text: '#f3eed2',
      textDim: '#b7b48f',
      textFaint: '#7a7a5c',
    },
  },
  {
    id: 'frost',
    name: 'Frost',
    dark: true,
    palette: {
      ...base,
      accent: '#7cc6f0',
      accentDim: '#3f6f8c',
      changed: '#7cc6f0',
      shared: '#b39ddb',
      bg: '#0e1217',
      panel: '#141a21',
      panel2: '#1a222b',
      raised: '#222c37',
      line: '#2c3846',
      text: '#e2ecf4',
      textDim: '#9aaabb',
      textFaint: '#5f6e7e',
    },
  },
  {
    id: 'blood',
    name: 'Blood',
    dark: true,
    palette: {
      ...base,
      accent: '#d9434f',
      accentDim: '#7e2a31',
      changed: '#e07a5f',
      bg: '#130d0e',
      panel: '#1b1213',
      panel2: '#231718',
      raised: '#2d1d1f',
      line: '#3c2729',
      text: '#f0e1e1',
      textDim: '#b39a9b',
      textFaint: '#7a6263',
    },
  },
  {
    id: 'rot',
    name: 'Scarlet Rot',
    dark: true,
    palette: {
      ...base,
      accent: '#ff7a3d',
      accentDim: '#9a4a24',
      changed: '#ffb15c',
      shared: '#d36ac2',
      bg: '#140e0c',
      panel: '#1d1411',
      panel2: '#261a16',
      raised: '#30211c',
      line: '#422d26',
      text: '#f6e6dc',
      textDim: '#bba091',
      textFaint: '#7f685b',
    },
  },
  {
    id: 'night',
    name: 'Night',
    dark: true,
    palette: {
      ...base,
      accent: '#a98bff',
      accentDim: '#5d4b99',
      changed: '#d4a856',
      bg: '#0f0f12',
      panel: '#16161b',
      panel2: '#1c1c23',
      raised: '#24242d',
      line: '#30303b',
      text: '#e7e6ef',
      textDim: '#a2a0b3',
      textFaint: '#6b6979',
    },
  },
  {
    id: 'grace',
    name: 'Grace (light)',
    dark: false,
    palette: {
      added: '#2f8a3a',
      shared: '#2f6db3',
      danger: '#c0392b',
      accent: '#a8761c',
      accentDim: '#c9a35a',
      changed: '#a8761c',
      bg: '#f4efe4',
      panel: '#faf6ee',
      panel2: '#fffdf8',
      raised: '#ece4d4',
      line: '#ddd2bd',
      text: '#2a241b',
      textDim: '#5f5545',
      textFaint: '#968a74',
    },
  },
]

export const DEFAULT_THEME: ThemeSettings = {
  preset: 'roundtable',
  overrides: {},
  fontSize: 13,
  density: 'comfortable',
  v: 3,
}

export function presetById(id: string): ThemePreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]
}

export function resolvePalette(theme: ThemeSettings): Palette {
  return { ...presetById(theme.preset).palette, ...theme.overrides }
}

/** Writes a theme into the document's CSS variables. */
export function applyTheme(theme: ThemeSettings): void {
  const p = resolvePalette(theme)
  const dark = presetById(theme.preset).dark
  const root = document.documentElement
  const set = (k: string, v: string) => root.style.setProperty(k, v)
  set('--bg', p.bg)
  set('--panel', p.panel)
  set('--panel-2', p.panel2)
  set('--raised', p.raised)
  set('--line', p.line)
  set('--line-strong', mixHex(p.line, p.text, 0.12))
  set('--text', p.text)
  set('--text-dim', p.textDim)
  set('--text-faint', p.textFaint)
  set('--gold', p.accent)
  set('--gold-dim', p.accentDim)
  set('--accent-ink', dark ? mixHex(p.bg, '#000000', 0.2) : '#ffffff')
  set('--accent-soft', hexWithAlpha(p.accent, dark ? 0.12 : 0.14))
  set('--accent-glow', hexWithAlpha(p.accent, dark ? 0.35 : 0.3))
  set('--hover', mixHex(p.panel, p.text, dark ? 0.045 : 0.06))
  set('--field', mixHex(p.bg, p.panel, 0.5))
  set('--scrim', dark ? 'rgba(4, 6, 10, 0.62)' : 'rgba(40, 32, 20, 0.28)')
  set('--added', p.added)
  set('--changed', p.changed)
  set('--shared', p.shared)
  set('--danger', p.danger)
  set('--added-soft', hexWithAlpha(p.added, 0.15))
  set('--changed-soft', hexWithAlpha(p.changed, 0.15))
  set('--shared-soft', hexWithAlpha(p.shared, 0.15))
  set('--danger-soft', hexWithAlpha(p.danger, 0.1))
  set('--warn-text', mixHex(p.changed, p.text, dark ? 0.35 : 0.5))
  set('--checker', mixHex(p.bg, p.text, 0.08))
  set('--base-size', `${theme.fontSize}px`)
  set('--row-pad', theme.density === 'compact' ? '3px' : '5px')
  root.style.colorScheme = dark ? 'dark' : 'light'
}
