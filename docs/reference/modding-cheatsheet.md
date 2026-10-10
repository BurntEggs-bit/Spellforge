# Elden Ring modding cheat sheet

The ids, numbering and conventions Spellforge relies on, each verified against the game's files. The details and
the evidence are in the [format notes](format-notes.md).

**IDs and lookups**

- `BehaviorParam_PC` id = category·100,000,000 + variation·1000 + judge.
  - Category 1: weapon moves (judges < 1000). Category 3: skills.
  - Lookup falls back: variation → its hundred (Mace 1102 → 1100) → 0. The row repeats `variationId`.
- A weapon is its affinity rows too: the same ten-thousand, every 100, same class (Uchigatana 9000000…9001200).
- Animation `aXXX_YYYYYY`:
  - XXX = category: `wepmotionCategory` (the class: 29 katana, 33 hammer…); `spAtkcategory` (the weapon's own, 50–999, played first); 400 + Magic `refType` (spell casts); 600 + `swordArtsTypeNew` (skills). New motions (retargeted HKX) go into `c0000_a9x.anibnd`.
  - YYYYYY = the move (`src/shared/animIds.ts` says it in words):
    - `030000…` R1 chain (030010 the 2nd…); two-handed is +2000 (032000); `0302xx` running; `0303/0304xx` roll and backstep; `0307xx` guard counter; `0309xx` special attacks;
    - `0305xx` R2: 030500 charged start, 030501 charge loop, 030505 quick, 030510/030515 the second;
    - `031/033xxx` jumping; `035xxx` left hand; `034xxx` dual wield; `037xxx` weapon actions; `038–039xxx` mounted;
    - `040000…` skills; `04005x`/`04006x`/`04007x` stances; `045010` a right-hand cast, `045110` left.
  - A mod's motions can sit in any c0000 binder by number (Clever's a683 in `c0000_a6x`) and its TAE may name them anything; the game finds the HKX by the animation's id.
- How a big moveset mod is built (Clever's Sacred Arsenal: one weapon, its own category and variation, conjured weapons as effects in `sfxbnd_c8000`, a bullet chain for its skill, behavior-script edits): the format notes, "How a big moveset mod is built".
- Behaviour graph: clips are registered per selector in `c0000.behbnd` (CMSG offsetType 13 right hand, 16 both hands, 18 SwordArts). A copy needs registering for the game to play it.
- Behaviour script (`action/script/c0000.hks`, HavokScript; format notes, "Behaviour scripts"; [HavokScript notes](havokscript-notes.md)): numbers are 32-bit floats (a SpEffect it tests must be under 16,777,216); TRUE / FALSE are 1 / 0; `ExecEvent("W_X")` plays selector `X_CMSG`; the game also loads a text script. Spellforge's recipes are wrappers appended at the end (before a final `return`), each run under `pcall` so an error falls back to the game's own code.
- Stances: `wepmotionOneHandId` / `wepmotionBothHandId` pick categories (a000, a002, a003; a010, a012–a016) of walking, guarding, jumps, riding and the grip change (`029070` taking it in both hands). Separate from the attack category.
- Sounds in the viewer: a TAE sound posts `Play_<letter><id, 9 digits>`; its Play actions → random (by weight) / switch (default) / layer containers → sounds; loudness prop 0x00 (dB) and pitch 0x02 (cents) add up the tree.

**TAE events** (`data/er/tae-template.json`)

| Type | Event |
|---|---|
| 0 | ChrActionFlag (FlagType 4 "Cancel – RH Attack": the R1 chain window) |
| 1 | AttackBehavior (judge) |
| 2 | BulletBehavior (dummy, judge; `@18` is 255 in every one the game has) |
| 64 | CastHighlightedMagic (dummy, RefType = which Magic refId) |
| 66 | SpEffect |
| 96 | SpawnOneShotFFX (IsRestrictToDummyPoly: it ends with its event) |
| 114/115 | SpawnFFX_GoodsAndMagic (DummyPolySource 0 body, 1 left, 2 right; SFXIndexID 0/1/2 = the Magic row's castSfxId / fireSfxId / effectSfxId) |
| 118 | SpawnFFX_Blade |
| 129 | Sound (SoundType 5 = spells' s-sounds) |
| 224 | Turn speed |
| 300 | JumpTable early |

**Dummy polys**

- Body ids are under 10000 (1 right hand, 2 left hand (left-hand casts use 3), 5/6 feet, 7 head, 8 chest, 9 hips…).
- 10000 + id is on the right weapon, 20000 + id on the left.
- Every weapon model has the same hit dummies: 100 tip, 110 middle, 120 grip, 122, 130.
- Buffs coat 300→301→… (`SpEffectVfxParam` enchant dummies; the coating effect every 15 cm).
- A staff casts from 181.

**Magic**

- `refType` → cast category 400 + refType (Pebble a401, Lightning Spear a436).
- `refCategoryN` 1 = bullet, 2 = SpEffect.
- `ezStateBehaviorType` 0 sorcery, 1 incantation.
- Spells are Goods for names and shops.

**SpEffect**

- `stateInfo` 184 hides the right weapon (Unseen Blade 1466000, vfx `isInvisibleWeapon`).
- A weapon's passives are `residentSpEffectId`, `1` and `2`.
- Buff spells point at SpEffects (Magic refCategory 2; `wepParamChange` 1 right, 2 left).

**Effects**

- Bundles: `sfxbnd_commoneffects`, `_dlc01`, `_dlc02`, and per character (`cXXXX`) or map.
- Model and texture lists are in each `.ffxreslist`.
- `rgbMultiplier` and `alphaMultiplier` follow active time; color1 and color3 follow particle age; color2 follows emission time.

**Enemies**

- Their moves resolve through BehaviorParam 2·1e8 + variation·1000 + judge (NPC), with `AtkParam_Npc` for attacks.
- Made the player's, attacks are copied to `AtkParam_Pc` with `isAddBaseAtk`.
- The motion is retargeted bone by bone (mirror for left-handed moves, upright, travel scaled to the player's size).
- Their effects are imported into the common bundles, their sounds copied from `cs_cXXXX` into `cs_main`.

**Other systems**

- **Text:** FMG; item names in `item_dlc02.msgbnd` (Spellforge writes there); the game shows GoodsName for spells.
- **Shops:** `ShopLineupParam`; the Twin Maiden Husks from 101800.
- **Flags:** EMEVD (event scripts) and ESD (talk scripts) set and check them. A flag's number encodes its map. `ids.ts` explains every flag the game uses.
- **Maps:** MSB (the DLC's are version 74).
- **Containers:**
  - `regulation.bin`: AES-CBC, then DCX/ZSTD, then BND4.
  - Bundles and anibnds: DCX/KRAK (Oodle, via the game's own `oo2core_6_win64.dll`, never shipped).
  - The packed game is BHD5-encrypted and is decrypted in `bhd5.ts`.
