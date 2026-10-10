/**
 * Maps every API channel to a Session call. Shared by the Electron IPC layer
 * and the browser dev harness so the two can't drift apart.
 */
import type { Session } from './session.ts'
import type { Api, Channel } from '../shared/api.ts'
import { findEldenRingInstalls } from '../core/project/gameFiles.ts'
import { errorMessage } from '../shared/errors.ts'

type Handlers = { [C in Channel]: (s: Session, req: Api[C][0]) => Api[C][1] | Promise<Api[C][1]> }

/**
 * The calls that change the project. Each one that succeeds is kept in the
 * project's journal of unsaved changes (services/recovery.ts) until it's
 * saved, so a crash or a close loses nothing: reopened, the same calls are
 * made again, in order (restoreChanges).
 */
const CHANGES = new Set<Channel>([
  'row:set',
  'row:add',
  'row:delete',
  'row:rename',
  'row:playerAttack',
  'text:setName',
  'text:set',
  'text:updateFromGame',
  'effect:import',
  'effect:bring',
  'effect:transform',
  'effect:copy',
  'effect:recolor',
  'effect:setResource',
  'effect:setBlendMode',
  'effect:setFields',
  'texture:import',
  'model:import',
  'clone:apply',
  'scale:apply',
  'moveset:apply',
  'anim:setEvent',
  'anim:addEvent',
  'anim:deleteEvent',
  'anim:duplicate',
  'anim:delete',
  'anim:register',
  'anim:undo',
  'anim:redo',
  'anim:setEvents',
  'anim:deleteEvents',
  'anim:pasteEvents',
  'anim:setProperties',
  'anim:setCategoryProperties',
  'anim:renumberCategory',
  'anim:importEvents',
  'anim:setNote',
  'anim:importNotes',
  'anim:createJudgeRow',
  'behaviour:set',
  'behaviour:delete',
  'skill:ashOfWar',
  'speffect:bothHands',
  'weapon:ownModel',
  'weapon:importModel',
  'events:setRecipe',
  'events:deleteRecipe',
  'events:setMarker',
  'events:itemLot',
  'behaviour:window',
  'enemy:makeSkill',
  'sound:bring',
  'enemy:makeSpell',
])
/** Calls after which the project's files hold everything: nothing left to keep. */
const SAVES = new Set<Channel>(['project:save', 'project:updateFromGame'])

/** Channels that need the host (Electron dialogs) are supplied by the caller. */
export type HostHandlers = Pick<
  Handlers,
  'dialog:pickFolder' | 'dialog:pickFile' | 'app:openTutorial' | 'app:walkthroughWindow'
>

