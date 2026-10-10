/**
 * Reading @cccode/fxr's effects field by field.
 *
 * The preview, the field editor and the effect views read (and edits write)
 * fields across every action, property and modifier class by name, as the
 * library's action data names them. The library types each class on its own,
 * so code that walks all of them sees records of fields; these helpers keep
 * that in one place, typed `unknown` rather than `any`.
 *
 * Credit: @cccode/fxr (CCCode; Unlicense): the effect model and its action and
 * enum data.
 */
import { createRequire } from 'node:module'
import { ProxyNode, type FXR, type Node as FxrNode } from '@cccode/fxr'

/** An object read by field name. */
export type Fields = Record<string, unknown>

/** An action read by field name; `type` is its ActionType. */
export type ActionFields = Fields & { readonly type: number }

export function isFields(v: unknown): v is Fields {
  return typeof v === 'object' && v !== null
}

/** The class of a library object (an action's or a modifier's kind), or ''. */
export function kindOf(v: unknown): string {
  return isFields(v) ? (v.constructor?.name ?? '') : ''
}

/** A plain value as it is; a property's constant value. */
export function constantOf(v: unknown): unknown {
  return isFields(v) && 'value' in v ? v.value : v
}

/** A property's modifiers (random ranges, external values...); none for plain values. */
export function modifiersOf(v: unknown): Fields[] {
  return isFields(v) && Array.isArray(v.modifiers) ? v.modifiers.filter(isFields) : []
}

/** A property's keyframes; none for constant and plain values. */
export function keyframesOf(v: unknown): Fields[] {
  return isFields(v) && Array.isArray(v.keyframes) ? v.keyframes.filter(isFields) : []
}

/** The keyframes of one component of a property animated per component. */
export function componentKeyframes(component: unknown): Fields[] {
  const list = isFields(component) && Array.isArray(component.keyframes) ? component.keyframes : component
  return Array.isArray(list) ? list.filter(isFields) : []
}

/** A node's own actions, not its children's. */
export function actionsOf(node: FxrNode): ActionFields[] {
  return [...node.walkActions(false)] as unknown as ActionFields[]
}

/** Every action in the effect, in the order edits address them by. */
export function allActions(fxr: FXR): ActionFields[] {
  return [...fxr.root.walkActions()] as unknown as ActionFields[]
}

/** A node's child nodes; none for the kinds of node that have none. */
export function childNodes(node: FxrNode): FxrNode[] {
  return 'nodes' in node && Array.isArray(node.nodes) ? node.nodes : []
}

/** Nodes in pre-order with their depth: the order nodes are addressed by. */
export function flatNodes(fxr: FXR): { node: FxrNode; depth: number }[] {
  const out: { node: FxrNode; depth: number }[] = []
  const visit = (node: FxrNode, depth: number) => {
    out.push({ node, depth })
    for (const child of childNodes(node)) visit(child, depth + 1)
  }
  visit(fxr.root, 0)
  return out
}

/** The effect a proxy node stands in for; null for other nodes. */
export function proxyTarget(node: FxrNode): number | null {
  return node instanceof ProxyNode ? node.sfx : null
}

/** A field as the library's action data documents it. */
export interface ActionFieldSpec {
  desc?: Record<string, string>
  default?: unknown
  components?: number
  /** What the field's curve runs over: ParticleAge, ActiveTime, EmissionTime or Constant0. */
  argument?: string
  resource?: 'texture' | 'model'
  textureType?: string
  fieldType?: 'integer' | 'float' | 'boolean'
  enum?: string
  tsType?: string
}

/** An action type as the library's action data documents it. */
export interface ActionSpec {
  type: number
  name: string
  slot?: string
  meta?: { isAppearance?: boolean; isParticle?: boolean }
  desc?: Record<string, string>
  properties?: Record<string, ActionFieldSpec>
  /** Per game, the action's fields in the order the game stores them. */
  structure?: Record<string, Record<string, string[]>>
}

export interface EnumSpec {
  desc?: Record<string, string>
  members: Record<string, { value: number; desc?: Record<string, string> }>
}

const require = createRequire(import.meta.url)

/** The library's action data, by action type. */
export const ACTION_SPECS: Record<string, ActionSpec> = Object.fromEntries(
  (Object.values(require('@cccode/fxr/data/actions')) as ActionSpec[]).map((spec) => [String(spec.type), spec]),
)

/** The library's enum data, by enum name. */
export const ENUM_SPECS: Record<string, EnumSpec> = require('@cccode/fxr/data/enums')
