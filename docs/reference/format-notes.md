# Format and design notes

Facts about the game's files and how the game uses them, verified against
real files while building Spellforge, plus rules from FXR Playground's guides
(https://fxr-playground.pages.dev/guides) that the UI has to respect. The
format claims were checked against the game's own files; a fact settled by
in-game testing says so.

## Ground rules

- The unpacked game folder is read-only source data. Spellforge reads from the
  project's `mod/` folder first, then the game, and writes only into the
  project, through `Project.writeProjectFile`, which refuses anything else.
- An untouched file rewrites byte-identically. Only edited effects are
  re-serialised.

## Containers

- `regulation.bin`: AES-256-CBC (16-byte IV prepended) around DCX/ZSTD around
  a BND4 of 194 `.param` files. We write ZSTD the way Smithbox does (level 15,
  64 KB window, no content-size field): ~1 s per save instead of ~12 s at
  retail's level 21, and known to load in-game.
- `sfxbnd_*.ffxbnd.dcx`: DCX/KRAK (Oodle, via the game's own oo2core DLL)
  around a BND4. Payload alignment is mixed in retail files, so original
  offsets are preserved when nothing changed.
- DCX/KRAK seek chunks: the game unpacks a Kraken file one 256 KB chunk at
  a time, so every chunk must restart the decoder (Oodle's `seekChunkReset`
  with `seekChunkLen` 0x40000, at +8 and +12 of `OodleLZ_CompressOptions`).
  Every retail file is packed so: each block header's first byte is 0x8C,
  never 0x0C. Oodle's default leaves it off, and earlier Spellforge versions
  packed that way: a chunk that refers back can't be unpacked alone (Oodle
  returns 0), the game kept garbage for everything past the first 256 KB,
  and a test mod crashed at startup in its TAE loader, on a00.tae,
  whose bytes were retail's (0x150 into the anibnd's second chunk).
  `krakChunks` reads the block headers; a project holding such a file is
  told so on open and Save packs it again (`badlyPacked`, `repackDcx`).
  Our multi-chunk packing isn't byte-identical to retail's (FromSoft's
  Oodle build differs); one-chunk files still are.
- BND4 path-hash table is 8-byte aligned; hash is `h = h*37 + c` over the
  lower-cased, forward-slashed path with a leading `/`.

## Params

- Smithbox defs carry `FirstVersion`/`RemovedVersion`; filter by the
  regulation version (the BND4 version string, e.g. `11611000`).
- Smithbox meta files are named after the def, not the param
  (`AtkParam.xml` covers `AtkParam_Pc` and `AtkParam_Npc`).
- 39 refs are conditional, e.g. `BehaviorParam.refId` is an attack, bullet or
  SpEffect depending on `refType`.
- Player behaviors use `AtkParam_Pc`, NPC behaviors use `AtkParam_Npc`, even
  though the shared meta lists both.
- `BehaviorParam_PC` ids are `category * 1e8 + variation * 1000 + judgeId`.
  Category 1 is the weapon moveset, 3 is skills. The row also repeats its
  variation in `variationId`, which a clone must rewrite.
- Some skill behaviors are reached only from animation (TAE) events, not from
  any param. Spellforge can't see those links yet.
- Retail has duplicate row ids in `RandomAppearParam` and `PhantomParam`;
  compare rows by (id, occurrence).
- `ShopLineupParam`: `eventFlag_forRelease` ("Visibility") hides a row until
  that flag is set. Every unlimited (`sellQuantity -1`) Twin Maiden Husks row
  is gated by a Bell Bearing flag (Smithing Stone [1]: 11109751), so a copy
  of one must clear it. 463 retail rows are unlimited with
  `eventFlag_forStock 0` (the stock counter is only needed for limited stock).

## Effects (FXR)

- Effects live in `commoneffects`, `_dlc01` and `_dlc02` (searched in that
  order), plus per-map and per-character bundles. A project may add effects
  that exist only in its own bundles.
- The internal FXR id must match the `fNNNNNNNNN.fxr` file name, or the effect
  may never terminate.
- Each effect has a `.ffxreslist` listing textures (`sNNNNN_<type>.tif`) and
  models (`sNNNNN.sib`, followed by the model's own texture lines).
- `@cccode/fxr` ignores a typed array's `byteOffset`: always pass it a
  standalone `ArrayBuffer`.
- Final color is a product of several color properties. Recolor functions
  change only each action's *primary* color, so the UI shows effective color
  (`node.getColor()`), not raw property values.
- A bullet's effect (`sfxId_Bullet`) is drawn while the bullet flies, and
  emitters can spawn per distance moved ("one every 3 m it moves"): standing
  still, those never appear. Comet Azur's beam (526252) is mostly such
  nebula sprites; its bullet (10420002) flies at 50 m/s for 0.67 s, and the
  spell fires it over and over while channelling, so the beam is a stream
  of them. The preview starts a bullet's effect flying at that bullet's
  speed (`EffectView.flight`, the first moving bullet that carries it).
- A spell's look is several effects: Comet Azur is its cast orb (Magic
  `castSfxId` 526250), the core at the hands (526251 on 10420000, no
  speed), the opening swirl burst (526254 on 10420004), the beam bullets
  and their hits (526253). One effect file never looks like the whole
  spell.

## Sprite orientation (preview)

- OrientationMode: 1/6 face the camera; 0/2/3 face -Z (2 = the parent
  node's -Z, across a projectile's flight path); 5 faces +X; 4 GlobalYaw
  stands upright and turns to the camera.
- 7 LocalYaw: the sprite's width lies along its particle's direction of
  travel, and it rolls around that axis to face the camera. The FXR docs
  say "rotation around the parent's Y axis", which is ambiguous; the game
  files and in-game checks settle it.
  - Of the BillboardEx sprites with orientation 7, 468 are wide and 11
    tall: blood sprays, light rays, Glintstone Pebble's 1.5 m x 4 cm
    speed lines.
  - Read as upright bands instead, the pebble draws crossbars behind it,
    which in-game checks showed is wrong.
  - Torrent barrier 800 looked like a counter-example until node
    rotations were applied: its line node is turned 90 degrees, so its
    streaks run along the mist either way.
- Random values live in property modifiers (RandomRange min/max,
  RandomDelta +/-max, RandomFraction), which `valueAt` ignores. Rotations
  such as "rotationZ 360 + RandomRange(-360, 0)" are random rolls.
- `uniformScale` on a billboard means the width also sets the height (the
  height fields are ignored). Most glow sprites use it.
  `scaleVariationX/Y` multiplies each particle by a random factor between
  that value and 1.
- color1 and color2 are clamped to 0-1 by the game (lines clamp color3 too).
  color3, the ParticleModifier colour and rgbMultiplier carry the HDR
  brightness.
- Not every effect's +Z is forward. Item glows (e.g. 6303 / 6103) are
  authored with +Z up: every emitter is raised 0.22 on Z, and the sparkle
  box is 0.12 x 0.12 x 0.49. The preview guesses the effect's axis:
  - projectile if any emitter emits by distance or the node has speed;
  - otherwise upright when the offsets and box sizes run along Z.
  The Axis menu overrides the guess.
- Node transforms carry rotations as well as offsets: Torrent barrier 800
  turns its line node 90 degrees about Y so it lies along the mist. The
  preview applies them down the node tree and into proxied child effects
  (Euler degrees, X then Z then Y).
- Node motion is inherited by child nodes. The preview applies:
  - NodeSpeed/NodeAcceleration and their RandomTurns/PartialFollow/Spin
    variants: speedZ, accelerationZ, accelerationY;
  - NodeTranslation over time;
  - NodeSpin (the nearest spinning node; children orbit its origin);
  - RandomNodeTransform rotationVariance.
  Trails and distance emitters follow the node's own path. Effect 43, gold
  light converging on the dummy, is a good test.
- A spinning node turns around its current position, including the motion
  and translation it inherits. In effect 40 a parent bobs the glow to
  0.8-1.0 m and a tilted child spins below it; pivoting at the effect
  origin flung the glow around and upward.
- No retail effect enables GPU particleCollision (0 of 8,620); the bounce
  only matters for custom effects.
- Particle speed comes from ParticleSpeed and its RandomTurns and
  PartialFollow variants. maxTurnAngle and turnInterval give random turns.
- Model particles (RichModel/Model): RichModelOrientationMode 0/3 north,
  1 camera, 2 particle direction, 4 yaw; rotationX/Y/Z with angular
  speeds. Colours above 1 glow: "ShiningStone" crystals have no texture
  files and get their look from shaders.
- Screen effects write into a screen-sized buffer (RG = UV bend, BA = radial
  blur vector toward the sprite's centre), which one post pass applies.
  - Distortion intensity in the game files: normal-map mode median 10, up
    to 150; stir 0-20. The preview bends about 1% of the screen at 10,
    capped at 6%.
  - Radial blur radius: median 0.15, up to 0.5.
- Lens flares: layers sit at the source, or along the reflected
  source-to-centre line (Radial / Horizontal) with offset x variation. They
  are drawn at display brightness and are not occlusion-tested.
- WindForce volumes push particles that have ParticleForceSpeed or
  ParticleForceAcceleration (speed and acceleration x force).
- NodeAttachToCamera puts the node on the camera: effect +Z along the view,
  at least 0.5 m in front. Examples: screen zoom blur 645205, rain 806100.
- GPU particle systems (GPUStandard/Spark) use their own emission count and
  interval, emitter shape and size, lifetime, per-particle velocity range,
  acceleration, size growth and colour range. Sparks stretch along their
  velocity. Collisions and particle traces are not simulated.
- Flipbooks: the frame comes from frameIndex + frameIndexOffset over the
  particle's life (a random part of the offset gives each particle its own
  start frame), wrapping past totalFrames. interpolateFrames blends
  neighbouring frames. Endless particles loop the curve each second.
- MultiTextureBillboardEx layer UVs: uv x scale + offset, plus the
  integrated scroll speed. The mask layer (layer2) is centred: its offset
  is 0.5 in every retail effect, so the preview uses (uv - 0.5) x scale +
  offset. Masks stay clamped; scrolling colour layers repeat.
- Models scroll their texture by offsetU/V (RichModel also offsetUV) plus
  speedU/V x multiplier.
- GPU particleCollision bounces off the preview ground (particleBounciness;
  80% of the sideways speed kept).
- Lens flares fade over opacityTransitionDuration when the source is below
  the ground. Each flare fades as the screen centre leaves a sphere of
  attenuationRadius / |offset| around the source.
- Emitter shapes have an InitialDirection: 0 depends on the shape (point,
  disk and rect: +Z; box: out of a face, or along a random axis with
  emitInside; sphere and cylinder: outward), 1/4 up, 2/5 down, 3/6 +Z.
- `ParticleAttributes.attachment` 1 means the particles ride along with the
  node. Tracers are ribbons of segments, and the texture's width (U) runs
  along the trail.

## Recoloring pitfalls (from the FXR Playground recolor guide)

- Blend modes 0, 4 and 7 are additive: recoloring to black makes the effect
  invisible. Warn, and offer blend mode 2. Additive effects often use
  black/white textures that won't look right after that switch either.
- Models are tinted by their material and textures (Carian weapons always
  look blue). FXR colors may barely change a `RichModel` or `Model`; say so.
