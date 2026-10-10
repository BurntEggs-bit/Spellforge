/**
 * Plain-English hints for the param fields modders touch most, by param type
 * (paramdef name) and field. They are shown under the field name in the row
 * editor, ahead of the community annotations (which are machine-translated
 * from the game's Japanese notes and often vague). Only fields whose meaning
 * Spellforge has verified against the game are listed here.
 */
const FIELD_HINTS: Record<string, Record<string, string>> = {
  BEHAVIOR_PARAM_ST: {
    variationId:
      'Which moveset this behavior belongs to. A weapon points at a variation (its Behavior Variation ID); the game finds behaviors by id = category × 100,000,000 + variation × 1,000 + judge.',
    behaviorJudgeId:
      'The number an animation fires (TAE "Invoke Behavior" event). Together with the weapon’s variation it picks this row; usually the last three digits of the row id.',
    ezStateBehaviorType_old: 'A leftover from the old id rules. Leave it as the original has it.',
    refType: 'What Reference ID points at: an Attack (AtkParam), a Bullet, or a SpEffect.',
    refId: 'The attack, bullet or SpEffect this behavior triggers, depending on Reference Type.',
    consumeSA: 'Poise this action uses up.',
    stamina: 'Stamina this action costs when it fires.',
    consumeDurability: 'Weapon durability used. Elden Ring has no durability; leave it at 0.',
    category:
      'Which buffs and boosts apply to this action (weapon-attack buffs, sorcery or incantation boosts, skill boosts…). Values without a name in the list are still used by the game; copying the original’s value is safest.',
    heroPoint: 'Humanity cost from Dark Souls. Unused in Elden Ring.',
  },
  BULLET_PARAM_ST: {
    atkId_Bullet: 'The attack (AtkParam) this bullet hits with: damage, poise damage, status buildup.',
    sfxId_Bullet: 'Effect drawn on the bullet while it flies.',
    sfxId_Hit: 'Effect played where the bullet hits or runs out.',
    sfxId_Flick: 'Effect played when the bullet is deflected.',
    life: 'How many seconds the bullet lasts.',
    dist: 'Distance (m) after which its damage starts to fall off (and its “in range” settings stop applying). Not how far it flies: Duration decides that.',
    initVellocity: 'Launch speed (m/s).',
    accelInRange: 'Acceleration (m/s²) while within range.',
    accelOutRange: 'Acceleration (m/s²) once out of range.',
    maxVellocity: 'Top speed (m/s).',
    minVellocity: 'Lowest speed (m/s) it can slow to.',
    gravityInRange: 'How strongly it falls while within range.',
    gravityOutRange: 'How strongly it falls once out of range.',
    hitRadius: 'Radius (m) of the bullet’s hit sphere at launch.',
    hitRadiusMax: 'Radius (m) the hit sphere grows to.',
    spreadTime: 'Seconds the hit sphere takes to grow to its maximum.',
    numShoot: 'How many bullets one firing creates.',
    shootAngle:
      'Side angle (°) it’s fired at, positive to the left: from the character’s facing, or for a chained bullet from its parent’s flight.',
    shootAngleInterval:
      'Side-angle step (°) between bullets when several are fired: bullet k aims at Launch Angle + k × this (the game doesn’t centre a spread; rows do, with a negative Launch Angle).',
    shootAngleXZ:
      'Up angle (°) from level, positive up: from the character’s facing, or for a chained bullet from its parent’s flight (a rising parent aims 89°, and its children’s up angles then sweep around it).',
    shootAngleXInterval:
      'Up-angle step (°) between bullets when several are fired: bullet k aims at Launch Elevation Angle + k × this. Fired from a rising bullet, it fans them out around it (Morgott’s sword rain: 5 bullets, 72° apart).',
    HitBulletID: 'Bullet created when this one hits or runs out: explosions, splits, the second stage of a spell.',
    intervalCreateBulletId: 'Bullet created repeatedly while this one flies (trails, rains of projectiles).',
    intervalCreateTimeMin: 'Shortest time (s) between those repeated bullets.',
    intervalCreateTimeMax: 'Longest time (s) between those repeated bullets.',
    intervalCreateWaitTime: 'Delay (s) before the repeated bullets start.',
    isOwnerOverrideInitAngle:
      'A chained bullet aims from the character’s facing instead of its parent bullet’s flight.',
    shootAngleYMaxRandom: 'Random side spread (°) on each bullet.',
    shootAngleXMaxRandom: 'Random up and down spread (°) on each bullet.',
    homingAngle: 'How fast it turns toward its target (°/s).',
    isEnableAutoHoming: 'Homes in on a target even without lock-on.',
    hormingStopRange: 'Stops homing once this close (m) to the target.',
    EmittePosType: 'Where the bullet starts. Chained bullets (Hit Bullet) usually start from their parent bullet.',
    isInheritSfxToChild: 'The bullet it chains into keeps this bullet’s flying effect.',
    isInheritSpeedToChild: 'The bullet it chains into keeps this bullet’s speed and direction.',
    launchConditionType:
      'When the chained bullet (Hit Bullet) is allowed to launch: on hit, when it runs out, and so on.',
    spEffectIDForShooter: 'SpEffect applied to whoever fired the bullet.',
    spEffectId0: 'SpEffect applied to what the bullet hits.',
    spEffectId1: 'SpEffect applied to what the bullet hits.',
    spEffectId2: 'SpEffect applied to what the bullet hits.',
    spEffectId3: 'SpEffect applied to what the bullet hits.',
    spEffectId4: 'SpEffect applied to what the bullet hits.',
    bulletSfxDeleteType_byHit: 'Whether the flying effect vanishes at once or fades out when the bullet hits.',
    bulletSfxDeleteType_byLifeDead: 'Whether the flying effect vanishes at once or fades out when the bullet runs out.',
  },
  ATK_PARAM_ST: {
    atkPhys: 'Physical damage.',
    atkMag: 'Magic damage.',
    atkFire: 'Fire damage.',
    atkThun: 'Lightning damage.',
    atkDark: 'Holy damage.',
    atkStam: 'Stamina damage to a blocking target.',
    atkSuperArmor: 'Poise damage.',
    hitSourceType: 'Whose dummy polys the hit shapes sit on: the body, or the weapon in hand.',
    hit0_Radius: 'Radius (m) of hit shape 0.',
    hit0_DmyPoly1: 'Dummy poly where hit shape 0 sits (on the weapon or body, see Hit Source).',
    hit0_DmyPoly2: 'A second dummy poly turns hit shape 0 into a capsule stretched between the two (−1 = a sphere).',
    spEffectId0: 'SpEffect applied to the target on hit.',
    spEffectId1: 'SpEffect applied to the target on hit.',
    spEffectId2: 'SpEffect applied to the target on hit.',
    spEffectId3: 'SpEffect applied to the target on hit.',
    spEffectId4: 'SpEffect applied to the target on hit.',
  },
  EQUIP_PARAM_WEAPON_ST: {
    behaviorVariationId:
      'Which moveset’s behaviors (attacks, bullets, skills) this weapon uses. A copy needs its own variation to change them without changing the original; Duplicate gives it one.',
    wepmotionCategory: 'Animation category (aXXX in the player’s animations) the weapon’s moveset plays.',
    spAtkcategory:
      'The weapon’s own animations (aXXX), played first: where it has one for a move, that plays instead of its class’s. 0: none. The Moveset tab makes one.',
    wepType:
      'What kind of weapon the game calls it (in menus and for Ashes of War); its moves come from Weapon Motion Category.',
    equipModelId: 'The weapon model (parts\\wp_a_NNNN).',
    swordArtsParamId: 'The skill (Ash of War) the weapon comes with: a SwordArtsParam row.',
    absorpParamId:
      'Where the game puts the weapon’s models (WepAbsorpPosParam): in the hand, and its second model (a scabbard, or the other of a pair) on the hip or in the other hand.',
    reinforceTypeId: 'Upgrade table (how stats grow per upgrade level).',
    isEnhance:
      'Greases and buff spells (Electrify Armament, Bloodflame Blade…) can be used on it. The game has it off on somber (unique) weapons, catalysts and elemental affinities (Fire, Magic, Cold…).',
    gemMountType:
      'Ashes of War: 2 can be changed; 0 can’t, and the weapon keeps its own skill (somber, unique weapons).',
    disableGemAttr: 'On: its affinity can’t be changed (somber weapons and catalysts have it on).',
    residentSpEffectId:
      'SpEffect on for as long as the weapon is equipped, in either hand: a passive, or a lasting look (one with a long Duration whose Cycle SpEffect has a weapon buff’s look).',
    residentSpEffectId1: 'SpEffect on for as long as the weapon is equipped, in either hand.',
    residentSpEffectId2: 'SpEffect on for as long as the weapon is equipped, in either hand.',
    residentSfxId_1:
      'An effect shown on the weapon while it’s equipped, at one of its dummy polys (Resident SFX - Dummy Poly).',
    residentSfxId_2:
      'An effect shown on the weapon while it’s equipped, at one of its dummy polys (Resident SFX - Dummy Poly).',
    residentSfxId_3:
      'An effect shown on the weapon while it’s equipped, at one of its dummy polys (Resident SFX - Dummy Poly).',
    residentSfxId_4:
      'An effect shown on the weapon while it’s equipped, at one of its dummy polys (Resident SFX - Dummy Poly).',
    residentSfx_DmyId_1:
      'The weapon’s dummy poly its Resident SFX sits on: one point (a look along the whole blade is a resident SpEffect’s).',
    residentSfx_DmyId_2: 'The weapon’s dummy poly its Resident SFX sits on.',
    residentSfx_DmyId_3: 'The weapon’s dummy poly its Resident SFX sits on.',
    residentSfx_DmyId_4: 'The weapon’s dummy poly its Resident SFX sits on.',
    correctType_Physics: 'The curve (CalcCorrectGraph) its physical damage’s stat scaling follows. 0 is a curve too.',
    correctType_Magic: 'The curve (CalcCorrectGraph) its magic damage’s stat scaling follows.',
    correctType_Fire: 'The curve (CalcCorrectGraph) its fire damage’s stat scaling follows.',
    correctType_Thunder: 'The curve (CalcCorrectGraph) its lightning damage’s stat scaling follows.',
    correctType_Dark: 'The curve (CalcCorrectGraph) its holy damage’s stat scaling follows.',
    correctType_Poison: 'The curve (CalcCorrectGraph) its poison buildup’s scaling follows.',
    correctType_Blood: 'The curve (CalcCorrectGraph) its blood loss buildup’s scaling follows.',
    correctType_Sleep: 'The curve (CalcCorrectGraph) its sleep buildup’s scaling follows.',
    correctType_Madness: 'The curve (CalcCorrectGraph) its madness buildup’s scaling follows.',
    spEffectBehaviorId0: 'SpEffect applied by the weapon’s hits (e.g. bleed or frost buildup).',
    spEffectBehaviorId1: 'SpEffect applied by the weapon’s hits.',
    spEffectBehaviorId2: 'SpEffect applied by the weapon’s hits.',
    weight: 'Weight.',
    attackBasePhysics: 'Base physical damage.',
    attackBaseMagic: 'Base magic damage.',
    attackBaseFire: 'Base fire damage.',
    attackBaseThunder: 'Base lightning damage.',
    attackBaseDark: 'Base holy damage.',
    durability: 'Elden Ring has no durability: this does nothing.',
    durabilityMax: 'Elden Ring has no durability: this does nothing.',
    isNormalAttackType: 'Only the menu’s label (Standard): what a hit does comes from its attack (AtkParam).',
    isBlowAttackType: 'Only the menu’s label (Strike): what a hit does comes from its attack (AtkParam).',
    isSlashAttackType: 'Only the menu’s label (Slash): what a hit does comes from its attack (AtkParam).',
    isThrustAttackType: 'Only the menu’s label (Pierce): what a hit does comes from its attack (AtkParam).',
    enableGuard: 'Lets it guard, with its class’s guard animations: a class that has none does nothing.',
    enableParry: 'Lets it parry, with its class’s parry animations: a class that has none does nothing.',
    enableMagic: 'A catalyst: needs a moveset with spell casts.',
    enableMiracle: 'A catalyst: needs a moveset with spell casts.',
  },
  ITEMLOT_PARAM_ST: {
    getItemFlagId:
      'Once this flag is on, the lot gives nothing more: what a pickup or a boss gives only once. A lot an event gives every time needs 0.',
  },
  SWORD_ARTS_PARAM_ST: {
    swordArtsTypeNew:
      'Which animations the skill plays: category a(600 + this). Unsheathe is 14 (a614), Gold Breaker 229 (a829). To give a skill moves of its own, copy a category in Animations to a free number and set this to match.',
    textId:
      'Its name and description: the Skill names / Skill descriptions entry with this id. Skills can share one; a copy gets its own.',
  },
  SP_EFFECT_PARAM_ST: {
    effectEndurance:
      'How long it lasts (s). −1 lasts as long as whatever applies it, but then its cycle never fires: a carrier that starts another SpEffect needs a long time (1000000).',
    motionInterval: 'Seconds between the times it takes effect again, and starts its Cycle SpEffect again.',
    cycleOccurrenceSpEffectId:
      'Another SpEffect it starts while it runs, every Trigger Interval: a SpEffect on the weapon (Passive SpEffect) shows a buff’s look through one.',
    wepParamChange:
      'Which weapon a buff goes on: 1 the right hand’s, 2 the left’s; 0 for one that isn’t a weapon buff.',
    vfxId: 'The visual effect shown while it’s active (SpEffectVfxParam).',
  },
  SP_EFFECT_VFX_PARAM_ST: {
    midstSfxId:
      'Effect looping while the SpEffect is active: on the character, or along the weapon (from Enchant SFX Start to its end) for a weapon buff’s look.',
    initSfxId: 'Effect played once when the SpEffect starts.',
    effectType: 'A weapon buff’s look: 1 on the right hand’s weapon, 2 on the left’s.',
    isUseOffsetEnchantSfxSize:
      'Plays the version of Midst SFX ID made for the weapon’s blade size: that id plus the weapon’s Enchant SFX Size.',
    ...Object.fromEntries(
      [0, 1, 2, 3, 4, 5, 6, 7].flatMap((k) => [
        [
          `enchantStartDmyId_${k}`,
          'Where a weapon buff’s look starts, running from this dummy poly up the blade: 10300 on the right hand’s weapon (11300 its second blade), 20300 on the left’s. −1: not used.',
        ],
        [
          `enchantEndDmyId_${k}`,
          'Where that look ends: a dummy poly further up the blade, or −1 to run as far as its points go.',
        ],
      ]),
    ),
  },
}

/** Spellforge's own hint for a field, if it has one. */
export function fieldHint(paramType: string, field: string): string | undefined {
  return FIELD_HINTS[paramType]?.[field]
}

/**
 * Fields the row editor always lists, even at 0 (it hides zeros by default):
 * switches whose 0 is a meaningful answer, like a somber weapon that can't
 * take buffs or Ashes of War.
 */
const KEY_FIELDS: Record<string, string[]> = {
  EQUIP_PARAM_WEAPON_ST: [
    'isEnhance',
    'gemMountType',
    'disableGemAttr',
    // Curve 0 is a curve: the nine are only readable side by side.
    'correctType_Physics',
    'correctType_Magic',
    'correctType_Fire',
    'correctType_Thunder',
    'correctType_Dark',
    'correctType_Poison',
    'correctType_Blood',
    'correctType_Sleep',
    'correctType_Madness',
  ],
}

export function isKeyField(paramType: string, field: string): boolean {
  return !!KEY_FIELDS[paramType]?.includes(field)
}
