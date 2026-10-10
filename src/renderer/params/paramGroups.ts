/**
 * The All params list, grouped: the params modders use most first (with a
 * one-line description), then the rest by what they're about. Group rules
 * match param names; anything unmatched lands in "Other".
 */

/** Most-used params, in the order shown, with what they hold. */
const MOST_USED: [string, string][] = [
  ['EquipParamWeapon', 'Weapons: stats, scaling, moveset, skill, model'],
  ['SwordArtsParam', 'Skills (Ashes of War): FP cost, animation category'],
  ['Magic', 'Sorceries and incantations: FP, stamina, requirements, slots'],
  ['BehaviorParam_PC', 'Player behaviors: what an animation fires (attack, bullet, SpEffect)'],
  ['Bullet', 'Projectiles: speed, homing, effects, what they spawn'],
  ['AtkParam_Pc', 'Player attacks: damage, poise, hit shapes'],
  ['SpEffectParam', 'Special effects: buffs, debuffs, status buildup, passives'],
  ['SpEffectVfxParam', 'Visuals shown while a SpEffect is active'],
  ['EquipParamGoods', 'Items: consumables, key items, spell tools'],
  ['EquipParamProtector', 'Armor'],
  ['EquipParamAccessory', 'Talismans'],
  ['EquipParamGem', 'Ashes of War as items (which weapons accept them)'],
  ['ReinforceParamWeapon', 'Weapon upgrade tables'],
  ['AttackElementCorrectParam', 'Which stats scale which damage types'],
  ['CalcCorrectGraph', 'Scaling curves'],
  ['NpcParam', 'Enemies and NPCs: health, defenses, drops'],
  ['BehaviorParam', 'Enemy/NPC behaviors'],
  ['AtkParam_Npc', 'Enemy/NPC attacks'],
  ['ItemLotParam_enemy', 'What enemies drop'],
  ['ItemLotParam_map', 'Items found in the world'],
  ['ShopLineupParam', 'Shop inventories'],
  ['CharaInitParam', 'Starting classes and NPC loadouts'],
]

const GROUPS: [string, RegExp][] = [
  [
    'Combat',
    /^(Atk|Behavior|Bullet|SpEffect|Magic|SwordArts|Throw|KnockBack|Hit|FinalDamage|Toughness|ResistCorrect|AttackElement|CalcCorrect|CoolTime|PostureControl|WepAbsorp)/,
  ],
  [
    'Equipment & items',
    /^(Equip|Reinforce|Shop|ItemLot|Ceremony|Gesture|EnvObjLot|RollingObjLot|HPEstus|MPEstus|MultiHPEstus|MultiMPEstus)/,
  ],
  [
    'Characters & AI',
    /^(Npc|Chara|Chr|Face|Buddy|Ride|Phantom|Role|EnemyCommon|PlayerCommon|Move|Talk|AiSound|RandomAppear)/,
  ],
  [
    'World & maps',
    /^(Map|WorldMap|Bonfire|Weather|Waypoint|PlayRegion|GameArea|Env|AutoCreateEnv|Asset|Grass|Speedtree|LegacyDistant|Mimicry|SignPuddle|ObjAct|WetAspect)/,
  ],
  [
    'Graphics & sound',
    /^(Gparam|Graphics|Decal|Material|Sfx|FootSfx|Fe|LoadBalancer|PartsDraw|RuntimeBone|Sound|Se|Wwise|Cutscene|CutScene|LockCam|DirectionCamera)/,
  ],
  ['Menus & text', /^(Menu|KeyAssign|Knowledge|Tutorial|CharMake|BaseChrSelect|ActionButton|NetworkMsg)/],
  ['Online', /^(Network|MultiPlay|MultiSoul|WhiteSign|ClearCount)/],
]

export interface ParamGroup<T> {
  name: string
  items: T[]
}

/** Groups params: "Most used" first, then by topic; unmatched ones in "Other". */
export function groupParams<T extends { name: string }>(params: T[]): ParamGroup<T>[] {
  const byName = new Map(params.map((p) => [p.name, p]))
  const used = new Set<string>()
  const most: T[] = []
  for (const [name] of MOST_USED) {
    const p = byName.get(name)
    if (p) {
      most.push(p)
      used.add(name)
    }
  }
  const out: ParamGroup<T>[] = most.length ? [{ name: 'Most used', items: most }] : []
  const rest = params.filter((p) => !used.has(p.name))
  const taken = new Set<string>()
  for (const [name, re] of GROUPS) {
    const items = rest.filter((p) => !taken.has(p.name) && re.test(p.name))
    for (const p of items) taken.add(p.name)
    if (items.length) out.push({ name, items })
  }
  const other = rest.filter((p) => !taken.has(p.name))
  if (other.length) out.push({ name: 'Other', items: other })
  return out
}

export const MOST_USED_NOTES = new Map(MOST_USED)