- Proxied child effects are separate files and are not recolored with the
  parent. Offer "include child effects", and clone the children when the
  originals are shared.

## Text (FMG)

- `msg/engus/item*.msgbnd.dcx` hold FMG v2 tables (WeaponName, GoodsName,
  ProtectorName, AccessoryName, GemName, MagicName, ArtsName, each with
  `_dlc01`/`_dlc02` variants). `item_dlc02` is a superset of the others.
- Spells are named in **GoodsName** (the EquipParamGoods row of the same
  id). MagicName, MagicInfo and MagicCaption are empty for all 317 Magic rows
  in 1.17.1 and the game doesn't show them.
- FMG v2: groups of consecutive ids, i64 string offsets, UTF-16 strings,
  duplicates stored separately, file padded to 4 bytes. All 78 tables
  rewrite byte-identically.

## Textures (TPF)

- PC TPF: 0x10 header, 0x14-byte entries, UTF-16 names, DDS files back to
  back with no padding. All 452 effect TPFs rewrite byte-identically.
- Effect and part textures only use BC1 (format code 0), BC4 (103) and
  BC7 (102). Effect bundle entry ids are banded: fxr 0+, tpf 100000+,
  flver 200000+, anibnd 300000+, ffxreslist 400000+.

## Lighting (light probes)

- `other/modelviewer_default_rem.dds` / `_iem.dds`: FromSoftware's model
  viewer environment, legacy DDS FourCC 113 (RGBA16F) cubemaps, 128 px.
- Each map folder has `<map>_envmap_<tt>_<high|middle|low>_00.tpfbnd.dcx`.
  The bundle holds `GILM####_<tt>_rem.tpf` reflection probes: BC6H_UF16
  (DXGI 95) cubemaps, 128 px, 5 mips. Each face's whole mip chain comes
  before the next face. There are also GIIV volume textures (BC7) for
  indirect light.
- `<tt>` is the time of day, judged from the probes: 00 morning, 01 day,
  02 afternoon, 03 dusk, 04-06 night. Underground areas (m12) and Farum
  Azula only have 00.
- Open-world tiles have 1 probe; legacy dungeons have about 100, one per
  spot. Probe 0 is usually an overview of the area.
- Mean probe luminance: Limgrave by day is about 0.05, night 0.009, Siofra
  0.002. FXR colours are far brighter (fire cores 20-90, flashes up to 600,
  lit smoke ~5). The preview maps FXR to scene units with x0.05.
- The BC6H decoder (`src/core/formats/bc6h.ts`) is ported from bcdec (MIT). It was
  checked on the game's environment maps: mips agree and there is no block
  noise.

## Models (FLVER2)

- Version 0x2001A. Static meshes store vertices relative to their default
  bone: apply scale, rotate X then Z then Y, translate, then the parent
  chain. Without that, 40 of 331 effect meshes sit outside the file's own
  bounding box; with it, 3 (all multi-bone, within ~0.3 m).
- Material texture paths use backslashes (`N:\...\s88072_a.tif`).
- A static mesh can mix bones vertex by vertex: the normal's W holds the
  vertex's bone (an index into the FLVER's bones). The Uchigatana's blade
  mesh (default bone Sword) carries 286 vertices of the scabbard's shell on
  the Case bone, which its weapon clip a999_000000 scales to 0 while the
  blade is drawn. 32 of 497 weapon models mix bones like this.
- Weapon parts files hold up to 4 models: WP_A_0550.flver is model 0 (the
  weapon), WP_A_0550_1.flver model 1 (its scabbard, or the other of a pair),
  each with its own .anibnd. 79 of 497 weapons have a model 1.
- `WepAbsorpPosParam` (EquipParamWeapon.absorpParamId) places each model:
  for each slot `right_N`, `left_N`, `both_N`, `rightHang_N`, `leftHang_N`
  are body dummy polys (c0000), with 2000 added for the hip points: the
  Uchigatana's model 1 hangs at 2069 (body dummy 69) while drawn, a
  longsword's at 2030. A model sits exactly on its dummy's frame: the frame
  of hand dummy 20 equals the R_Weapon bone with the weapon flip (measured
  to a few millimetres), and likewise 21 for the left hand.

## Game updates (1.16.1 → 1.17.1)

- The update changed 40 player animations (TAE) and no existing
  commoneffects FXR, and added 19 FXRs (451600–451625, 451700–451701) that
  no param row references. A project keeps its own copies of these files, so
  without its version's vanilla files to compare with, the 40 show as the
  project's edits; and in game the project's older copies replace the newer
  ones whole.
- Params: 934 rows changed and 423 added between the two. Retail
  PhantomParam isn't sorted by id (910 before 800); merges keep the game's
  order.
- Text: 264 entries newer in 11 of the Bloody Scythe project's tables.
- Updating a project (core/params/upgrade.ts) starts from the new game's
  regulation and puts the project's own changes (against its version's
  vanilla rows) back field by field; verified on all 20.8 million fields of
  a large mod project.

## Animations (TAE)

