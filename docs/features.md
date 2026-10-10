# Features

Everything Spellforge does, by workspace, followed by what it writes, what keeps your files safe, and its known limits.
The walkthrough videos built into the app (Walkthrough on the start screen, or Help > Walkthrough) show all of it.

- [The game and your project](#the-game-and-your-project)
- [Params](#params)
- [Effects](#effects)
- [Animations](#animations)
- [Movesets](#movesets)
- [Behaviour scripts](#behaviour-scripts)
- [Enemies](#enemies)
- [The app](#the-app)
- [Safety](#safety)
- [Known limits](#known-limits)

## The game and your project

- **No unpacking.** On first launch Spellforge finds Elden Ring in your Steam libraries and reads the game straight from
  its install: the archives' file tables are decrypted with the game's public keys and files are read from them in
  memory. When the game updates, the new files are picked up by themselves. An unpacked copy of the game also works.
- **Open a project** by its ModEngine `mod` folder, or the project folder that holds it.
- **Edited means yours.** A project made with an older game version is compared with that version's own files, not the
  installed game's, so FromSoftware's patch changes don't show as your edits (params, text, animations and effects
  alike). Spellforge keeps a copy of each game version's regulation, text and player animations it sees (about 21 MB
  each, in its settings folder, plus the hashes of the effect bundles your projects use).
- **Update from game** brings a project made with an older game version up to the installed one in one go (the button
  in the version note). Params are merged field by field: everything the update changed or added comes in, every field
  you changed keeps your value, and rows you added or removed stay that way. The update's new and changed effects,
  animations and text come in the same way, around your own edits. It saves (with backups) and reopens the project.
  Your behaviour graph, scripts and models are kept as they are, and listed.
- **Nothing lost to a crash.** Every change is kept as you make it, until you save. If Spellforge crashes or closes with
  unsaved changes, the start screen offers them next time ("Open and restore"); restored, they're exactly as they were,
  still unsaved. It reopens where you left off (the page, the row, the animation).

## Params

- **Browse** weapons, items, skills, bullets and effects, or **All params**: every one of the 194 param tables. Rows your
  project added or edited are badged.
- **Edit any row:** fields with English names and what each does, dropdowns for enum fields, and clickable references.
  The field list hides zeros by default ("all" shows them), except switches whose 0 means something: a weapon's buffs
  (Is Buffable), Ashes of War and affinity change are always listed, so a somber weapon's "can't" shows. The item's
  **in-game name** is the first field (a spell's is its item's: the game shows the GoodsName of the same id).
- **Row actions** sit in the Inspector's header: Duplicate…, Scale…, Copy row, Rename and Delete (with a warning if
  other rows still point at the row).
- **Reference tree:** weapon → moveset and skill behaviors → bullets → hit bullets, attacks, SpEffects. Effects show as ✦
  chips, and behaviors show how many **animations fire them** (▶); the Inspector lists those animations, their timing
  and dummy poly.
- **Pin a panel:** the pin in the Inspector's header keeps it on its row while you browse; copying the pinned row moves
  the pin to the copy. Click any ID in Browse or the tree to copy it.
- **Duplicate…** copies a weapon, item, skill or bullet with everything it owns.
  - Rows other content also uses stay shared by default, with the reason shown; click to copy them anyway.
  - New IDs never collide with existing rows or with IDs something already points at. Weapons get a fresh 10,000-id
    block for their affinities.
  - Effects can be copied too, with their child effects, so recolouring the copy never touches the original.
- **Scale…** (a skill, spell or bullet, an effect, or a skill just made from an enemy's move) makes it bigger or
  smaller: its effects and its hitboxes together (player attacks' hit radii, bullets' radius and the radius they grow
  to), previewed beside a 1.75 m figure. Sizes are of the original, so 80% stays 80% however often you change it.
  Effects held on a weapon (Margit's hammer on your blade) are held where their owner held them: his grip goes in your
  hand, on the weapon's line, and they're scaled about it. **Fit the weapon** is the size at which the effect reaches the
  weapon's point it appears at, so the weapon's own hits land where you see it. Effects other content also uses are
  copied first; enemies' own attacks are never touched.
- **Names everywhere:** official in-game names from the game's text (your project's text wins), community row names,
  your project's own Smithbox names, and names and descriptions for about 11,900 effects from the community FXR ID sheet.
- **Icons:** items, weapons, armour, spells and status effects show the menu icon the game draws for them, cut from the
  game's own menu atlases. An icon id the game has no picture for is pointed out, unless the game itself uses it there.
- **Every ID says what it is:** the line under an ID field names what it points at (the row and its in-game name, an
  effect's name, "copy of 621303", a dummy poly's place, a sound), or says that nothing has that ID. An animation's id
  says which move it is ("R1, 1st (one-handed)", "R2 held, charged", "skill").
- **What is this ID?** (the `#` button in the top bar, or the line under a field) explains any number from the game's
  own files:
  - **Event flags:** the community name when there is one; the map the number belongs to (10000800 is Stormveil
    Castle's flag 800); every param row using it and what that means ("Picked up: Smithing Stone [1]", "Bought in a
    shop: …", "Boss defeated: …"); every event script that sets, clears, checks or waits for it (all 589 event files,
    common events followed through their parameters), with what those events do; and every NPC dialogue that sets or
    checks it. All 15,613 flags the game uses get a one-line summary.
  - **Entity ids:** what the maps place with it (all 1,347 map files): a character (named from its NpcParam, with its
    row and dialogue), an asset, a region, or an entity group's members.
  - **Talk scripts** named after the character the maps give them to, text ids, rows with that id in any param, icons,
    effects, character models, and ids shared between fields (a behavior variation: who else uses it).
- **Text:** names and descriptions (FMG), with "Only what I edited" and Update from game.
- **Weapons:** the attack at each upgrade level, every damage type and the scaling letters, at the stats you type (its
  requirements to start), worked out as the menu does (base × the level's rate, scaling by each stat's curve, 40% off
  for a stat below its requirement).
- **A weapon's own model:** Model of its own copies its model (both detail levels) under a free id with its files'
  names changed to match, so its textures can change without changing the original's; its affinities follow. Import
  model… puts a .flver and textures (.png packed as the game's: colour maps sRGB, the rest linear; or .dds) into it.
- **Where to get it:** an item's item lots (and the enemies and event scripts that give them) and its shop rows (and the
  shops listing them). An item nothing gives says so.
- **Ash of War item** on a skill makes the item that puts it on weapons (a copy of one whose skill plays the same
  animations); **Both hands** on a weapon buff copies it for the left hand's weapon, cast with it.
- **What doesn't work:** fields that do nothing in Elden Ring (durability, the attack-type labels) say so, and a row set
  up so it can't work (a SpEffect lasting forever whose cycle never fires) says why.
- **Fields in groups:** a row's fields are listed under Smithbox's headings where it has a field layout for the param
  (a weapon's nine Correction Type fields together, its guard cut rates together), and in the game's own field order
  (its paramdefs' SortID) elsewhere. A heading folds its group away, remembered per param. A Correction Type of 0
  shows and links like any other curve.
- **A weapon's own look:** the viewer draws what a held weapon's Passive SpEffect keeps on it (one with a duration
  whose Cycle SpEffect has a weapon buff's look, the Souls Modding wiki's way), with no buff picked. The hints of the
  fields it takes (Duration, Trigger Interval, Cycle SpEffect ID, Weapon Parameter Change, Effect VFX, the enchant
  points, Resident SFX) say what each does; the walkthrough's Part 8 builds one by hand.

## Effects

- **Copy as your own:** any effect copied under a free id (900000000 and up), to change without changing the game's or
  anything else that uses it.
- **Recolour** (replace, hue only, tint, hue shift, saturation, grayscale, invert) the whole effect, one node, or its
  child effects too.
- **Swap textures and models** by dragging thumbnails onto slots (the wheel scrolls while you drag, as does
  resting the pointer near a panel's top or bottom edge); **import** your own images (`.png`, packed as the
  game packs its textures: BC7 linear, or BC4 for a greyscale mask, with mips) or `.dds` textures (BC7, BC1 or BC4)
  and `.flver` models with their textures.
- **Edit any field** of any part of the effect, with the field documentation of @cccode/fxr; scaling a field keeps its
  curve and random range in shape. Change blend modes.
- **Warnings** for black on additive blending, model tinting, and shared game effects.
- **Preview:** an animated approximation with real textures, colours, emitters, blend modes and 3D model meshes.
  - Lit by the game's own light probes: pick an area (Limgrave, Caelid, Liurnia, Stormveil, Leyndell, Raya Lucaria,
    Volcano Manor, Farum Azula, Siofra, the Realm of Shadow and more), its time of day, and any of its probe spots.
  - Rendered in HDR with ACES tone mapping, bloom (including FXR's extra bloom colour) and a partial eye adaptation, so
    effects stand out in caves and at night the way they do in game. The effect's point lights light the ground,
    models and lit particles.
  - An effect a moving bullet carries flies at that bullet's speed, so parts emitted per metre moved appear as in game.
  - Exposure, bloom and backdrop controls, a 1.75 m figure for scale, and an axis choice (projectiles fly along their
    +Z; effects on items or the ground stand on it).

## Animations

- **Browse** the player's animation categories (`c0000.anibnd`), labelled with the weapons and skills that use them
  (search "scythe" finds a050).
- **Edit events on a timeline:** drag to move, drag edges to resize, snapped to frames (Alt for free). Events stack in
  lanes by type and are coloured by kind. Every field is decoded with DS Anim Studio's Elden Ring template: value labels
  as dropdowns, effect / SpEffect / behavior fields linking straight to that effect or row. Unknown event types get a
  raw-bytes editor.
- **Add** events (searchable by name, sorted by how often the game uses them), **duplicate** (Ctrl+D) and **delete**
  (Del). Select several (Ctrl- or Shift-click, or drag a box) to move them together, or copy, cut and paste them at the
  playhead, into any animation (Ctrl+C / X / V). Every edit can be undone and redone (Ctrl+Z / Ctrl+Y, or from the list
  of the last steps). DS Anim Studio's shortcuts work; F1 lists them.
- **Find** (Ctrl+F) events by type and a field's value in every animation, or by what they use (`@effect 302000`,
  `@speffect`, `@judge`, `@sound`, `@dummy`). **Go to** an animation or a category (Ctrl+G / Ctrl+H); Page Up / Down
  jumps to the same id in the previous / next category.
- **Properties** (F3): an animation's id and category, its motion (its own, another animation's, or everything from
  another), whether it loops, and which animations use it; once registered, how its clips in the behaviour graph play
  (speed, cut from the start and end, play mode, mirrored), all of them at once. Shift+F2 moves a whole category to a
  new number (the weapons and skills using it can follow). Names and tags of your own (F2), kept with the project.
  Events export as text and import from another animation (Ctrl+I).
- **Behavior judges follow the weapon in hand:** an event's judge line names the row the game plays for the weapon in
  the viewer (its own, its base variation's, or every weapon's). When there's none (an event pasted from another
  weapon's animation), **Copy from another weapon…** copies that weapon's row for it, for this weapon or every weapon,
  with its own attack and bullets to balance if you like.
- **Mute or solo** events in the viewer (1, 2; 3 clears), or a whole type (4); lane colours of your own (C).
- **Combo** (F8): animations one after another, each cut where its R1 / R2 / dodge / any cancel window opens (or at a
  frame you pick), root motion carried on and blended, every step's events at their times.
- **Entire spell:** a spell cast from start to finish with all its bullets and effects, from its row, from any of its
  effects, or from the viewer while one of its cast animations is open. Its cast animations play in the game's order,
  each cut where the game moves on, with a staff or seal in hand.
- **Duplicate** an animation, or **copy a whole category**, into a new category or id. Copies reuse the original's
  motion and get their own events.
- **Register** animations in the behaviour graph (`c0000.behbnd`) so the game plays them, adding the same clips
  ERClipGeneratorTool does. Each animation shows whether it's playable; new ones that aren't get a one-click Register.
  Jump attack landings start where the jump left off (TimeActEditor_10), as modders bind them.
- **The viewer** plays the animation on your character with armour and weapons (the outfit is remembered; what a
  project doesn't have comes off), hitboxes, bullets and effects:
  - Bullets fly as the game aims them, chained stages included (a split emitter fanning out swords, a rain of them
    falling), up to 1,200 per animation.
  - Weapons with a scabbard draw the blade and hang the scabbard where `WepAbsorpPosParam` says; paired weapons put the
    second one in the other hand. **Held** shows one-handed or either weapon two-handed, at the game's grips. With no
    helmet, the bare head (face, hair, eyebrows, beard, eyelashes, an accessory).
  - **What the events do, acted out:** playback speeding up or slowing down, the character fading, weapons hidden or
    moved to another of their places, model parts shown or hidden, each SpEffect's own visual effect, and the
    **sounds**: each sound event's Wwise sounds from the game's banks, one of a random set picked as the game does, at
    the bank's loudness and pitch.
  - **Weapon buffs:** greases and buff spells coat the whole blade as in game, already burning when the animation starts.
  - **Helpers** as DS Anim Studio has them: dummy polys, FLVER and HKX bones with names, axes and bounding boxes, the hit
    capsule, hit shape names, the attacks' reach, sound markers; root motion scaled or turned. **Weapon** (F) frames the
    held weapon and follows it.
  - **Export** (⤓) the character, skeleton and animation as `.glb` for Blender, or just the skeleton and the motion.
  - **Move and rotate** (G, R) the selected effect event's effect in the viewer: drag its handle, with snapping in 1 cm
    and 15° steps, or let go near another dummy poly to move the event there. A game effect is copied first.
- **F5 reloads the character in the running game** (offline, EAC off) after saving, as DS Anim Studio and Smithbox do;
  File > Reload in game after every save does it on every save. **File > Save and play in game** starts the game with
  the project through ModEngine 3, offline, on a save of its own (Spellforge.sl2).
- "Fired by animations" on a behavior row opens the animation here.

## Movesets

The **Moveset** tab (beside Events) gives the weapon in the viewer's right hand other weapons' moves. Only that weapon
changes, with all its affinities; every choice plays in the viewer first (▶), and a move can go back.

- **Attacks:** light, heavy, running, roll and backstep, jumping, guard counter, left-hand, dual-wield and mounted
  attacks can each come from any class's standard moves or a weapon's own. The weapon gets a special category of its own
  (`spAtkcategory`) with copies of those animations, registered in the behaviour graph, and a behavior variation of its
  own, so the moves hit like on the weapon they come from or like its own attacks. Its skill can be any skill.
  **Held** takes a slot's moves for one grip only (a dagger one-handed, Rellana's Twin Blades two-handed); the other
  grip keeps its own.
- **Stance and grip change:** the weapon held one- and two-handed like another class (how it's held, walks, guards,
  jumps and rides, and the 1H → 2H swap), from the game's own stances, or from a copy of one (Copy category on the
  stance's category): its grip changes are then its own, to put effect events on.
- **Spells as its attacks:** its light, heavy, running, roll and guard-counter attacks can cast a spell instead: the
  attacks become the spell's casts, its bullet fired from the weapon's tip. **Cast like** another spell gives that
  spell's look. No FP; each cast costs the spell's stamina.
- **Effect on its attacks:** an effect its skill spawns shown on its attacks, with its vanish at each swing's end;
  **Hide the weapon itself** hides its own model (it still hits). Margit's hammer as a weapon.

## Behaviour scripts

The **Behaviour** tab edits the player's behaviour script (`action/script/c0000.hks`, HavokScript) with recipes instead
of code:

- **Recipes:** an animation jump (during part of an animation, R1 / R2 / L1… plays another: custom combos), a chain into
  another animation, the two-hand button playing an animation (instead of changing grip, only right after part of an
  animation, or while a SpEffect of yours is on: a weapon's forms), special attacks (charging R2, the dodge button
  plays 030950, with the game's own window added to the weapon's charged R2), second heavy attacks (while a SpEffect
  of yours is on, R2 plays the 030600 set Barbaric Roar or War Cry give), a weapon's combo length (per grip), a skill
  type, a weapon's dodge and no guard. Windows are made for you: a marker SpEffect and its AddSpEffect event on the
  timeline.
- **Your scripts** (the script editor): HavokScript of your own, added after the game's code and the recipes', checked
  as you type by Spellforge's HKS compiler and its checks of what the game's script expects. Errors and warnings are
  underlined and listed with their line and column; the compiled instructions are shown. The game's own script is there
  to read and search, and **Wrap it** starts a script around any of its functions.
- Spellforge decompiles the installed game's own script (or keeps the project's), adds its part, checks that it
  compiles, and writes it as text on Save; after a game update it's made again from the new game's script. **Compare with
  the game** shows what a project's script changed and what it's missing from the game's newer version.
- The techniques follow Clever (Sacred Arsenal, Moveset Modpack) and the community's EldenRingHKS (ividyon, Vawser,
  Exelot and others); Spellforge writes its own code.

## Events

The **Events** page reads the game's event scripts (`event/*.emevd.dcx`): what the world does on its own.

- **Every script:** the common one (always loaded), the shared events the maps start, and one per map, named.
- **Every event in plain words:** its lines as Spellforge reads them ("Wait until group A2 passes", "Boss health bar on:
  18000850"), its ids as links (flags, characters, areas, item lots, SpEffects, text), and what starts it. An event
  nothing starts is marked.
- **Events of your own** (+ Add): give an item (an item lot, or one made for any weapon, item, armour, talisman or Ash
  of War; once per save or every load), set a flag (as the script loads, when another flag turns on, or when the
  player walks into an area), while a SpEffect is on (give another, set a flag or give an item; undone when it ends),
  bring in an enemy when a flag turns on, and a boss fight (gone once defeated, idle until you're in its arena, its
  health bar, then the banner and its defeat flag). Each field says what its id is.
- **Free ids:** Spellforge picks event ids in the script's own block and flags nothing in the game uses, in blocks the
  game keeps flags in; New flag gives one any time. Each event is started from its script's event 0.
- **Test marker:** any event can give a Rowa Fruit (item lot 997200) when it starts, the community's way of seeing an
  event run. Take it off when you're done.
- Spellforge's events are written into the script on Save and taken out again when you delete them: the rest of the
  script stays as it is, and a script with nothing of yours left is the game's again, byte for byte.

## Enemies

The **Enemies** workspace lists every character with animations: over 400 enemies, bosses, NPCs and creatures, named
from the game's own text.

- **Each character's moves**, read from its own TAE and resolved through its behavior rows: which attacks, bullets and
  effects each move has, and which hand it's made with.
- **The viewer** plays a move on the character (its own model and textures, its parts, hitboxes, bullets and effects)
  or **on you**: the move fitted to the player's skeleton.
- **Make it a skill…** turns a move into one of your weapon's skills in one step: the motion fitted to you and written
  as a new animation file, a copy of a player skill's category retimed to the new motion, registered in the behaviour
  graph; the move's attacks copied for the player, its bullets and effects copied (scaled to you, if you like), every
  dummy poly moved onto your body or weapon, its sounds copied into the player's sound bank, and a new skill row set on
  the weapon. The character's SpEffects, voice and AI flags stay behind, and the dialog says why.
- **Make it… an attack** turns the move into one of the weapon's attacks instead (any R1 of its combo, R2, running,
  roll, backstep or guard counter, one- or two-handed), keeping the weapon's own combo, cancel and recovery timing; a
  long combo can be split into steps, one per press. **Back to its own** undoes it.
- **Bullet:** a bullet event can fire any other of the character's bullets instead, its whole chain copied.
- **Make it a spell…** turns a character's bullet into a copy of one of your spells that fires it, with its sounds.
- **Sounds:** the events a move plays, and everything they play, are copied between banks as the game's own banks hold
  them, and recorded so Update from game rebuilds the bank. A mod's sound banks are loaded by ModEngine 3 (ModEngine 2.1
  doesn't load them).

## The app

- **Pages:** Params & effects, Animations, Enemies, Events and Text.
- **Menus** as editors have them: File (save, play or reload in game, close the project), View (back and forward, windows and
  layouts, hover notes, Appearance), Tools (What is this ID?) and Help (the walkthrough, About).
- **Hover notes:** rest the pointer on a row, a field or a button for a second and a small note under it gives its full
  name (when the list cuts it short) and its tooltip; it goes when the pointer moves off. View > Hover notes turns
  them off.
- **Windows your way:** every page is made of panels you can drag to rearrange, stack as tabs, or split; pop any panel
  out into its own window (another monitor) and dock it back by dragging. Layouts are remembered; View resets them.
  **Back / Forward** (Alt+Left/Right, mouse buttons) returns to where you were.
- **The walkthrough** plays in its own window, with chapters; Fullscreen (F) and Keep on top. Shorter videos are listed
  under it.
- **Appearance:** nine themes (Roundtable, the default, then Glintstone, Ember, Erdtree, Frost, Blood, Scarlet Rot, Night
  and Grace light), any colour customisable, text size and density.
- **About** lists everyone whose work Spellforge uses or learned from ([CREDITS.md](../CREDITS.md)).

## Safety

- **Offline:** no network code anywhere. The window is sandboxed, can't navigate away from its own page and gets no
  permissions; the spellchecker (which downloads dictionaries) is off. Only `https://` links you click open, in your
  browser.
- **The game folder is never written to.** All writes go through one function that refuses any path outside the
  project folder or inside the game folder.
- **Nothing is written until you press Save to project** (Ctrl+S). Saving writes, into your `mod` folder, only what
  changed: `regulation.bin`, effect bundles (`sfx\sfxbnd_*.ffxbnd.dcx`), item text (`msg\engus\item*.msgbnd.dcx`), the
  player's animations and behaviour graph (`chr\c0000*.anibnd.dcx`, `chr\c0000.behbnd.dcx`), the behaviour script
  (`action\script\c0000.hks`), the player's sound bank (`sd\enus\cs_main.bnk`), and Spellforge's own records in
  `.spellforge\` (row and animation names, effect copies, sizes scaled to, movesets, motions, behaviours, sounds brought
  over).
- **Backups:** any file Save replaces is backed up to `.spellforge-backups\<time>\` beside the `mod` folder.
- **Crash journal:** unsaved changes are kept in Spellforge's settings folder (`recovery\`), never in the mod folder;
  saving clears them, and you can discard them.
- Smithbox's own project files (`mod\.smithbox`) are only read.

## Known limits

- **The effect preview is an approximation.** The lighting comes from the game's probes, but the renderer, shadows,
  materials and post-processing are Spellforge's. The brightness of effect colours relative to the scene is calibrated
  by eye, not read from the game's GPARAM files. Spot lights are drawn as point lights. Model particles' in-game shaders
  differ (Margit's golden weapons look paler).
- **Behaviour judges:** an animation names a behavior judge; the weapon or skill in use picks the variation at runtime.
  The event's judge line reads it for the weapon in the viewer's right hand; a behavior row lists every animation that
  fires its judge.
- **Animations:** other characters' animations are read only (watch them, or make them yours). Registering needs a
  behaviour selector for the animation's ID (every attack, skill and most moves have one); brand-new IDs would need new
  behaviour states. Saved binders use Kraken level 4 instead of the game's 6 (about 7% larger); the game reads both.
- **Enemy moves on the player:** the motion is fitted by bone names, which FromSoftware's humanoid rigs share;
  creatures without arms and legs have little to give a human body. Their sounds need ModEngine 3 (or a ModEngine 2
  build newer than 2.1).
- **Imported images** are packed by Spellforge's own quick BC7/BC4 encoder: faithful, not the best quality an offline
  compressor gets; a .dds you made yourself goes in as it is.
- **Not yet:** your own sounds (WAV to the game's WEM needs a Vorbis encoder Spellforge doesn't have) and new menu icons
  (the game keeps them in one big archive).
- **Casts as attacks** cost no FP and deal the spell bullet's own damage, without catalyst scaling.
- **The viewer's sounds** play at the listener: no distance, panning, filters or buses; floor and armour sounds play
  their default material.
- **Events:** Spellforge names the instructions it has worked out from the game's own scripts; the rest show as their
  numbers and are kept as they are. Recipes cover the common jobs; editing the game's own events line by line isn't
  supported.
- **Not yet:** brand-new attack slots and behaviour states, Havok variables, NPC dialogue (ESD), map parts (MSB) and
  enemy AI: each needs format work of its own first.
- **Not yet confirmed in game:** F5's reload (its byte patterns are checked against the installed game), the behaviour
  recipes (second heavy attacks included) and stances (a weapon held in a copied stance category of its own), moves
  taken for one grip only, Save and play in game, the direction effects turn with the
  move/rotate tool, the event recipes, and the sounds' levels against the game's.
