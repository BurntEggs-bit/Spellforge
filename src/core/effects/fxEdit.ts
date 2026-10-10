/**
 * Field-level effect editing: every action of every node, its Elden Ring
 * fields with their documentation (from @cccode/fxr's action and enum data),
 * current values (constant, random or animated), and edits that set or scale
 * them. Scaling keeps animated curves and random ranges in shape, so "twice
 * as big" works on a size that grows over the particle's life.
 *
 * Credit: @cccode/fxr (CCCode; Unlicense): the effect model and the action and
 * field documentation shown in the editor.
 */
import { PropertyFunction, type FXR } from '@cccode/fxr'
import type { FxFieldView, FxPartView, FxFieldEdit } from '../../shared/api/effects.ts'
import {
  ACTION_SPECS,
  ENUM_SPECS,
  actionsOf,
  allActions,
  componentKeyframes,
  flatNodes,
  isFields,
  kindOf,
  modifiersOf,
} from './fxrFields.ts'

/** Markdown from the docs to plain text: links become their label. */
function plain(md: string | undefined): string {
  return (md ?? '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*?([^*]+)\*\*?/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim()
}

const ARGUMENT_WORDS: Record<string, string> = {
  ParticleAge: "the particle's life",
  ActiveTime: "the node's active time",
  EmissionTime: 'when the particle was emitted',
  Constant0: 'never',
}

function numbers(v: unknown): number[] {
  if (typeof v === 'number') return [v]
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'number')
  return []
}

function describeModifiers(v: unknown): string[] {
  const out: string[] = []
  for (const m of modifiersOf(v)) {
    const kind = kindOf(m)
    const fmt = (x: unknown) =>
      numbers(x)
        .map((n) => +n.toFixed(3))
        .join(', ')
    if (/RandomRange/.test(kind)) out.push(`random ${fmt(m.min)} to ${fmt(m.max)} added`)
    else if (/RandomDelta/.test(kind)) out.push(`random ±${fmt(m.max)}`)
    else if (/RandomFraction/.test(kind))
      out.push(
        `random ±${numbers(m.max)
          .map((n) => Math.round(n * 100))
          .join(', ')}%`,
      )
    else if (/ExternalValue/.test(kind))
      out.push(`scaled by external value ${m.externalValue} (e.g. fades out when the effect ends)`)
    else if (kind) out.push(kind.replace(/Modifier$/, ''))
  }
  return out
}

function describeValue(v: unknown): Pick<FxFieldView, 'value' | 'animated'> {
  if (typeof v === 'number' || typeof v === 'boolean') return { value: v, animated: null }
  if (Array.isArray(v)) return { value: v.slice(), animated: null }
  if (isFields(v)) {
    if (Array.isArray(v.keyframes)) {
      const keyframes = v.keyframes.filter(isFields)
      const all = keyframes.flatMap((k) => numbers(k.value))
      const first = keyframes[0]?.value
      return {
        value: Array.isArray(first) ? first.slice() : typeof first === 'number' ? first : null,
        animated: {
          function:
            typeof v.function === 'number' ? (PropertyFunction[v.function] ?? 'curve') : String(v.function ?? 'curve'),
          keys: v.keyframes.length,
          over: '',
          min: Math.min(...all),
          max: Math.max(...all),
        },
      }
    }
    if (Array.isArray(v.components)) {
      const components = v.components.map(componentKeyframes)
      const all = components.flatMap((keys) => keys.flatMap((k) => numbers(k.value)))
      return {
        value: components.map((keys) => (keys[0]?.value ?? 0) as number),
        animated: {
          function: 'ComponentHermite',
          keys: Math.max(...components.map((keys) => keys.length)),
          over: '',
          min: Math.min(...all),
          max: Math.max(...all),
        },
      }
    }
    if ('value' in v) return describeValue(v.value)
  }
  return { value: null, animated: null }
}