const handlers: Omit<Handlers, keyof HostHandlers> = {
  'setup:status': (s) => s.status(),
  'setup:save': (s, patch) => s.saveSettings(patch),
  'setup:findGame': () => findEldenRingInstalls(),
  'setup:effectNames': (s, { file }) => s.loadEffectNames(file),
  'project:open': (s, { modDir }) => s.openProject(modDir),
  'project:dirty': (s) => s.dirty(),
  'project:save': (s) => s.save(),
  'project:updatePlan': (s) => s.gameUpdate.updatePlan(),
  'project:updateFromGame': (s, req) => s.gameUpdate.updateFromGame(req),
  'browse:list': (s, req) => s.params.browse(req),
  'tree:root': (s, { param, id }) => s.params.treeRoot(param, id),
  'tree:children': (s, { param, id }) => s.params.treeChildren(param, id),
  'row:get': (s, { param, id }) => s.params.rowView(param, id),
  'row:set': (s, { param, id, field, value }) => s.params.setRowField(param, id, field, value),
  'effect:get': (s, { id }) => s.effects.effectView(id),
  'effect:locate': (s, { id }) => s.effects.locateEffect(id),
  'effect:import': (s, { id }) => s.effects.importEffect(id),
  'effect:bring': (s, { id }) => s.effects.bringEffect(id),
  'effect:copy': (s, { id }) => s.effects.copyEffect(id),
  'effect:transform': (s, { id, rotation, offset }) => s.effects.transform(id, rotation, offset),
  'row:playerAttack': (s, { id }) => s.params.playerAttack(id),
  'effect:recolor': (s, req) => s.effects.recolor(req),
  'effect:setResource': (s, req) => s.effects.setResource(req),
  'texture:import': (s, req) => s.effects.importTexture(req),
  'model:import': (s, req) => s.effects.importModel(req),
  'effect:setBlendMode': (s, { effectId, actionIndex, value }) => s.effects.setBlendMode(effectId, actionIndex, value),
  'assets:list': (s, { resource, query }) => s.assets.assets(resource, query),
  'assets:thumb': (s, { resource, id, textureType, size, greyAsAlpha }) =>
    s.assets.thumbnail(resource, id, textureType, size, greyAsAlpha),
  'icon:get': (s, { kind, id, size }) => s.assets.icon(kind, id, size),
  'ids:flag': (s, { flag }) => s.ids.describeFlag(flag, true),
  'ids:lookup': (s, { id }) => s.ids.lookup(id),
  'effect:preview': (s, { id, scale, shift }) => s.effects.preview(id, scale, shift),
  'scale:plan': (s, { param, id }) => s.scaler.plan(param, id),
  'scale:apply': (s, req) => s.scaler.apply(req),
  'moveset:get': (s, { weapon }) => s.movesets.view(weapon),
  'moveset:apply': (s, req) => s.movesets.apply(req),
  'recovery:list': (s) => s.recoveryList(),
  'recovery:status': (s) => s.recoveryStatus(),
  'recovery:restore': (s) => restoreChanges(s),
  'recovery:discard': (s, { modDir }) => s.discardKept(modDir),
  'place:get': (s, { modDir }) => s.lastPlace(modDir),
  'place:set': (s, { modDir, place }) => s.keepPlace(modDir, place),
  'model:mesh': (s, { id }) => s.assets.modelMesh(id),
  'effect:parts': (s, { id }) => s.effects.effectParts(id),
  'model:textures': (s, { id }) => s.assets.modelTextures(id),
  'effect:setFields': (s, { effectId, edits }) => s.effects.setEffectFields(effectId, edits),
  'model:rig': (s, { model, anibnd, animation }) => s.assets.modelRig(model, anibnd, animation),
  'env:list': (s) => s.assets.environments(),
  'env:get': (s, { area, time, probe }) => s.assets.environment(area, time, probe),
  'params:list': (s) => s.params.paramList(),
  'params:rows': (s, req) => s.params.paramRows(req),
  'row:add': (s, req) => s.params.addRow(req.param, req.id, req.copyFrom, req.name),
  'row:delete': (s, { param, id }) => s.params.deleteRow(param, id),
  'row:rename': (s, { param, id, name }) => s.params.renameRow(param, id, name),
  'row:referrers': (s, { param, id }) => s.params.referrers(param, id),
  'text:setName': (s, { param, id, text }) => s.params.setGameName(param, id, text),
  'row:freeId': (s, { param, from }) => s.params.freeId(param, from),
  'shop:freeId': (s, { id }) => s.params.shopFreeId(id),
  'ids:near': (s, { param, id, radius, exclude }) => s.params.idNeighborhood(param, id, radius, exclude),
  'text:languages': (s) => s.text.textLanguages(),
  'text:files': (s, { lang }) => s.text.textFiles(lang),
  'text:entries': (s, { rel, file, query, limit, filter }) => s.text.textEntries(rel, file, query, limit, filter),
  'text:updateFromGame': (s, { rel, file }) => s.text.textUpdateFromGame(rel, file),
  'text:set': (s, { rel, file, id, text }) => s.text.setText(rel, file, id, text),
  'text:search': (s, { lang, query, limit }) => s.text.textSearch(lang, query, limit),
  'clone:plan': (s, req) => s.clone.plan(req),
  'clone:apply': (s, req) => s.clone.apply(req),
  'anim:categories': (s) => s.animations.categories(),
  'anim:list': (s, { category, query }) => s.animations.list(category, query),
  'anim:get': (s, { name }) => s.animations.view(name),
  'anim:eventTypes': (s) => s.animations.eventTypes(),
  'anim:setEvent': (s, req) => s.animations.setEvent(req),
  'anim:addEvent': (s, req) => s.animations.addEvent(req),
  'anim:deleteEvent': (s, { name, index }) => s.animations.deleteEvent(name, index),
  'anim:duplicate': (s, req) => s.animations.duplicate(req),
  'anim:delete': (s, { name }) => s.animations.deleteAnimation(name),
  'anim:register': (s, { names }) => s.animations.register(names),
  'anim:unregistered': (s) => s.animations.unregistered(),
  'anim:undo': (s) => s.animations.undo(),
  'anim:redo': (s) => s.animations.redo(),
  'anim:history': (s) => s.animations.history(),
  'anim:setEvents': (s, { name, edits }) => s.animations.setEvents(name, edits),
  'anim:deleteEvents': (s, { name, indices }) => s.animations.deleteEvents(name, indices),
  'anim:copyEvents': (s, { name, indices }) => s.animations.copyEvents(name, indices),
  'anim:pasteEvents': (s, { name, events, at }) => s.animations.pasteEvents(name, events, at),
  'anim:find': (s, q) => s.animations.find(q),
  'anim:properties': (s, { name }) => s.animations.properties(name),
  'anim:setProperties': (s, req) => s.animations.setProperties(req),
  'anim:categoryProperties': (s, { category }) => s.animations.categoryProperties(category),
  'anim:setCategoryProperties': (s, { category, taeId }) => s.animations.setCategoryProperties(category, taeId),
  'anim:renumberCategory': (s, { category, to, register, params }) =>
    s.params.renumberAnimationCategory(category, to, register, params),
  'anim:importEvents': (s, { name, from, mode, motion }) => s.animations.importEvents(name, from, mode, motion),
  'anim:sameIdIn': (s, { name, dir }) => s.animations.sameIdIn(name, dir),
  'anim:notes': (s) => s.animations.notes(),
  'anim:setNote': (s, { name, title, tags }) => s.animations.setNote(name, title, tags),
  'anim:importNotes': (s, { text, replace }) => s.animations.importNotes(text, replace),
  'anim:exportText': (s, req) => s.animations.exportText(req),
  'anim:judgeRowFor': (s, { judge, weapon }) => s.params.judgeRowFor(judge, weapon),
  'anim:judgeSources': (s, { judge, animation }) => s.params.judgeSources(judge, animation),
  'weapon:levels': (s, { id, stats }) => s.params.weaponLevels(id, stats),
  'item:whereToGet': (s, { param, id }) => s.requireOpen().ids.whereToGet(param, id),
  'skill:ashOfWar': (s, { id }) => s.params.makeAshOfWar(id),
  'speffect:bothHands': (s, { id }) => s.params.buffBothHands(id),
  'weapon:ownModel': (s, { id }) => s.params.weaponOwnModel(id),
  'weapon:importModel': (s, { id, files }) => s.params.importWeaponModel(id, files),
  'anim:createJudgeRow': (s, req) => s.params.createJudgeRow(req),
  'char:skeleton': (s, req) => s.character.skeleton(req?.chr),
  'char:clip': (s, { animation, chr, retarget }) => s.character.clip(animation, chr, retarget),
  'char:part': (s, { part, attach, model }) => s.character.part(part, attach, model),
  'char:placement': (s, { weapon }) => s.character.placement(weapon),
  'char:capsule': (s, req) => s.character.capsule(req?.chr),
  'sound:clip': (s, { chr, type, id }) => s.sounds.clip(chr, type, id),
  'sound:place': (s, { type, id }) => s.soundPlace(type, id),
  'sound:bring': (s, { type, id }) => s.sounds.bringSound(type, id),
  'char:body': (s, req) => s.character.body(req?.chr),
  'char:equipment': (s, { female }) => s.character.equipment(female),
  'char:buff': (s, { goods, spell, right, left }) => s.character.buff({ goods, spell }, right, left),
  'char:ownLooks': (s, { right, left }) => s.character.ownLooks(right, left),
  'char:actions': (s, { animation, right, left, chr, variation, spell }) =>
    s.character.actions(animation, right, left, chr, variation, spell),
  'spell:entire': (s, { spell, right }) => s.character.entireSpell(spell, right),
  'spell:forCategory': (s, { category }) => s.character.spellsForCategory(category),
  'enemy:list': (s) => s.enemies.list(),
  'enemy:get': (s, { chr, variation }) => s.enemies.view(chr, variation),
  'enemy:anim': (s, { chr, animation }) => s.enemies.anim(chr, animation),
  'enemy:copyEvents': (s, { chr, animation, indices }) => s.enemies.copyEvents(chr, animation, indices),
  'enemy:skillPlan': (s, req) => s.enemyMoves.plan(req),
  'enemy:makeSkill': (s, req) => s.enemyMoves.make(req),
  'enemy:makeSpell': (s, req) => s.enemyMoves.makeSpell(req),
  'anim:judgeRows': (s, { judge }) => s.animations.judgeRows(judge),
  'behaviour:status': (s) => s.behaviour.status(),
  'events:files': (s) => s.events.files(),
  'events:list': (s, { file }) => s.events.events(file),
  'events:get': (s, { file, id }) => s.events.event(file, id),
  'events:recipes': (s) => s.events.recipes(),
  'events:setRecipe': (s, { recipe }) => s.events.setRecipe(recipe),
  'events:deleteRecipe': (s, { id }) => s.events.deleteRecipe(id),
  'events:setMarker': (s, { file, event, on }) => s.events.setMarker(file, event, on),
  'events:newFlag': (s, { file }) => s.events.newFlag(file),
  'events:itemLot': (s, { category, item, count }) => s.eventItemLot(category, item, count),
  'behaviour:slots': (s) => s.behaviour.slots(),
  'behaviour:weapons': (s) => s.behaviourWeapons(),
  'behaviour:skills': (s) => s.behaviourSkills(),
  'behaviour:set': (s, { recipe }) => s.behaviour.setRecipe(recipe),
  'behaviour:delete': (s, { id }) => s.behaviour.deleteRecipe(id),
  'behaviour:preview': (s) => s.behaviour.preview(),
  'behaviour:compare': (s) => s.behaviour.compare(),
  'behaviour:functions': (s) => s.behaviour.functionNames(),
  'behaviour:function': (s, { name }) => s.behaviour.functionText(name),
  'behaviour:search': (s, { query }) => s.behaviour.search(query),
  'behaviour:check': (s, { code, id }) => s.behaviour.check(code, id),
  'behaviour:names': (s) => s.behaviour.names(),
  'behaviour:window': (s, req) => s.behaviourWindow(req),
  'game:status': (s) => s.gameLink.status(),
  'game:reload': (s, req) => s.gameLink.reload(req?.model ?? 'c0000'),
  'game:play': (s) => s.play(),
}

