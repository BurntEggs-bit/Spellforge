# Troubleshooting

How to get from what you see in game to its cause. Most "it does nothing in game" reports are a broken link in a
chain that Spellforge can show. Read the [format notes](reference/format-notes.md) for the area involved before
changing code.

## The game crashes at startup or while loading

1. **ModEngine 3's log** (`%LOCALAPPDATA%\garyttierney\me3\data\logs\<profile>\<time>.log`) lists each of the mod's files
   as the game opens it (`override=…`). The last ones before it stops are the suspects.
2. **Windows' Application log** (Application Error 1000 for `eldenring.exe`) gives the exception code and the fault
   offset. The same offset on every launch means a file, not chance.
3. **The dump.** Windows keeps one in `%LOCALAPPDATA%\CrashDumps\eldenring.exe.<pid>.dmp` (the pid is in ModEngine 3's
   log). Opened in a debugger (WinDbg, or Visual Studio), it shows the exception, the code around it, the registers and
   the return addresses on the stack. Together they say what the game was reading, and which registers hold the file's
   base and the place it read.
4. **Find the file and the place**: the offset from the registers, the file whose layout fits, and the bytes there
   against what the game read. When the file's bytes are right and the game's weren't, suspect the packing: every
   256 KB chunk of a Kraken file must unpack on its own ("DCX/KRAK seek chunks" in the format notes).
5. **Confirm and narrow it.** Restore the newest backup from `.spellforge-backups` to confirm the last save caused it,
   then put back one changed file at a time (the regulation, the animation binders, the effect bundles, the sound
   banks) until the crash goes: that's the file to look at.

## A weapon, skill or spell does nothing, or the wrong thing

1. **Was it saved?** The top bar says Unsaved until Save, and the save notice lists every file written.
2. **Is the game loading this mod folder?** ModEngine 2's `config_eldenring.toml` names the mod path; ModEngine 3's
   `.me3` profile its `path`. ModEngine 3 plays on its own save file.
3. **Is it the right game version?** A project made before a patch needs Update from game; until then its
   `regulation.bin` overrides the patch's params.
4. **Follow the chain in Params.** Pick the item: "Everything it uses" shows each link. A skill is

   ```
   EquipParamWeapon.swordArtsParamId → SwordArtsParam
     → animations a6xx (600 + swordArtsTypeNew)
     → TAE events (AttackBehavior / BulletBehavior judges)
     → BehaviorParam_PC (3 × 100,000,000 + variation × 1000 + judge)
     → AtkParam_Pc / Bullet / SpEffectParam
   ```

   A weapon's attacks are the same chain with category 1. Its animations come from `spAtkcategory` first, then
   `wepmotionCategory`.
5. **Can the game play the animation?** The Animations page says "Playable: in N of M behaviour selectors"; 0 means it
   isn't registered in `c0000.behbnd` (use Register).
6. **Does the judge resolve?** Selecting an event shows the chain from the weapon to its behavior row. A missing row
   means that judge does nothing for this weapon.
7. **A new skill does nothing on L2:** the game's script reads per-skill-type tables unchecked, so a new skill type
   needs its entries; a project missing them says so when it opens ("A new skill type needs the script" in the format
   notes).
8. **Moveset:** `.spellforge/movesets.json` records what was given, including attacks made from an enemy's move and
   their judges. The Moveset tab says where each move comes from; "Back to its own" undoes a slot.
   - An attack made from an enemy move doesn't play: its animation must be Playable and `spAtkcategory` the category
     Moveset made; its motion is in `chr\c0000_a9x.anibnd.dcx`.
   - It plays but doesn't hit: its AttackBehavior must lead to a `BehaviorParam_PC` row (judges 701 and up) and an
     `AtkParam_Pc` copy.
   - It doesn't chain or can't be cancelled: compare its cancel window (ChrActionFlag 4) with the class's animation.
   - An enemy combo plays on one press: make it an attack with steps, one per press; the game counts the combo length
     per weapon, so give each grip its own (the Behaviour tab).

## A skill hits too small or too big, its shockwave is missing, or it shoves enemies far

1. **Its hits against the enemy's.** Scale… on the skill lists its attacks' radii, its bullets' radius and each effect's
   size: each should be the enemy's (a copy is named after its original) times the skill's size in
   `.spellforge/scales.json`.
2. **Its push.** `knockbackDist` is in metres (the attack row's Knockback Distance). Enemy attacks push up to 20 m, which
   slides bosses across the arena; player copies are capped at 2 m.
3. **Its bullet's attack.** A bullet hits with the `AtkParam_Pc` row of its `atkId_Bullet`. When an unrelated player row
   has that id, the bullet hits with it; "Copy the attack for the player" on the Bullet row makes the right copy.

## Effects

- **Missing in game, fine in the viewer:** the effect must be in the mod's `sfx\sfxbnd_commoneffects*.ffxbnd.dcx`. A
  character's own effects (`sfxbnd_cXXXX`) load only near that character; making a move the player's imports them.
  Each effect's `.ffxreslist` must list its textures and models, and the FXR's internal id must equal its file name, or
  the effect may never end.
- **Two effects at once, only one shows:** a character holds one effect per slot. The SlotID line says when another
  effect holds the same slot at that time, and names a free one; the viewer shows what the game does.
- **An enemy's weapon effect floats beside the hand:** moves made with an older Spellforge weren't fitted to the hand.
  Make the move again (Enemies → Make it…), or Scale… the skill with "Kept in the hand".
- **The preview looks different from the game:** the preview interprets FXR itself, and the format notes record every
  behaviour verified against in-game screenshots. Get an in-game screenshot before changing brightness; check the
  reference effects (campfire 7000, Sacred Ring of Light 440191, the greases) are unchanged by any change to colour
  handling.

## Sounds

- **Silent:** ModEngine 2 (2.1) doesn't load a mod's sound banks; use ModEngine 3. The mod needs
  `sd\enus\cs_main.bnk`; `.spellforge/sounds.json` lists what was brought in.
- **Menu and player sounds gone:** the game dropped the whole player bank. A bank written by an older Spellforge is
  rebuilt when the project opens; the `wwise` suite checks the writer.
- **A boss's voice from your weapon:** moves made with an older Spellforge kept the character's voice (its 08xxx sound
  events); delete those events. Moves made now leave the voice behind.

## A shop doesn't sell an item

- `ShopLineupParam`: the visibility and quantity event flags must be 0, `equipType` must match (Weapon, Goods…) and
  `equipId` must be right. Spells are Goods: the shop sells the Goods row with the same id.
- A shop lists only the rows between the two ids its dialogue opens: the row's line says which shop sells it, and Copy
  row keeps a copy in its shop (or says the shop is full).

## The app shows an error or misbehaves

- Errors show as notices. Run the exe from a terminal to see the main process's log; Ctrl+Shift+I opens the developer
  tools.
- Unsaved work after a crash is in `%APPDATA%\spellforge\recovery`; the start screen offers it back.
- To reproduce a UI problem, run `npm run dev` ([development.md](development.md)) with fresh settings: rename
  `%APPDATA%\spellforge` first, and put it back after.
- An ID field says the wrong thing: param fields are described by the params service's row view (Smithbox's
  references, missing rows, effect names); animation event fields by the animations service; animation ids by
  `src/shared/animIds.ts`.