- Effect slots: a character holds one effect per slot (an effect event's
  SlotID >= 0), so two effects an animation spawns at once into one slot
  show as one in game: the Sacred Arsenal's second golden sword, a
  duplicate of the first event (slot 11), never showed in game,
  though the viewer drew both. The viewer now ends the earlier
  one when another takes its slot (which of two simultaneous spawns stays
  isn't known; the later event in the list does), and the SlotID line names
  the clash and the next free slot. The game's player animations use 0-7,
  10-23, 26 and 27 (6,229 effect events have none).

- 64-bit TAE, version 0x1000C/D. Behavior-firing events, per DSAS's ER
  template: 1 AttackBehavior (judge at +8), 2 BulletBehavior (dummy poly
  +0, judge +8), 5 CommonBehavior (+4), 307 PCBehavior (+8).
- A judge's thousands digit is the BehaviorParam_PC category: judge 3570
  fires `3e8 + variation*1000 + 570`. Moveset judges are plain (< 1000,
  category 1). Retail: every 3000-7000s judge matches its category; 514 of
  528 sub-1000 judges match category 1.
- Full read/write (`src/core/formats/taeFile.ts`) round-trips all 639 retail player
  TAEs byte-identically. Layout, in write order: header and names (kept
  verbatim), animation table `{u64 id, u64 header}`, animation groups (runs
  of consecutive ids), 0x30-byte animation headers, then per animation: the
  file block, times (unique floats), event headers (0x18), event data
  `{type, unk, params ptr}` + params, group headers, group blocks (16 data
  bytes + **u32** event-header pointers). Everything pads to 16.
- A TAE's id (2000 + category) is stored **three times**: 0x50, 0x90 and
  0x94 (all 642 retail player TAEs, and other characters', agree). New
  categories copy another's header; earlier Spellforge versions rewrote only
  0x50, so a270 kept a033's 2033 at 0x90/0x94 and a626-a629 all kept
  2600. The writer now sets all three; a project saved before is repaired
  when it opens (`AnimationBinder.fixHeaderIds`, a notice, written on the
  next save). This was first blamed for a test mod's startup crash,
  wrongly: the crash repeated with the ids fixed, at the same place, and was
  the packing (see Containers, DCX/KRAK seek chunks). Whether the game
  minds mismatched ids is untested.
- How the game loads a TAE (eldenring.exe+0x265114c, from the crash): it
  turns offsets into pointers in place. Per animation table entry it sets a
  flag byte at header+0x22, reads the event count as a **u16** at +0x20,
  and for each event header replaces the start and end offsets with the
  time floats they point at (low 4 bytes) and the data offset with a
  pointer; each group header gets a flag byte at +2 and the file's base
  address written at +0x18.
- An event's parameters run to the next block. DSAS's sizes are wrong for
  some ER types: Blend (16) stores none, EnableTwistModifier (700) is 40 not
  52, type 17 (not in the template) is 16.
- Every event belongs to exactly one group (594k events checked); groups can
  be empty. A group's data is `{i32 type, 12 zero bytes}`, usually the type
  of its events. New events join a group of the type their siblings use.
- Event ends of FLT_MAX mean "until the animation ends".
- The category comes from the binder entry (`a53.tae` / `a129.tae`, id
  5000000 + category); the TAE's own id is 2000 + category in retail but a
  DSAS-made `a228.tae` kept id 2050 and works.
- Motion references: `{type 0, a 0, b -1}` own motion (`aXXX_YYYYYY.hkt`);
  `{type 0, a 256, b category*1e6+id}` another animation's motion (name =
  that .hkt) with its own events; `{type 1, a full id}` everything from
  another animation. DSAS's "copy category" (a70 in Frosty ThrowDagger) is
  the second kind for every animation.
- For type 0, `a` is flags byte by byte: bit 0 loops by default (a035_033260
  has a = 1), bit 8 imports the motion of `b` (a = 257 does both; a = 256
  with b = -1 imports nothing). Across 15,190 retail animations: 9,327 own
  (a 0, b -1), 4,224 motion references (a 256), 1,329 type 1, the rest the
  odd combinations above. c and d are always 0.
- In 70,870 of 435,630 retail event groups the events are of several types
  (16%): groups aren't one per type, so lanes are laid out by type and the
  groups kept as stored.
- The TAE header (the bytes before the animation table): version 0x1000D at
  8, file size at 0xC, eight flag bytes at 0x40 (`01 00 01 02 02 01 01 01` in
  the player's), the TAE id at 0x50 (2050 for a050), and at 0xA8 a pointer
  to two pointers: the skeleton name (`skeleton.hkt`) and the SIB name
  (`c9990.SIB`), UTF-16.
- Moving an animation (F3) or a category (Shift+F2) to a new number keeps
  its motion: an own motion becomes a reference to the old name, whose .hkx
  stays in the binders (the game finds motion files by animation id). Type 1
  references from other categories to a moved category follow it.
- ChrActionFlag (type 0) FlagType says which input may cancel the animation
  from the event's start: 4 Cancel RH Attack and 115 R1, 116 R2, 117 L1,
  118 L2, 26 dodge, 104/103 skill, 34 generic, 11 movement. The combo
  viewer cuts each animation at the first window of the input that goes on.
- Events the viewer acts out besides attacks and effects: AnimSpeedGradient
  (608, SpeedAtStart → SpeedAtEnd scales playback), SetOpacityKeyframe (193),
  HideEquippedWeapon (710: hands and scabbards), Show/HideModelMask
  (713/711), and AddSpEffect (66/67): a SpEffect's own visual is its
  SpEffectVfxParam `midstSfxId` at `midstDmyId`. Sound events (128, 129,
  132–134) carry SoundType, SoundID and a DummyPolyID.

## Behaviour graph (c0000.behbnd → Behaviors\c0000.hkx)

- Havok 2018 tagfile (TAG0, SDK 20180100): SDKV, DATA, TYPE (TPTR, TSTR,
  TNA1, FSTR, TBDY, THSH, TPAD), INDX (ITEM, PTCH). Section headers are
  big-endian `u32 size | 0x40000000 flags` + tag. `src/core/formats/havok/tagfile.ts`
  reads types and items and writes the TYPE section back verbatim; the
  15.5 MB retail graph (122,315 items) round-trips byte-identically.
- TBDY packed ints: `0xxxxxxx` 1 byte, `10` 2, `110` 3, `11100` 4,
  `11101` 5, `11111` 8. hkPropertyId has 2 extra bytes before its member
  count.
- References are u32 item indices (arrays: 16 bytes, index first); null
  references have no PTCH entry. Item flags: objects 0x10, arrays and
  strings 0x20; strings are char arrays counted with their terminator.
- Animations play through CustomManualSelectorGenerators (4,049): `animId`
  selects the move, `generators` holds one hkbClipGenerator per category
  that can play it. Registering (as ERClipGeneratorTool does) adds a clip to
  every selector with the animation's id: a copy of the selector's first
  clip, named after the animation, `animationInternalId` shared per
  animation name or the next free one. Same clips as ERClipGeneratorTool in
  every selector on Bloody Scythe, Friede's Scythe and Frosty ThrowDagger;
  internal ids identical on the first two (Frosty's differ by numbering
  order only).
- ERClipGeneratorTool's `IgnoredAnimationNames` are retail animations the
  game deliberately leaves out of the graph; Spellforge only offers to
  register animations the project added, so it never touches those.

## Writing animations (HKX, hkaSplineCompressedAnimation)

- Player animation files live in `chr/c0000_aXX.anibnd.dcx` division
  binders; skills (a6xx-a8xx) are in `c0000_a9x` (2,510 entries). Entries:
  `N:\GR\data\INTERROOT_win64\chr\c0000\hkx\a9x_compendium\aCCC_IIIIII.hkx`,
  id `1,000,000,000 + category * 1,000,000 + id`. Each file's types are the
  binder's `.compendium` (TCRF in the file, TCM0 in the binder). Modders add
  new files to these binders (merge guides on Nexus); the game finds them by
  name. c0000.anibnd's `txt/c0000_aXX.txt` entries name the divisions.
- Every retail player animation: 16-bit positions and scales, THREECOMP40
  rotations (quantization byte 0x45), 256 frames per block (blocks share
  their edge frame), no float tracks, no annotation tracks. Degree 1 and 3
  splines both occur (degree 1: 4,499 of 5,896 rotation splines sampled).
- Block layout (`src/core/formats/havok/splineBlock.ts`): masks (4 bytes per track),
  align 4; per track position, align 4, rotation (aligned to its
  quantization: 1 for THREECOMP40), align 4, scale, align 4. Spline header:
  u16 control points - 1, u8 degree, u8 knots (frames); positions then align
  4 and a min/max float per spline axis. `floatBlockOffsets` count from the
  block's start; blocks are padded to 16. Rotation flags: Havok sets the
  bits of the components that vary (0xf0, 0xa0, 0x90...); any bit in the high
  nibble means spline, low nibble static.
- Checked on 502 retail files (player a9x and Margit's): DATA rebuilt with
  nothing changed is byte-identical (items in offset order, arrays at 16
  except text, objects at their type's alignment, DATA padded to 16); every
  block written again from its stored values is byte-identical; every
  THREECOMP40 value packs back to the same 40 bits except exact ties between
  two largest components (359 of 1.7 M), which Havok broke either way.
- A new animation is a copy of a retail file of the same binder (its
  compendium) with the spline object's counts, durations and arrays
  replaced: `blockOffsets`, `floatBlockOffsets`, `data`, the binding's
  `transformTrackToBoneIndices` and the reference frame's samples (one per
  frame: x, y, z, yaw). TAE entry for its own motion:
  `{type 0, name "a626_040000.hkt", a 0, b -1}`, as retail.

## Other characters (chr/cXXXX)

- `cXXXX.anibnd`: Skeleton.hkx and the TAE (ids include the category:
  2003027 is a002_003027), plus `blf` files with the division regexes;
  motions in `cXXXX_divNN.anibnd` (own compendium each). `cXXXX.chrbnd`:
  the model (Margit: 714 FLVER bones, 218 dummies, 32 meshes), textures in
  `cXXXX_h.texbnd`. Mesh parts toggle by mask group, `#NN#` in the material
  name (Margit's hammer is #08#; NpcParam `modelDispMask0-31` are the
  defaults, ShowModelMask events show parts while they run).
- Textures: ER FLVERs leave material texture paths empty; each material's
  MATBIN (by its mtd path, in `material/allmaterial*.matbinbnd`) lists its
  samplers (`…AlbedoMap_0` = …\c2130_bd_body_a.tif). Taking the part's
  first `_a` texture for every mesh is right for armour (one set per
  piece) and was Margit as a patchwork: his body, face, hair, cloak and
  cane each have their own.
- NPC rows name their model by id convention: NpcParam 21300000+ is c2130.
  In-game names: NpcName text by `nameId`. Behaviors:
  `BehaviorParam 200,000,000 + behaviorVariationId * 1000 + judge`
  (Margit, variation 21300: 221300770 -> AtkParam_Npc 2130770).
- Enemy damage is flat (`atkPhys`, `atkDark`... "NPCs only" per Paramdex);
  player attacks multiply weapon damage (`atk*Correction`, "PC only").
  Player Ash of War projectiles carry flat damage with `isAddBaseAtk` 1
  (Blade of Gold: atkDark 145), so a player copy of an enemy attack sets it.
  AtkParam_Pc and AtkParam_Npc share a layout.
- Push (`knockbackDist`, metres; NpcParam `knockbackRate` cuts it): an
  enemy's attacks are tuned for hitting the player, up to 20 m (Margit's
  hammer leap and its shockwave, with damage level 10, "Huge Launch
  Back"). As the player's they slid bosses across the arena (seen in
  game). The game's own skills ([AOW] rows of
  AtkParam_Pc) push 2 m or less in all but 26 of 2,200 (Golden Slam: 0.5 m
  with the hammer, 1.2 and 2 m with its shockwave; Lion's Claw 0.95 m;
  Giant Hunt 3 m; Serpent-Hunter's 13 m is the one far outlier), so a
  player copy pushes 2 m at most (`fitAttackForPlayer`, `PLAYER_KNOCKBACK`;
  pulls the same). Damage levels are left as the enemy's.
- A bullet names its attack by id in both tables (`atkId_Bullet`: the
  player's bullets read AtkParam_Pc, enemies' AtkParam_Npc), and the game
  pairs them by id (AtkParam_Pc 1 and AtkParam_Npc 1 are both "no target").
  So a player copy of an enemy attack takes the enemy's id when the
  player's table has none there, else an id free in both: Margit's hammer
  leap made a skill twice, the second copy of his hammer hit took 2130771,
  his shockwave's attack id, and when the second skill's shockwave was
  copied, the clone took that player row as the shockwave's attack: it hit
  with the hammer's (dark 300 and its SpEffect, not physical 300).
  `audit-mod.ts` checks every bullet the project made from an enemy's.
- Rigs: FromSoftware humanoids share bone names (Margit and the player: 95)
  and axis conventions; rest poses differ (his bent knees, stoop). The
  player's Master yaw turns the upper body (RootPos undoes it below the
  waist); Margit's Master turns all of him, and moves: part of his leap's
  rise is in Master, not root motion. Margit stands 0.42 m off his origin at
  rest. Scale by leg length (0.468 player/Margit), not pelvis height (his
  knees are bent at rest).
- Fitting: each matched bone takes the source's world rotation (rest
  difference over 100 degrees: relative to rest instead); the player's
  Master stays at rest; RootPos follows the source's Root in model space
  (less its first-frame sideways offset), scaled. Feet stay within 2 cm of
  Margit's (scaled) through the whole leap; his 11.1 m leap carries the
  player 5.2 m.
- Skills: animation category 600 + swordArtsTypeNew; Lion's Claw (skill
  100, a600) has one motion (040000) and 040005 borrowing it; Gold Breaker
  (a829) is two-stage (040000 leap, 040004 landing): a one-motion base is
  needed. Skill behaviors are judges 3000-3999: BehaviorParam_PC
  `300,000,000 + weapon variation * 1000 + judge % 1000`. Lion's Claw's
  bookkeeping events (FP use 330, cancels 300/ChrActionFlag, poise, turn
  speed) are retimed to the new motion: first and last hit onto the move's
  first and last hit, end onto its end.
- A leap needs its motion flags: ChrActionFlag 27 (gravity off), 51 (no fall
  motion), 113 (height correction), 132/134 (jump frames), 39, 28. The
  enemy's AI flags (23, 78, 79, 86) don't come along.