/** A handler table looked up by a channel name only known when it's called. */
function byName(table: Partial<Handlers>): Record<string, ((s: Session, req: unknown) => unknown) | undefined> {
  return table as Record<string, ((s: Session, req: unknown) => unknown) | undefined>
}

export async function dispatch(
  session: Session,
  host: HostHandlers,
  channel: string,
  req: unknown,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  try {
    const fn = channel in host ? byName(host)[channel] : byName(handlers)[channel]
    if (!fn) throw new Error(`Unknown channel ${channel}`)
    const value = await fn(session, req)
    if (CHANGES.has(channel as Channel)) session.recordChange(channel, req)
    else if (SAVES.has(channel as Channel)) session.changesSaved()
    return { ok: true, value }
  } catch (err) {
    console.error(`[${channel}]`, err)
    return { ok: false, error: errorMessage(err) }
  }
}

export const CHANNELS = [
  ...Object.keys(handlers),
  'dialog:pickFolder',
  'dialog:pickFile',
  'app:openTutorial',
  'app:walkthroughWindow',
] as Channel[]

/**
 * Makes the open project's kept changes again, in order, through the same
 * handlers: the same calls on the same files give the same values. A change
 * that can't be made again (its files changed meanwhile) is skipped and
 * reported; the rest go on. They stay kept (still unsaved) until saved.
 */
async function restoreChanges(
  session: Session,
): Promise<{ applied: number; failed: { channel: string; error: string }[] }> {
  let applied = 0
  const failed: { channel: string; error: string }[] = []
  for (const e of session.keptChanges()) {
    // A field set: the same change, without the view the UI wanted back then.
    const quick =
      e.channel === 'row:set'
        ? (s: Session, r: unknown) => {
            const { param, id, field, value } = r as Api['row:set'][0]
            s.params.setRowFieldOnly(param, id, field, value)
          }
        : undefined
    const fn = quick ?? (CHANGES.has(e.channel as Channel) ? byName(handlers)[e.channel] : undefined)
    if (!fn) {
      failed.push({ channel: e.channel, error: 'not a change Spellforge can make again' })
      continue
    }
    try {
      await fn(session, e.req)
      applied++
    } catch (err) {
      failed.push({ channel: e.channel, error: errorMessage(err) })
    }
  }
  return { applied, failed }
}