/** Every node's actions and their Elden Ring fields, documented. */
export function describeParts(fxr: FXR): FxPartView[] {
  const all = allActions(fxr)
  return flatNodes(fxr).map(({ node, depth }, index) => ({
    index,
    depth,
    actions: actionsOf(node)
      .filter((action) => ACTION_SPECS[String(action.type)])
      .map((action) => {
        const spec = ACTION_SPECS[String(action.type)]
        const names = spec?.structure?.EldenRing
          ? Object.values(spec.structure.EldenRing).flat()
          : Object.keys(spec?.properties ?? {})
        const fields: FxFieldView[] = []
        for (const name of names) {
          const p = spec?.properties?.[name]
          if (!p || !(name in action)) continue
          const raw = action[name]
          const { value, animated } = describeValue(raw)
          if (value === null && !animated) continue
          const e = p.enum ? ENUM_SPECS[p.enum] : undefined
          const kind: FxFieldView['kind'] = p.resource
            ? 'resource'
            : p.fieldType === 'boolean' || typeof value === 'boolean'
              ? 'bool'
              : e
                ? 'enum'
                : p.fieldType === 'integer'
                  ? 'int'
                  : (p.components ?? 1) > 1 || Array.isArray(value)
                    ? 'vector'
                    : 'scalar'
          fields.push({
            name,
            desc: plain(p.desc?.['en-US']),
            kind,
            components: p.components ?? (Array.isArray(value) ? value.length : 1),
            enumOptions: e
              ? Object.entries(e.members).map(([label, m]) => ({
                  value: m.value,
                  label,
                  desc: plain(m.desc?.['en-US']),
                }))
              : undefined,
            resource: p.resource,
            textureType: p.textureType,
            value,
            animated: animated ? { ...animated, over: ARGUMENT_WORDS[p.argument ?? ''] ?? p.argument ?? '' } : null,
            modifiers: describeModifiers(raw),
            unknown: /^unk/i.test(name),
          })
        }
        return {
          actionIndex: all.indexOf(action),
          type: action.type,
          name: spec?.name ?? `Action ${action.type}`,
          slot: spec?.slot ?? '',
          desc: plain(spec?.desc?.['en-US']),
          fields,
        }
      }),
  }))
}

function scaleTensor(v: unknown, k: number): unknown {
  if (typeof v === 'number') return v * k
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'number' ? x * k : x))
  return v
}

/** Multiplies a value, its curve (values and tangents) and its random ranges. */
function scaleValue(v: unknown, k: number): unknown {
  if (typeof v === 'number' || Array.isArray(v)) return scaleTensor(v, k)
  if (!isFields(v)) return v
  const keyframes = (list: unknown[]) => {
    for (const kf of list.filter(isFields)) {
      kf.value = scaleTensor(kf.value, k)
      for (const t of ['p1', 'p2', 'unkTangent1', 'unkTangent2', 't1', 't2']) if (t in kf) kf[t] = scaleTensor(kf[t], k)
    }
  }
  if (Array.isArray(v.keyframes)) keyframes(v.keyframes)
  else if (Array.isArray(v.components)) for (const c of v.components) keyframes(componentKeyframes(c))
  else if ('value' in v) v.value = scaleTensor(v.value, k)
  for (const m of modifiersOf(v)) {
    const kind = kindOf(m)
    if (/RandomRange/.test(kind)) {
      m.min = scaleTensor(m.min, k)
      m.max = scaleTensor(m.max, k)
    } else if (/RandomDelta/.test(kind)) m.max = scaleTensor(m.max, k)
  }
  return v
}

/** Applies edits in place. Throws on an unknown action or a field the action doesn't have. */
export function applyFieldEdits(fxr: FXR, edits: FxFieldEdit[]): void {
  const all = allActions(fxr)
  for (const e of edits) {
    const action = all[e.actionIndex]
    if (!action) throw new Error(`Action ${e.actionIndex} not found`)
    const spec = ACTION_SPECS[String(action.type)]
    if (!spec?.properties?.[e.field] || !(e.field in action))
      throw new Error(`${spec?.name ?? 'This action'} has no field ${e.field}`)
    const cur = action[e.field]
    if (e.scale !== undefined) {
      if (!Number.isFinite(e.scale)) throw new Error('Scale must be a number')
      action[e.field] = scaleValue(cur, e.scale)
    } else if (e.value !== undefined) {
      // Plain values keep their random/external modifiers; curves become constant.
      if (isFields(cur) && !Array.isArray(cur) && 'value' in cur && !('keyframes' in cur) && !('components' in cur))
        cur.value = e.value
      else action[e.field] = e.value
    }
  }
}