- Voices: a character's own sounds (TAE sound type 1, c events) numbered
  08000-08999 within its id are its voice (c475008300, Godrick's battle
  cry; c213008001, Margit's grunt). Every character checked numbers them
  so; Margit's, Godrick's, c3000's and c4800's banks route exactly those to a
  bus of their own ("Voice", 3170124113, or 3965536909), the rest to their
  common bus ("Enemy", 2299321487; c4800's is another). Other characters
  send their voice through the common bus, so the number is the rule, not
  the bus. A move made the player's leaves the voice behind (Godrick
  grunted from a player's sword in game); Stays behind
  says so.
- Held effects: an effect spawned at a dummy on something the character
  holds (Margit's hammer, dagger, sword, spear: a bone under his hand) is
  drawn around his dummy, his grip `handle` away. On a weapon dummy it sat
  that far from the player's grip: his spear 2.6 m behind the hand, his
  hammer 0.6 m, his dagger 0.3 m (in-game screenshots; the viewer showed
  the same). Making the move now gives each such effect, per weapon point,
  a copy moved so his grip is the weapon's: by grip - size x handle (the
  copy at "Your size" is scaled about its own origin), recorded in
  scales.json as fitted (handle at his size, `effects` its size), so Scale
  scales it about the grip and doesn't move it again (Scale's own fit
  assumes the effect was scaled about the grip, which an origin-scaled copy
  wasn't; copies Scale makes keep fitted and handle). It isn't turned: his
  dagger runs 12 degrees off the blade, his hammer 22 (single turns about
  the dummy's Y). @cccode/fxr documents node rotations as Z, then X, then Y;
  the preview applies X, then Z, then Y; they agree on a single axis, but
  the game's turning sign isn't confirmed (one check, Torrent barrier 800's
  90 degrees, can't tell), and a wrong sign would double the tilt.
- Weapon points along the blade: his dummies on a held thing go to the
  weapon dummy at the same fraction of its length, the weapon's measured
  along the blade (toward its farthest dummy), not as a distance: the
  dagger's 122 sits 0.12 m behind the grip, on the pommel side, and had got
  his dagger (and its hits). His side stays a distance from the hand: a
  hammer head's dummies spread across the head, all at its end.
- A combo split into steps: an enemy combo made one R1 played on one press
  and couldn't be stopped (Margit's sword combo, 7 hits in 5.7 s:
  locked into the combo). Make it an attack can cut it (`steps`) into the
  weapon's R1 1st, 2nd, 3rd..., each part's motion (its root motion re-based
  where the part starts, turned as the combo viewer chains them), its events
  from its start (an effect held through a cut is spawned again), the
  weapon's own step's windows retimed to it, each recorded with its own
  judges. The plan suggests a cut mid-way through each pause of 0.5 s or more
  between hits (0.77 and 2.17 s for the sword combo: 1, 4 and 2 hits).
  The game counts one combo length per weapon whatever the grip
  (IsEnableNextAttack calls GetAttackMaxNumber(hand)): a comboLength recipe
  can be for one grip (`grip`: c_Style HAND_RIGHT_BOTH/HAND_LEFT_BOTH is
  two-handed), so the Sacred Arsenal has 2 one-handed, 3 two-handed.

## Sound banks (Wwise, sd/)

- A sound plays on the player only from a bank loaded with the player
  (cs_main, cs_smain): a character's own (cs_c2130) loads near it. An
  animation event's SoundID says where its sound is (SoundService.place: the
  character is the id's first four digits); "Bring into your bank" copies
  one into the project's cs_main (bringSound), as making a skill does. The
  DS Anim Studio way stays: copy sound events between animations on the
  timeline, or type an id; sound bars show their SoundID.

- Elden Ring uses Wwise 2019.2: banks are version 135. They're in their own
  archives, `sd/sd.bhd/.bdt` and `sd/sd_dlc02` (keys as for the data
  archives), by paths below sd/: `/enus/cs_main.bnk`, `/cs_smain.bnk`,
  `/init.bnk`, streamed audio `/wem/<first two digits>/<id>.wem`. Spellforge
  reads them as `sd/...` (gameFiles.ts).
- Banks: `init.bnk` (buses, states), `enus/cs_main.bnk` (75 MB: the player's
  and common sounds, always loaded), `cs_smain.bnk` (music, system),
  `cs_cXXXX.bnk` per character (Margit's is `enus/cs_c2130.bnk`, 4.5 MB),
  loaded with it; NpcParam `SoundBankId`/`SoundAddBankId` name shared banks
  (4190 for 327 rows), -1 means the model's own. `vcXXX.bnk`: voices.
- TAE sound events (128-134; 129 Wwise_PlaySound_BySlot is the usual one:
  sound type, id, dummy poly, slot, and a second sound at 20/24, and
  SoundIDOffsetType at 28: 2 adds the weapon's seIdOffset, -1 nothing) post
  `Play_<letter><id, 9 digits>`, the letter by sound type (1: c, 5: s, ...;
  the player's floor and armour sounds, 8 and 15, are c events with the
  material in the last two digits). A bullet's `seId_Bullet1/2`, `seId_Hit`
  and `seId_Flick` are s events. The event id is the 32-bit FNV-1 of the
  lower-case name. Margit's hammer leap: 25 sound events, 15 of his own
  events (in cs_c2130) and 4 common ones (c0998xxxxx, c0999xxxxx, already in
  cs_main).
- Layout (from wwiser, bnnm/wwiser): sections BKHD (20 bytes, then zeros so
  DATA's contents start 16-aligned in the file), DIDX (id, offset, size;
  sorted by id, 16-aligned in DATA), DATA, HIRC (count, then u8 type, u32
  size, u32 id, body), STID. Nodes (sound, random/switch/layer containers,
  actor-mixers) start with NodeBaseParams: effects, bus, parent, props
  (0x46 AttenuationID), positioning, aux (4 sends when set, then the
  reflections bus), 6 bytes of limits, states (state groups name State
  objects), RTPCs (type 2: a modulator object); containers then list their
  children. Every object of all 217 game banks reads to its exact size, and
  every bank writes back byte for byte (the `wwise` suite).
- Order in every bank: attenuations first, then the sound tree bottom-up
  (a child before its parent), each event's actions just before it. Wwise
  shares an object id between banks (the first loaded keeps it), so a copy
  of an object is the same object: copies go in unchanged.
- Bringing events over (copyEvents): the event, its actions, the nodes they
  play and all their descendants (children found through each node's
  parent, as containers can list fewer), the ancestors (for bus, volume,
  positioning), attenuations, effects, states and modulators, and the
  embedded media. Placed as the game's banks hold things: a copied branch
  under a node the bank has goes just before it, and that actor-mixer lists
  it (children lists are sorted by id in every game bank: 6,368 of 6,368 in
  cs_main); copied actor-mixers list only children the bank has; copied
  Play actions name this bank (their last u32); attenuations, effects and
  parentless branches first, events with their actions last. The hammer
  leap and the spear: 17 events, 108 objects, 31 sounds (608 KB).
- The first way (earlier Spellforge versions) put every new node first, left the
  parents' lists alone (Margit's actor-mixer listing 53 children, 14 there;
  27 of Godrick's nodes under a cs_main actor-mixer that didn't list them)
  and kept Play actions naming cs_c2130 / cs_c4750. In game the whole
  cs_main went silent (menus, the player; world and bosses fine) and came
  back with the file removed (seen in game). Which of the three the
  game minds isn't known; the copy now matches the community's working
  method (ndahn/er_soundbank_helper: trims copied parents' lists, adds the
  branch to the first existing parent, inserts before it) and the game's
  banks. A project bank built the first way is found by its Play actions
  (`namesOtherBanks`) and built again on open (`repairPlayerBank`: the
  game's bank plus the recorded events). Heard working in game.
- Not the cause, checked: the bank's size (77 MB; a modder's note puts
  cs_main's limit near 110 MB), its header (BKHDs of 20 to 32 bytes are all
  in the game), the media index, encryption (every sd archive entry has AES
  ranges, but me3 opens an override with AkOpenMode::Read), and the DLC
  archive (sd_dlc02 has no cs_main).
- FromSoftware's own index, `sound/soundbanksinfo.mobnkinfo` ("SBI", read by
  MOSoundBankInfoAccessor): two sections of {bank id, u32 count, u64 offset}
  entries; cs_main's list is {event id, flag} pairs (10,544 values, 5,272
  events). Copied events stay listed under their own character's bank there;
  the community's tools don't change it either.
- Two of Godrick's and Margit's sounds name embedded media no game bank has
  (571612846, 346985086): silent in the game too.
- Loading a mod's banks: the game reads sd/ through Wwise's file hook
  (FromSoftware's "EBL" open mode), not the path ModEngine 2.1.0 hooks;
  ModEngine 2 added a hook after that release (2023-09), ModEngine 3 (me3)
  has one (`mod/sd/...`, `mod/sd/enus/...`, `wem/XX/` too).

## Menu icons (menu/hi)

- `menu/hi/01_common.sblytbnd.dcx` holds the atlas layouts (TexturePacker
  XML, one `.layout` per sheet: sprite name, x, y, width, height);
  `menu/hi/01_common.tpf.dcx` the atlases themselves (BC7, 204 MB unpacked).
  Item icons are `MENU_ItemIcon_<id, 5 digits>` (160×160) on the
  `SB_Icon_*` sheets, status icons `MENU_StatusIcon_<id>` on `SB_Status_*`,
  map icons `MENU_MAP_<id, 2 digits>` (or named: `MENU_MAP_01_Bonfire`) on
  `SB_MapCursor*`. Smithbox's `IconConfig` meta says which kind a field is.
- Only the icon's blocks are decoded (decodeRegion), and each icon is
  cached on disk by the atlas file's fingerprint. Nearly every weapon icon
  id resolves (3,532 of 3,536). Some ids the game uses have no sprite of
  their own: a blocked grace's map icon (2, on 420 graces) is drawn from the
  grace's, so a missing picture is only pointed out for values the game
  itself doesn't use there.

## Event flags, event scripts (EMEVD) and talk scripts (ESD)

- A flag's number says its map: 10 digits `10XXYY` + 4 → m60_XX_YY's flag
  (`20` → m61, the Realm of Shadow); 8 digits `AABB` + 4 → mAA_BB.
  `event/eventflag/*.eventflagalloclist.dcx` are the maps' allocation lists
  (CSV).
- EMEVD (64-bit, version 0xCD): header 0x90; events 0x30 (id, instruction
  count and offset, parameter count and offset, rest behavior); instructions
  0x20 (bank, id, args length and offset, layer); parameters 0x20
  (instruction index, target byte, source byte, byte count: a common event
  called with 2000[0] (same file) or 2000[6] (common_func) receives the
  caller's args from byte 8 on, substituted here up to 4 calls deep).
- Flag instructions, found by matching args against flags params use: 3[0]
  and 3[1] check a flag / a range; 1003[0] waits for one; 1003[1..4],
  1003[101], 1003[103] skip, end or go to by one flag or a range; 2003[66]
  and 2003[69] set one; 2003[22] sets a range; 2003[63] sets one of a range
  at random. The flag type byte 0 means an event flag. Context: 2003[4]
  awards an item lot, 2003[11] shows a boss health bar (NpcName id at byte
  12).
- Talk scripts (`script/talk/mXX_YY_00_00.talkesdbnd.dcx`, `t<id>.esd`;
  m60/m61's binders serve the whole open world, m00's every map) are ESD
  "fsSL" (long format): header 0x6C, group/state/condition counts at
  0x28/0x30/0x38, data from 0x6C (groups at data+0x18); groups 0x20, states
  0x48, conditions 0x38, commands 0x18, args 0x10. Expressions are
  bytecode: 0x00-0x7F push byte - 64, 0x82 push i32, 0x84-0x8A call (the
  function id pushed first), 0xA5 a UTF-16 string, 0xA1 end. Function 15 is
  GetEventFlag(flag); command 1:11 is SetEventFlag(flag, state).
- All 589 event files and 365 talk scripts index in ~0.3 s. Every one of the
  15,613 flags params and scripts use gets a summary; 1,197 are explained by
  dialogue alone.
- Shops: a talk script opens a shop with command 1:22 (OpenRegularShop) and
  two constant ShopLineupParam ids, and the shop lists only the rows between
  them (`esdShopRanges`). The Twin Maiden Husks: 101800-101897 (4 free rows
  in 1.17.1); 101898-101949 is Enia's remembrance exchange (1:111, another
  menu); Merchant Kale at the Church of Elleh: 100500-100524 (7 free). The
  Husks' talk also opens every merchant's range (their bell bearings), so
  the shop's own merchant is named first. Row names don't tell: rows past
  101897 are named "[Twin Maiden Husks]" too. A test mod's Copy row
  once gave 3 of its 7 shop rows ids no shop lists (101949 in Enia's menu,
  101963, 101964) and the audit said "on sale"; now a shop row says who
  sells it, Copy row offers the first free row of the same shop (or says
  it's full), and `audit-mod.ts` flags a row in no regular shop.

## Maps (MSB)

- `map/mapstudio/*.msb.dcx`, 1,347 files (each open-world tile at three
  sizes, `_00` `_01` `_02`, plus `_99` versions), version 73 (74 in the
  DLC's, same layout for what's read). Six lists chained from 0x10:
  MODEL_PARAM_ST, EVENT_PARAM_ST, POINT_PARAM_ST (regions), ROUTE_PARAM_ST,
  LAYER_PARAM_ST, PARTS_PARAM_ST; each: version, count (entries + 1), name
  offset, entry offsets, next list.
- A part: name offset @0, type @0xC (0 map piece, 2 character, 4 player
  start, 5 collision, 9 dummy asset, 10 dummy character, 11 connect
  collision, 13 asset), model index @0x14, entity struct offset @0x60
  (entity id first, 8 entity groups at 0x1C), type data offset @0x68
  (characters: NpcThinkParam +8, NpcParam +0xC, talk script +0x10). A
  region: type @8 (1 invasion point, 5 effect, 8 spawn point, 9 message, -1
  a plain area...), base struct offset @0x50 (entity id at +4). Offsets in
  an entry count from its start. Found on the game's maps (Godrick's
  c4750_9000 is entity 10000800 with NpcParam 47500014; Kale's c3200_9000
  has talk 800006000) and checked against a raw scan: every talk id in the
  maps' bytes is read but one, which a DLC region holds.
- All maps read in under a second (in the background after a project
  opens, ~30 ms at a time): 23,031 entity ids. A character's name comes from
  its NpcParam's `nameId` (NpcName text; 0 is a placeholder, "DLC dummy",
  that most enemies have) or its row name. Some talk scripts no map places
  (most nomadic merchants'): nothing names those but the community lists.

## Scaling skills and spells (Scale…)

- What a skill owns: the animations of its category (600 +
  `swordArtsTypeNew`), the effects their events spawn, and the skill
  behaviors (judges 3000-3999) their attack and bullet events fire, as the
  weapons that have it look them up (their variation, then its hundreds,
  then 0, as the game does); moveset judges (below 1000) and common ones
  belong to the weapons and stay. Every variation's rows only for a skill
  an Ash of War gives (it goes on any weapon) or one no weapon has. Skills
  made from enemy moves on two weapons get the same judge ids (3970-3972),
  each on its own weapon's variation: when Scale… took every variation's,
  a test mod's Golden Hammer Leap at 31% shrank Margit's Hammer's
  hits and shockwave to 23% of his (a 0.23 m hammer hit, a 0.81 m
  shockwave instead of 0.75 and 2.6 m, as in-game testing found). A spell (or its item), a bullet: its rows'
  references (bullets and their child bullets, `AtkParam_Pc`, effects).
  Enemies' `AtkParam_Npc` rows are never changed, and an enemy-only bullet
  naming a player attack doesn't count as sharing it.
- Effects: `@cccode/fxr`'s `root.scale(f)` (sizes, offsets, lengths, radii;
  exactly multiplicative: 50% then 100% gives the original bytes back,
  but for the id). Each effect brings the effects it proxies. An effect
  other rows or player animations use, or whose id a character's own
  effect file also has (an enemy's effect brought into the common file:
  the game may play either), is copied first (new id, its proxies copied
  too, the skill's rows and TAE events moved onto the copies); copies are
  named after their originals.
- Held on a weapon: the viewport (and the game) puts an effect spawned at
  a weapon dummy with its +Z on the dummy's forward, +Y its up, so the grip
  (the weapon model's origin) is at minus the dummy's position, in those
  axes. Margit's hammer is spawned at the katana's tip (dummy 100, 1.11 m
  from the hand) with its head there and its shaft back through the hands:
  scaled about its own origin it shrank toward the tip and its shaft left
  the hands (seen in the viewport at 75% and 50%). Scaled about the grip
  instead (x' = g + f(x - g): scale, then add (1 - f) g to each top-level
  node's StaticNodeTransform offset), the hand keeps its place on the
  shaft. An effect counts as held when its models' bounds or its emitters'
  volumes reach 60% of the way to the grip; effects at the same point as a
  held one move with it (the hammer's flashes).
- Its owner's grip: that keeps the hand where it was on the shaft, but
  Margit's hammer is anchored at one end of its head (his dummy 330), his
  hand 1.96 m back down the shaft and 0.78 m to the side (his `L_Hammer`
  bone's root, in dummy 330's frame: -0.78, 0, -1.96; the effect's own
  sparkles sit at x -0.75 along -Z, and its mesh, 88213, runs along +Z
  turned 180° about Y). On a 0.6 m club its shaft ran past the hand. So
  making a skill records, for each effect spawned at a dummy on something
  held, the held thing's root bone in that dummy's frame
  (`scales.json` `handles`), and Scale… moves the copy once by
  c·(g − h) (c its size so far) so that grip is in yours, then scales
  about g as before (`fitted`). **Fit the weapon**: the size at which its
  anchor reaches the weapon's point, |g| / (h · ĝ): 59% on the
  Uchigatana, 31% on the Club. Checked on his hammer (club, 75%) and his
  spear charge (a000_003015, katana, 100%): 0° to the weapon, the hand
  2 mm from the shaft, at every frame.
- Attached model particles with "face the particle's direction" (RichModel
  orientation 2) must take their direction in the node's frame
  (`dirLocal`), not the world direction they had when spawned: the hammer
  appears at the start of a swing and kept pointing where the hand was then
  (119° off the club by the end). That was Margit's own hammer in the
  Enemies viewer too.
- Hitboxes: `hit0..15_Radius` of the player attacks, `hitRadius` and
  `hitRadiusMax` of the bullets. Their positions are the weapon's dummies
  and don't move.
- Sizes are absolute (of the original) in `.spellforge/scales.json`: per
  skill or spell (and its hitboxes), and per effect, so a second scale
  applies the ratio. The viewport's effect cache is dropped on every edit
  (fxruns `effectsChanged`), so playing animations show the new size.

## Unsaved changes after a crash (recovery)

- Every call that changes the project (dispatch.ts `CHANGES`: fields, rows,
  names, text, effects, imports, duplicates, scaling, animation edits and
  undo, skills and spells made from enemies) is appended, after it
  succeeds, to `recovery/<hash of the mod folder>/journal.jsonl` in the
  settings folder (never the mod folder): a header (the project's files'
  sizes and dates as one fingerprint, the game's regulation version), then
  one line per call (its channel and request; requests over 256 KB, such
  as imported textures, in a file beside it). Each line is flushed to disk
  before the call returns; a line cut short by a crash is skipped.
  `project:save` and `project:updateFromGame` clear it.
- Restoring makes the same calls again, in order, through the same
  handlers (`restoreChanges`; a field set without building its view): the
  same calls on the same files give the same values. Checked byte for byte
  (the `recovery` suite: rows, an effect, animation events, names, the dirty
  list). If the project's files or the game changed since, the dialog says
  so first; changes that can't be made again are skipped and reported.
- The window's place (page, row, animation, character, text) is kept per
  project in `places.json` through the main process: localStorage isn't
  flushed when the app is killed, so a crash would lose it.

## Fades over the effect's active time

- `rgbMultiplier` and `alphaMultiplier` (every sprite, trail, model and
  line action) take **ActiveTime**, the time since the node became active
  (the fxr docs' PropertyArgument 2), not the particle's age. Read once at
  0, a fade-in stayed at 0: Margit's spear (621330: RichModel 88217 and two
  Model 88212, both multipliers 0 → 1 or 3 over 0.1 s) flew as a black bar.
  When either has keyframes, the preview keeps them as a curve of their own
  over the effect's time (`activeColor`). 1029 of the 8639 common effects
  have one (2482 emitters: 1012 dim their rgb, 356 fade in…); none of the
  brightness references (campfire 7000, Sacred Ring of Light 440191, the
  greases) do. Raya Lucaria's sigil (510010) now flashes at 50 and dims to
  5 over 0.6 s, as its description says.

## Weapon buffs in the viewport

- A buff's VFX row (`SpEffectVfxParam`) names a coating effect
  (`midstSfxId`, + the weapon's `enchantSfxSize` 0-8 when
  `isUseOffsetEnchantSfxSize`) and groups of weapon dummies:
  `enchantStartDmyId_0..7` (10300 = right weapon's 300; 310, 320, 330 for
  other blades) to `enchantEndDmyId` (-1: as far as the numbers run on).
- The game coats the whole line, not the points: a longsword has only 300
  (hilt) and 301 (tip), 0.81 m apart, and every size of every coating
  (303001-303009 fire, lightning, holy, blood, frost, rot, magic…) has
  emitters that are 15 cm boxes along the dummy's Z (its forward, along the
  blade), emitting along it. So the viewer puts a copy every 15 cm
  between consecutive points (`shared/coating.ts`): 8 on the Uchigatana
  (300-303), 6 on a longsword. Copies start a second early, so the coating
  is already built when the animation starts.
- Their trails (`Tracer`, orientation 1 "LocalZ") lie along the node's Z,
  here along the blade: a still blade leaves none, a swing a sheet.
  `TracerOrientationMode` 0 faces the camera across the travel, 2 vertical,
  3 global X, 4 a cross (drawn vertical), 5 diagonal. Projectile effects use
  LocalZ 231 times, always with the node turned so Z isn't the flight
  direction (it would collapse), never unturned.
- Lightning (303011…): its arcs fade in and out through an animated
  `alphaFadeThreshold` (255 → 0 → 255 over 0.5 s): read per particle, not
  as one value. Its trail texture is 16 bolts stacked down the texture
  (`totalFrames` 16, `columns` 0): one row at a time, the frame curve
  looping each second.
- More lights than the viewer's four: merged by nearness (each group's
  colour summed, at its weighted centre).
- Buff spells: `Magic` `refCategoryN` 2 is a SpEffect (Electrify Armament
  1696000, Bloodflame Blade, Black Flame Blade, Scholar's and Frozen
  Armament, Order's Blade, Vyke's Dragonbolt, Poison Armament, Unseen
  Blade); `wepParamChange` 1 right hand, 2 left.

## Weapons' own movesets (Moveset)

- Effect on its attacks also brings the effect's vanish: in the skill
  animation it comes from, the effect at the same point starting in the
  last second of it (Golden Hammer Leap's hammer, 0.1-2.9 s, breaks into
  light at 2.67 s); on each attack it starts as long before the motion's end
  (0.23 s). Without it, the club's hammer appeared and just vanished in
  game.

- A weapon plays an attack (030505: one-handed heavy) from its special
  category (`spAtkcategory`, e.g. Estoc a145: its own R2s; Club a180: its
  R1s; 50-999) when that has the id, else its class's
  (`wepmotionCategory`: 29 katana, 33 hammer, 27 thrusting sword…). The
  behaviour graph's selectors (offsetType 13 right hand, 16 both hands)
  hold a clip per category, special ones included.
- So Moveset gives a weapon a special category of its own (a270 up, then
  a100-a269, any number no animation, weapon or skill uses) with copies of
  the moves it takes (motion referenced, events copied), registered in
  every selector for their ids. Slots are id ranges: R1 0300xx/0320xx,
  dash 0302xx, roll and backstep 0303-0304xx, R2 0305xx, jump 031xxx/033xxx,
  guard counter 0307xx, left hand 035xxx, dual wield 034xxx, mounted
  038-039xxx. 0306xx (classes' versions of some skills, "Spinning Wheel")
  and the thrusting swords' 0309xx are left alone.
- Behavior rows fall back variation → its hundred → 0 (Mace 1102 has only
  its R2 rows; the rest are hammer 1100's). The weapon gets a variation in
  its class's hundred (the highest free: 998 for katanas) holding its old
  variation's own rows (a copy's whole set) and, for each judge the new
  moves fire, the source weapon's row (its AtkParam: motion values, damage
  type; thrusts are attribute 2). Every weapon model has the same hit
  dummies (100 tip, 110 middle, 120 grip, 122, 130), so another class's
  hit shapes land along it.
- A weapon is its affinity rows too: ids in its ten-thousand, every 100
  (Uchigatana 9000000-9001200), same class: all are changed.
- Stances (Unsheathe, Square Off, Night-and-Flame, Wing, Overhead,
  Moon-and-Fire, Spinning Strikes…) share the stance framework: 040050-53
  start, hold, end; 040060/65 and 040070/75 the R1 and R2 follow-ups.
- Effect on its attacks: the skill animation's effect event (type, params:
  effect, dummy, follow flags) copied onto each move, 0 to the end
  (IsRestrictToDummyPoly: the effect ends with the move). Hide: a copy of
  Unseen Blade's SpEffect (1466000: `stateInfo` 184 "Hide Weapon",
  `wepParamChange` 1, vfx 1466000 `isInvisibleWeapon`) with
  `effectEndurance` -1 in a free `residentSpEffectId` slot; nearly every
  weapon has `isSoulParamIdChange_model0` 1, which lets it apply.
- Spells as moves: a spell is cast from its own animations, category 400 +
  its Magic `refType` (Glintstone Pebble a401, Lightning Spear a436, Swift
  Glintstone Shard a479), the right hand's 045000-045099: Pebble's 045010,
  045020, 045030 are the chain (R1 again within their ChrActionFlag 4
  "Cancel - RH Attack" window, the same flag attacks chain with), Lightning
  Spear's 045011 is the quick throw (lets go at 0.50 s) and 045010 the held
  one (1.47 s, RefType 1: the charged spear). Their `CastHighlightedMagic`
  (type 64: DummyPolyID, RefType = which refId of the Magic row) fires
  whatever spell is highlighted, and `SpawnFFX_GoodsAndMagic(EX)` (114/115:
  DummyPolySource 0 body, 1 left, 2 right weapon; SFXIndexID 0 castSfxId,
  1 fireSfxId, 2 effectSfxId) shows its effects. As a weapon's attacks:
  BulletBehavior (type 2, `@18` 255 like every one the game has) on a judge
  the weapon's moves don't use (800 up), a BehaviorParam_PC row of its
  variation (copied from Carian Knight's Sword's glintblade: refType 1,
  `ezStateBehaviorType_old` 1, `category` 1) firing the spell's bullet with
  the Magic row's `stamina`; SpawnOneShotFFX (96) with the spell's effect
  ids. A staff's casting point (181) becomes the weapon's tip (100). Cast
  like another spell, its own effects (96 with 5xxxxx ids: Lightning Spear's
  spear in hand, 525500) and spell sounds (129, SoundType 5) come off, and
  every cast fires the spell's refId1. BehaviorParam has no FP field, so
  the casts cost none.
- How a cast plays (the game's 1.17.1 script and graph; Entire spell plays
  it): the behaviour graph's W_MagicLaunchRight is 045000, W_MagicFireRight
  045010, W_MagicFireRightCancel 045011, W_MagicLoopRight 045012,
  W_MagicFireRight2/3 045020/045030 (left hand +100, jumping 045060/61).
  Casting starts Launch; Launch goes on to Fire where its timing flag comes
  (`env(313)`): every launch but one (129 of 130, the parry Carian
  Retaliation hasn't) has ActivateJumpTableEarly 93 there, the only jump
  table launches use (Pebble 0.33 s, Comet Azur 1.70 s: its long wind-up).
  Fire goes to Loop while the button is held if the spell can be held
  (`CheckIfHoldMagic`), else to FireCancel; Loop ends in FireCancel when
  the button is let go or FP runs out. So 045011 is a held spell's release
  (12 spells: Comet Azur, …), or another spell's quick cast (53, Lightning
  Spear's uncharged throw); 12 chain three casts (045020, 045030), entered
  in the cast's "Cancel - Magic" window (ChrActionFlag 29). Pebble's launch
  casts its refId2, 10400099: no speed, no effect, only the cast sound.
- CastHighlightedMagic (64): RefType 0-9 = refId1-10 (refCategory 1 a
  bullet, 2 a SpEffect). Its bool at @4 keeps it firing while the event
  lasts, at the bullet's `shootInterval` (Comet Azur's beam 10420002 every
  0.2 s, its core 10420000 every 0.5 s; 123 events with @4 across the
  spells, nearly all long ones: Burn O Flame!, The Flame of Frenzy,
  Crystal Barrage's volleys). @5 = 2 only on Comet Azur and Agheel's Flame,
  the two that stay on the caster: BulletBehavior's AttachmentType sits at
  the same place. Magic `ezStateBehaviorType` 0 sorceries, 1 incantations:
  cast with a weapon whose `enableMagic` / `enableMiracle` is 1 (staffs,
  seals; Staff of the Great Beyond both).
- A bullet event can fire another of the character's bullets (the Make it
  dialog's **Bullet** list, `EnemySkillRequest.bullets`: enemy judge →
  bullet): the whole chain of the chosen one is copied (hit and interval
  bullets, their attacks, effects and sounds).
- Enemy moves as attacks (Enemies → Make it… → an attack): each id of the
  attack (R2: 030500, 030505, 030510, 030515; an R1 of the combo: its one
  id; +2000 two-handed) starts as a copy of the weapon's own animation for
  it (its special category's, else its class's), so its combo window
  (ChrActionFlag 4 "Cancel - RH Attack"), cancels and recovery stay, retimed
  to the move's length. One motion file is written (the move fitted to the
  player, named after the first id, in c0000_a9x); the others reference it
  (TAE animation entry type 0, `a` 256, `b` category × 1,000,000 + the first
  id). The move's attacks and bullets get judges the weapon's moves don't
  use (701 up, counted over both grips), with category-1 behavior rows of
  its variation copied from one of its own; player copies of the attacks
  (`AtkParam_Pc`, flat damage counted) and bullets, effects (common) and
  sounds (cs_main) come along as for a skill. Recorded in
  `.spellforge/movesets.json` (`enemy`: character, animation, label,
  judges): Moveset lists them, and "Back to its own" drops them with their
  rows. (The slot says "Keep: Margit's moves", each attack listed under
  it.)
  A move's name in labels is the first named thing it hits or fires
  with ("Hammer", "Sword", "Dagger"), so a label reads "Two-handed R2:
  Margit's Hammer (a002_003010)".
- A mod's TAE can name an animation's motion anything (Clever's are all
  "Sacred Arsenal"): the game plays the HKX named by the animation's id,
  found in whichever of c0000's binders has it (his a683 motions sit in
  c0000_a6x, by number). The viewer does the same: when the named HKX
  isn't there, it plays the id-named one (`hkxFor` in
  src/main/services/character.ts).
