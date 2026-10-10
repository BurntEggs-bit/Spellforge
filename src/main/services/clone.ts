/**
 * Cloning a row with everything it uses (a weapon with its behaviours, bullets, attacks and
 * effects): the plan of what's copied and what's shared, then the copy.
 */
import { nodeKey, parseNodeKey as parseKey } from '../../core/params/clone.ts'
import { planDuplicate, duplicate, childEffectIds, planEffectCopies } from '../../core/params/workflow.ts'
import type * as A from '../../shared/api.ts'
import type { Session } from '../session.ts'

export class CloneService {
  private readonly session: Session

  constructor(session: Session) {
    this.session = session
  }

  plan(req: A.ClonePlanRequest): A.ClonePlanView {
    const o = this.session.requireOpen()
    const plan = planDuplicate(o.db, req, this.session.newerGame())
    o.lastPlan = plan
    const effectIds = [...plan.sfxIds].sort((a, b) => a - b)
    // The effect ids the duplicate will give its copies: the same walk and
    // allocation as `duplicate`, without copying anything.
    const predicted: [number, number][] = []
    if (req.cloneEffects !== false) {
      for (const [id, to] of planEffectCopies(
        o.db,
        o.lib,
        plan,
        req.includeChildEffects !== false,
        req.effectIdStart ?? this.session.settings.effectIdStart,
      )) {
        predicted.push([id, to])
      }
    }
    return {
      effectIds: predicted,
      nodes: [...plan.nodes.values()].map((n) => ({
        key: n.key,
        param: n.param,
        id: n.id,
        name: n.name,
        status: n.status,
        sharedReason: n.sharedReason,
        newId: n.newId,
        effects: n.sfxIds.map((s) => s.sfxId),
      })),
      offsets: plan.offsets,
      behaviorVariations: [...plan.behaviorVariations],
      errors: plan.errors,
      effects: effectIds.map((id) => ({
        id,
        exists: o.lib.hasEffect(id),
        children: o.lib.hasEffect(id) ? childEffectIds(o.lib.getEffect(id)) : [],
      })),
    }
  }

  apply(req: A.DuplicateRequest): A.DuplicateResultView {
    const o = this.session.requireOpen()
    // Re-plan from the request so the result always matches what was asked.
    const plan = planDuplicate(o.db, req, this.session.newerGame())
    if (plan.errors.length) throw new Error(plan.errors.join('\n'))
    const result = duplicate(o.db, o.lib, plan, {
      cloneEffects: req.cloneEffects,
      includeChildEffects: req.includeChildEffects,
      effectIdStart: req.effectIdStart ?? this.session.settings.effectIdStart,
    })
    this.session.paramsEdited(o)
    for (const [key, newId] of result.mapping) {
      const { param } = parseKey(key)
      const name = o.db.rowName(param, newId)
      if (!name) continue
      ;(o.spellforgeNames[param] ??= {})[String(newId)] = name
      o.namesDirty = true
    }
    return {
      rowsAdded: result.rowsAdded,
      fieldsRelinked: result.fieldsRelinked,
      effectMapping: [...result.effectMapping],
      sfxFieldsRelinked: result.sfxFieldsRelinked,
      newRoots: req.roots.map((r) => ({ param: r.param, id: result.mapping.get(nodeKey(r.param, r.id)) ?? r.id })),
    }
  }
}