- What an animation id is (src/shared/animIds.ts, shown beside its name
  and as the list's tooltip): 0300x0 the R1 chain (030000 1st, 030010
  2nd…; +2000 two-handed, 032000), 0302xx running, 0303xx roll, 0304xx
  backstep, 030500/030510 R2 held (charged), 030501/030511 charging,
  030505/030515 quick R2, 0306xx a class's version of a skill, 0307xx guard
  counter, 0309xx special attacks, 031xxx/033xxx jumping, 034xxx dual
  wield, 035xxx left hand, 037xxx weapon actions, 038-039xxx mounted,
  040000 skill (040050-53 a stance, 040060-79 its follow-ups), 045000-099
  right-hand casts, 045100+ left-hand, 145xxx on Torrent.

## How chained bullets aim (the viewer's bullet simulation)

Read from the game's own rows and checked against Clever's and Morgott's
sword rains (their names say what each stage should do):

- Shot k of a bullet aims at `shootAngle + k × shootAngleInterval` to the
  side (positive left) and `shootAngleXZ + k × shootAngleXInterval` up from
  level, plus up to half of `shootAngleYMaxRandom` / `shootAngleXMaxRandom`
  either way. The game doesn't centre a spread: of 2,022 multi-shot rows,
  the symmetric fans set a negative first angle themselves (Flaming
  Strike: -90 + k × 36; Night-and-Flame: -50 + k × 20).
- The angles turn from a level frame (world up) around the direction the
  bullet starts from: the character's facing for the first stage; for a
  chained stage (Hit Bullet, interval bullet) its parent's flight there,
  unless `isOwnerOverrideInitAngle` (then the facing again). A parent
  flying straight up gives that frame from its last bit of heading: that's
  why rising bullets aim 89°, not 90°. Turned from straight up, side 90° and
  an up-angle spread come out level: Morgott's emitter (side 90°, up -90° +
  k × 72°, 5 shots) is a star all around, Clever's (up -120° + k × 30°, 3
  shots) a fan in front, and a sword fired at up -90° from a level emitter
  points straight down, hangs (Stay) and falls (Fall) down. A full circle
  needs count × interval = 360°.
- A stage with no angles of its own carries on as its parent was (its
  effect keeps turning the same way).
- `launchConditionType` is labelled "Hit enemy" (4) in the community enum,
  yet Morgott's rise, emitter and swords chain on it by running out; the
  viewer spawns the next stage at the end unless the condition is water
  (1, 2).
- `dist` is the distance where damage starts to fall off ("not actual
  flight distance"), and where `accelInRange` gives way to
  `accelOutRange`; `life` decides how long it flies.
- Bullets that fall (gravity) or fly down into the ground end on it unless
  `isPenetrateMap`. The viewer simulates up to 1,200 runs per animation and
  24 interval bullets per parent (a sword rain is hundreds).

## What a weapon allows (buffs, Ashes of War, affinity)

- `isEnhance` (Is Buffable): greases and buff spells can be used on it.
  `gemMountType` (Ash of War Type, enum GEM_MOUNT_TYPE): 2 can be changed,
  0 can't (the weapon keeps the skill in `swordArtsParamId`); one vanilla
  row has 1. `disableGemAttr` (Prevent Affinity Change): 1 locks it.
- The game's own values, over its 659 named base weapons: somber weapons
  (Moonveil 9060000, Sword of Night and Flame 2140000; `reinforceTypeId`
  and `materialSetId` 2200) are 0 / 0 / 1; normal ones 1 / 2 / 0;
  catalysts can't be buffed or re-affinitied (Glintstone Staff 0 / 2 / 1).
  Each affinity is its own row: Heavy and Keen Uchigatana can be buffed,
  Fire, Magic and Cold (9000400, 9000800, 9000900) can't.
- Spellforge lists the three with the weapon's other fields whatever their
  values: they're `key` fields (`KEY_FIELDS` in core/params/hints.ts), which
  the zero-hiding filter keeps. `EquipChoice.buffable`
  lets the viewer say a grease wouldn't apply in game.

## IDs that say what they are

- Param fields: the line under a reference field names its row(s); with a
  value and no row, it says which param has no such row (`refMissing`,
  "No weapon/bullet/attack… 123"). An effect field says the effect's name;
  copies are named after their original ("… (copy of 621303)"), from
  `.spellforge/effect-copies.json` (every effect copy made, copy → original,
  kept beside the scale record's copies) or the effect names sheet; one
  not in the common effect files says so.
- Animation event fields (`about` on the field view): a dummy poly says
  where it is (`describeDummy`). Ids under 10000 are points on the body,
  10000 + n point n on the right-hand weapon (10100: its tip), 20000 + n on
  the left-hand one (or the event's DummyPolySource says which: 1 left, 2
  right). A body point is named by the bone it rides in c0000's model
  (`CharacterService.bodyDummyBone`): 20 the right hand's weapon bone
  (R_Weapon), 21 the left's (L_Weapon), 22/23 the shield bones, 220 the
  chest (Spine2), 93 the head, 1/2 the hands; without the model, a short
  list (1 right hand, 2 left hand, 5/6 feet, 7 head, 8 and 220 chest, 9
  hips). Weapon points: 100 tip, 110 middle, 120 grip, 122/130 along the
  blade, 181 a staff's casting point, 300+ the buff line. Sounds name their
  sound when the sound list has it; a SpEffect that doesn't exist and an
  effect with no name say so.
- Body points 20 and 21 are exactly their weapon bones' frames (the hand's
  weapon root, weapon or not), while a weapon's own points are turned:
  point 300 of the dagger, relative to R_Weapon, has x → -x, y → -z,
  z → -y. No body point on either hand is turned like a weapon's 300. An
  effect placed for a weapon's 300 (Margit's sword, converted) still reads
  as a held sword on 21 (checked in close-ups), but an effect made for
  20/21 is turned for them: Clever's conjured sword 900300403 is Margit's
  621301 edited (42,928 bytes against 37,632, a quarter of them different).

## How a big moveset mod is built (Clever's Sacred Arsenal)

Studied for the "Recreating Clever's Sacred Arsenal" video (Nexus Mods,
Elden Ring mod 4649, by Clever; regulation 1.10.1). Only read, never
shipped.

- One weapon, Sacred Arsenal 1560000: Dagger class (`wepmotionCategory`
  20), `spAtkcategory` 683 (162 animations of its own: 030xxx one-handed
  golden-dagger moves, 032xxx two-handed Margit's swords, hammer and
  greatspear), `behaviorVariationId` 1683 (90 BehaviorParam_PC 101683xxx →
  75 AtkParam_Pc 1683xxx named by form: "1H Dagger", "Swords", "Hammer",
  "Hammer AOE", "Sword/Shield", "Greatspear"), skill 2045 "Downpour of
  Light" (`swordArtsTypeNew` 83 → its animations in a683 too), 82 physical
  + 101 holy, weight 2, sold by Kale (ShopLineupParam 100523).
- The conjured weapons are effects, not models: 9003004xx spawned at body
  points 20/21/23 as a swing starts (900300403 the sword), 9003004x3/x4
  making them vanish, copies of Margit's (621351 → 900621351…) moved into
  `sfxbnd_c8000` (Torrent's effect file, always loaded).
- The skill is a chain of bullets 700000200-212 (Floating Swords Rise →
  Split ×3 → Rise → Stay → Fall, the hit → Linger; Constant Rain; the
  Dagger Throws), each linked by `HitBulletID`, the split emitter's swords
  by `intervalCreateBulletId`. It's a tuned copy of Morgott's sword rain,
  vanilla bullets 2130060-2130065 (the same names, typo "Emiied"
  included): his emitter fires 5 bullets 72° apart for 1.2 s, Clever's 3
  bullets 30° apart (-120°, -90°, -60°) for 0.6 s; Clever's swords hang
  1.05 s (Morgott's 2.5), fall with gravity 999 (100), and linger 7 s
  dropping "Constant Rain" hits (700000206/207). Clever fires it from body
  point 93 (above the head) at 0.87 s; Margit's own a002_003035 fires only
  2130050, a single floating sword (its judges 850 and 950 resolve to
  nothing for him). Spellforge's recreation fires 2130060 from the stab
  (Make it a skill → Bullet) and tunes the copy's emitter like Clever's.
- Its behavior script (`action/script/c0000.hks`, community-decompiled):
  category 683 counts as a weapon with special attacks (the dagger throws);
  the grip button plays a trick-weapon swap (037030/037040, 030950/955,
  032950/955; SpEffects 8000400-8000403); SpEffects 8000406/8000407
  "[Modular] anim jump", set by its animations, make the script jump to
  W_AttackRightLight6 / Light2 mid-combo. Spellforge doesn't edit behavior
  scripts; everything else it can make (Make it a skill, Make it… an
  attack).
- Margit (c2130) moves that recreate it: a002_003003 and a002_003014
  dagger slashes, a000_003037 dagger throw (bullets Dagger / Dagger Split),
  a000_003035 golden-sword combo, a002_003010 hammer, a000_003015 spear
  charge, a002_003035 the sword stab and floating sword. Godrick (c4750)
  a000_003031: his three ground slams (Rocks).

## How weapons are held (WepAbsorpPosParam, the viewer's "Held")

- A weapon's `absorpParamId` row gives, for each of its models (0–3), a body
  dummy poly for each way of holding: `right_n` / `left_n` one-handed,
  `both_n` the right weapon two-handed, `leftBoth_n` the left weapon
  two-handed, `rightHang_n` / `leftHang_n` where the other hand's weapon
  hangs meanwhile. Thousands are flags; the dummy is the value mod 1000
  (2069: body dummy 69 on the hip).
- Longsword: model 0 at R20 / L21 one-handed, **24** two-handed (both and
  leftBoth: the two-handed grip is its own point, not the hand's 20), hung
  at 2030 / 2031; its scabbard (model 1) at 2030 / 2031 throughout. Shields
  use 22 / 23, two-handed 25, hung 2047 / 2048 on the back. Bows 18 / 19,
  two-handed 21.
- The viewer places a model at a dummy the way it sits on its one-handed
  grip dummy: the mesh's pose on its hand bone premultiplied by
  `bone⁻¹ · target · grip⁻¹ · bone`. "Auto" holds two-handed for animation
  ids 032000–033999.

## Stances and the grip change (wepmotionOneHandId / wepmotionBothHandId)

- EquipParamWeapon's `wepmotionOneHandId` and `wepmotionBothHandId` pick an
  animation category each (a000 + id) for holding the weapon one- and
  two-handed: walking (020xxx), guarding on the move (019xxx, 023xxx),
  quick turns (026xxx), jumps (202xxx), riding (100xxx–129xxx), stealth
  (3xxxxx) and the grip changes (029xxx). The attack category
  (`wepmotionCategory`, `spAtkcategory`) is separate.
- Values the game's weapons use (base rows): one-handed 0 (a000: most), 2
  (greatswords, colossal weapons, great hammers…), 3 (twinblades, great
  épées, greatbows); two-handed 10 (straight swords, daggers and most), 12
  (greatswords and other big weapons), 13 (spears, twinblades…), 14 (bows),
  15 (shields), 16 (crossbows), 2 (Radahn's greatswords), 3 (Rellana's twin
  blades), 0 (fists, thrown items). Categories a002, a003, a010 and
  a012–a016 exist for them (a011 doesn't).
- The two-hand button (ExecHandChange) picks the grip change by where the
  other hand's weapon hangs (SetHandChangeStyle): taking the right weapon in
  both hands plays the two-handed stance's 029070 (the left's 029090),
  after the one-handed side's 029060–029063 put the left weapon away; going
  back plays 029040–029042 (HandChangeBothTo…) and 029050–029053 to take
  the other weapon again. Their selectors are HandChange…_CMSG (and
  StealthHandChange… at 3290xx).
- Moveset's "Stance and grip change" sets those two fields on every
  affinity of the weapon, to the values the game's own weapons use (so every
  animation exists): no files change. Not yet tested in game by us.

## The bare head (face, hair)

- Parts files: faces `fc_m_00NN` / `fc_f_00NN` (the head skinned to the
  whole skeleton, 380+ bones), `fg_a_` face parts by hundreds (01 eyes,
  teeth and mouth; 20 eyebrows; 30 beards; 50 accessories such as the
  eyepatch; 70 eyelashes; 60 is textures only; each hundred's 00 is an
  empty placeholder), hair `hr_a_00NN` (hr_a_0000 is bald: no meshes; others
  have cloth bones). Low-detail copies end in `_l`.
- FaceParam picks one of each per face (`face_partsId`, `eye_partsId`,
  `hair_partsId`, `beard_partsId`, `eyebrow_partsId`, `eyelash_partsId`,
  `accessories_partsId`) plus colours; FaceGen shaping isn't applied in the
  viewer (the parts show in their bind shape), nor the colours (hair and
  eyebrow textures are grey, tinted in game: they show pale grey). The
  viewer shows the head's parts only without a helmet (a plain face,
  fc_m_0000 or fc_f_0000, eyes, short hair hr_a_0001, eyebrows and
  eyelashes until others are picked).

## Reloading the character in the running game (F5)

- The same request DS Anim Studio and Smithbox make: WorldChrMan keeps a
  list of character models to reload. WorldChrMan's global is found by the
  pattern `48 8B 05 ?? ?? ?? ?? 48 85 C0 74 0F 48 39 88 ?? ?? ?? ?? 75 06
  89 B1` (RIP-relative at +3; its +15 operand is the main player's offset,
  0x1E508). The code that frees a finished request is
  `80 65 ?? FD 48 C7 45 ?? 07 00 00 00 ?? 8D 45 48 4C 89 60 ?? 48 83 78 ??
  08 72 03 48 8B 00 66 44 89 20 49 8B 8F ?? ?? ?? ?? 48 8B 01 48 ?? ??`:
  its operand at +37 is the request allocator's offset in WorldChrMan
  (0x1E660 since 1.12; the list head pointer is +8, its size +0x10, the
  unload timer +0x18).
- A request: next and prev links at 0 and 8, the model name's pointer at
  0x58, its capacity byte at 0x70 (0x1F; 8–0x1F, larger asserts), the name
  in UTF-16. Spellforge writes it in memory it allocates, links it after the
  list head, sets the timer (10.0) and the size (1) last. The game unloads
  every character of that model (the player too), loads them again from
  disk, unlinks the request and frees it, so that free (`mov rdx,rbx`, at
  +44 of the pattern) is patched to `xor rdx,rdx` while the game runs.
- Checked on eldenring.exe 2.7.1.0 (1.17.1): both patterns occur once,
  0x1E660, the patch bytes.
  The reload itself only shows in game: offline, EAC off, a save loaded.
  me3 maps mod files at launch (files created after start aren't served);
  ME2 looks each time.

## Behaviour scripts (c0000.hks)

- The game's `action/script/c0000.hks` is compiled HavokScript (Lua 5.1
  family, header `\x1bLuaQ` 0x0E, big-endian, 4-byte float numbers); the
  game also accepts a text script in its place and compiles it at load.
  Spellforge reads, decompiles and compiles HKS itself
  (`src/core/formats/hks/`; format facts in `havokscript-notes.md`).
- Numbers are 32-bit floats: integers above 16,777,216 aren't exact, so a
  SpEffect a script tests (`env(1116, id)`) must be below that. TRUE and
  FALSE are the numbers 1 and 0 (0 is true in Lua): compare with `== TRUE`.
- The script ends by making every unknown global return a do-nothing
  function (`setmetatable(_G, global)`), so a misspelt name fails silently;
  community v7 scripts also end with a top-level `return`, after which
  nothing may follow (Spellforge puts its block before it).
- Spellforge's behaviours are wrappers appended to the script, one per
  function (`ExecAttack`, `ExecHandChange`, `IsEnableSpecialAttack`,
  `GetAttackMaxNumber`, `GetDualAttackMaxNumber`, the `Is…Arts` skill
  lists, `SetWeightIndex`, `IsEnableGuard`), read straight from the global
  (only functions the script defines are wrapped), run under `pcall`, using
  numeric env / act ids: 1116 a SpEffect is on, 345 a hand's weapon's
  spAtkcategory, 1106 / 1108 an input pressed and for how long, 1007 the
  local player, 234 precision aim, 404 / act 2025 the AI attack id after a
  blend. All of them exist in the game's own script.
- The game's scripts (c0000, common_define) call no `rawget` or `pcall`
  (nor do the community's or Clever's): of Lua's library they use
  `setmetatable`, `ipairs` and `math.*`, so the base library is there
  (`pcall` with it). The block uses no `rawget`; were `pcall` missing, the
  catch-all's do-nothing function would stand in and the game's own
  behaviour would run. Functions the scripts call but never define (the
  engine's): env, act, hkbFireEvent, hkbGetVariable, hkbIsNodeActive,
  hkbGet/SetBoneLocalSpace / ModelSpace, ExecTalk, ExecTalkDeath,
  ExecTalkDamage, hkVector4, math, setmetatable. 139 of the game's
  functions answer TRUE / FALSE (IsEnableGuard, GetEquipType…).

A new skill type needs the script (without it, new skills do nothing on L2 in
game):

- L2 plays a skill only while `c_IsEnableSwordArts` (env 326 gives the hand's
  skill type, swordArtsTypeNew; its animations are a(600 + type)). A one-shot
  skill then goes through `GetSwordArtsDiffCategory` and
  `GetSwordArtsPutOppositeWeapon` (common_define.hks), which read
  `#SwordArtsCategory[type]` and `SwordArtPutOppositeWeapon[type][n]`
  unchecked: the first for types below 300 outside 170-254, 272 and 275.
  The tables list only the game's types (133 and 311 of them; none of
  26-49), so a type with no entry errors there and L2 does nothing. The
  community's EldenRingHKS checks for absent entries in both functions (ivi:
  "sanity check for absent entries (custom Sword Arts)"), so custom types
  work on it (Clever's 83, Bloody Scythe's 80); the game's own script doesn't.
  Spellforge judges by the definitions in use (the project script's own,
  else common_define's) and adds entries only when they read unchecked.
- Spellforge's block gives every skill type the project uses and no game
  skill does an entry in both tables, first in the block, as plain guarded
  statements (`if SwordArtsCategory[t] == nil then … = {0} end`): Lion's
  Claw's values ({0}: only the default variant; {TRUE, FALSE, TRUE}), the
  default base skill. Written only when the base scripts define both tables.
  common_define.hks loads before c0000.hks (c0000 uses its FALSE at load), so
  they exist when the block runs. The record keeps the types written; a
  project whose script lacks them says so on open, and Save writes it.
- Skills made from an enemy move take the first category from a626 no
  animation and no skill uses (enemyMoves.ts); the four practice skills are
  26-29.

How the recipes meet the game's code (read in the 1.17.1 script):

- `ExecAttack(r1, r2, l1, l2, b1, b2, is_guard, blend_type, artsr1,
  artsr2, is_stealth_rolling)` runs every frame of idle and attack states
  (`AttackCommonFunction`, after passive actions, weapon change, evasion,
  items and magic: a dodge wins over a chain); it returns at once without
  an attack request (`GetAttackRequest`: env 1106 per arm, which the game
  only reports inside the animation's cancel windows). A jump rewrites
  `r1`… before it: then while env 271 (the TAE "special transition" flag
  66) is on, R1 is reset to `W_AttackRightLight1`, staffs keep only Light
  2 / 3, and the game's own routing SpEffects 19903 / 19904 / 19915 (Light
  3 / 4 / 2) apply last. Jump windows go inside the cancel window, before
  the special transition.
- Special attacks: `AttackRightHeavy1Start_onUpdate` plays
  `W_AttackRightSpecial1` (030950) when `IsEnableSpecialAttack(HAND_RIGHT)`,
  R2 is held (env 1108 > 0), the dodge button is held (`ACTION_ARM_SP_MOVE`)
  and SpEffect 100290 is on; Heavy2Start plays Special2 (030955; spAtk 953
  Special1), two-handed 032950 / 032955. The gate is TRUE for spAtk 251 /
  254 and rapiers, curved swords, heavy thrusting swords, beast claws,
  throwing daggers, great katanas and perfume bottles. 100290 is applied by
  event 67 (AddSpEffect) in those classes' 030500 / 030510 / 032500 /
  032510 (82 events; a027_030500 frames 8–23, a028_030500 6–25). The
  recipe allows a category and adds that window to the weapon's own
  charged R2 animations (only where the special attack it leads to exists).
- The two-hand button: `ExecHandChange(hand, is_force, blend_type,
  no_reset)` acts for the player's own press (is_force FALSE, env 1007,
  an action request, not aiming, `ACTION_ARM_CHANGE_STYLE_R` with R1 held
  under 100 ms, or the left one). The `Special1/2` states call
  `AttackCommonFunction` (R1 after them is the backstep attack, 030400,
  unless 19915). The crossbow reload slots 037040 (`…CrossbowRightEmpty`,
  registered only for a046 / a052) and 037030 (`…RightReload`) are free on
  other weapons: Clever's transforms use them. They're half-body events.
- Half-body events: common_define's 290 `Event_X = {"W_X", default
  states…}` tables. The game plays them with `ExecEventHalfBlend(Event_X,
  blend_type)` (the event and its `_Upper`, plus the layers' default
  states), never `ExecEventAllBody`; recipes do the same (an attack input
  can't: ExecAttack fires `ExecEventAllBody(r1)`).
- Guarding: `IsEnableGuard()` decides by the weapon that would guard (the
  left one held one-handed, the right one held in both hands, the left one
  in both hands); "no guard" checks that one.
- `SetWeightIndex()` (before rolls and jumps) sets `MoveWeightIndex` and
  `EvasionWeightIndex` from the equip load (and a few SpEffects); a dodge
  recipe sets only `EvasionWeightIndex` after it.
- `GetAttackMaxNumber(hand)` feeds `IsEnableNextAttack` (Light 2 → 3 → …;
  Light 1 always goes on to Light 2).
- The behaviour graph spells two selectors `AttackRightLigh5_CMSG` and
  `AttackRightLigh6_CMSG` (030040, 030050); their events are
  `W_AttackRightLight5 / 6`.

The script editor (Your scripts) checks code as it's typed: the parser
(syntax, line:column), Spellforge's compiler (alone, and with the whole
script: the base, the behaviours and every script), and src/core/behavior/
lint.ts: `if env(…) then` / a TRUE-FALSE function as a condition (always
taken: 0 is true in Lua), `== true`, `return true` in a function, unknown
names (the catch-all makes a misspelt one fail quietly), numbers above
16,777,216 (as written: the parsed value is already a float32), env / act
ids the game's script never uses, `W_` strings the graph lacks, half-body
events played on the whole body, and definitions that replace a game
function or constant. What it knows comes from the game's scripts
(scriptContext: their globals, the engine's names, predicates, ids, Event_
tables).
- A behaviour event (`ExecEvent("W_AttackRightLight3")`) plays the state
  whose selector is `AttackRightLight3_CMSG` (animation id 030020): 817 of
  the game's event names (action/eventnameid.txt) map to a selector that
  way. An event the graph doesn't know can crash the game; the weapon's
  category needs the slot's animation registered.
- Marker SpEffects (a recipe's window) are copies of the game's own
  "[HKS] Slow Walk" (100000): every field default, lasting only while an
  AddSpEffect event keeps them on. Spellforge's start at 7,810,000.
- Comparing a text script with the game's (compiled with Spellforge's
  compiler, function by function): a Bloody Scythe mod's script
  (community v7, for 1.08.1) lacks 90 of the 1.17.1 game's functions;
  Friede's Scythe's (v17) 1; Clever's Moveset Modpack's (v18) none. Every
  community version defines `SetTurnSpeed` as a function and then as the
  act id 2004 at the end of the file: the id replaces the function.
- Techniques the recipes cover come from Clever's Sacred Arsenal and Moveset
  Modpack (animation jumps and chains by SpEffect windows, the two-hand
  button as a transform via ExecHandChange and the 0309xx special slots,
  special attacks per spAtkcategory, skill lists, per-weapon dodges and
  guard) and the community EldenRingHKS; Spellforge's code is its own.

## Playing an animation's sounds (the viewer)

- A TAE sound event posts `Play_<letter><id, 9 digits>` (see Sound banks above);
  the viewer looks for it in the character's banks, then the player's
  (cs_main, cs_smain), as the project has them.
- What an event plays (`eventVoices` in formats/wwise.ts): its Play
  actions' targets. A random/sequence container (HIRC 5) plays one of its
  playlist (child id and weight, after the children list; the mode byte,
  0 random 1 sequence, is the third of the three mode bytes after the
  avoid-repeat count); a switch container (6) plays the children of its
  default switch (the u32 after the group id), from its packages (switch
  id, node count, node ids); a layer container (9) plays all its children
  together. Of cs_main's 10,544 events, 4,881 play sounds, 5,163 only stop
  or change them (action 0x0103 and others), 500 play what other banks hold
  (areas, voices) or a generator.
- Loudness and pitch add up along the node and its parents (actor-mixers
  too): property 0x00 is volume (dB, −39 to +12 in cs_main), 0x02 pitch
  (cents, ±2400), 0x06 make-up gain (dB). The first R1 of the scythe
  (a050_030000) starts with Play_c105060900, a random container at
  −14 dB and −2,200 cents (a deep whoosh), with low- and high-pass filters
  (0x03, 0x04) the viewer doesn't apply. Random ranges aren't applied
  either.
- Overlapping sounds add up: the game mixes them through its buses (and a
  limiter); the viewer sends them straight out. Recorded from the viewer at
  60%, Sacred Arsenal's combo (Margit's sounds) peaked at 1.17 and clipped
  (23,547 samples in 50 s). A gentle limiter on the viewer's output
  (DynamicsCompressor: −6 dB, knee 3, 12:1, 2 ms attack, 200 ms release)
  took those parts to 0.91 with almost the same loudness (RMS 0.30 →
  0.28), tried offline on the recording first. Levels against the game's
  still aren't checked.
- A sound's stream byte: 0 the media is in the bank's DATA, 1 the bank holds
  its start (prefetch) and the whole is `sd/wem/<first two digits of the
  id>/<id>.wem` (or `sd/enus/wem/...`), 2 streamed only. Every sound is
  Wwise Vorbis (plugin 0x00040001); the plugins 0x00640002, 0x00650002 and
  0x00660002 are generators (silence, tones) with no media.
- Wwise Vorbis to Ogg (formats/wemVorbis.ts, after ww2ogg, BSD, with its
  aoTuV 6.03 codebook library): all 18,906 sounds of the game's 217 banks
  convert, page CRCs and sample counts checked, and Chromium decodes them to the exact sample count. A short
  sound's last packet needs an Ogg page of its own: on one page with the
  rest, Chromium's decoder (FFmpeg) ends it 113–128 samples early.

## The UI with "reduce motion" on (Windows animation effects off)

- base.css's reduced-motion block used to give every element
  `transition-duration: 1ms !important`. `transition-property` starts as
  `all`, so that made every property of every element transition, not only
  the ones that had transitions. The dock's panel overlays (dockview's
  `.dv-render-overlay`, moved by inline left/top/width/height) then trailed
  the layout: right after "Fill the window" the overlay's style said
  1600×818 while its box was still 1050×348, with three CSSTransitions
  running. Usually that's one frame; while the viewer was busy (after
  changing equipment and helpers) it lasted seconds, and the viewer was
  caught "not filling" (on a PC with reduce motion on). The block
  now sets `transition: none !important`; the fill lands on the click.
- Nothing of ours waits for `transitionend`. dockview's waits have timer
  fallbacks (300 ms), and it turns tab transitions off itself under reduced
  motion.
