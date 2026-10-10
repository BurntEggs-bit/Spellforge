# DS Anim Studio parity checklist

What DSAS 5 (ER) offers, from its own screens, and where
Spellforge stands. `[x]` done, `[ ]` to do, `[~]` partly. F1 on the
Animations page lists every shortcut.

## Animation list / TAE
- [x] Categories and animations, file reference shown (own .hkt / reference)
- [x] Duplicate animation (Insert) / duplicate category (Shift+Insert)
- [x] Change event type (F1 in DSAS; here the event picker)
- [x] Rename (F2): the project's own name and tags for an animation, kept in
      `.spellforge/animation-notes.json`, shown in the list and searched;
      Shift+F2 moves a whole category to a new number (weapons and skills
      using it can follow; own motions play from their old names)
- [x] Animation properties (F3): id and category (moving it), motion (own,
      another's, everything from another), loop flag, raw reference, which
      animations use it; category properties (Shift+F3): TAE id, file,
      header (format, flags, skeleton.hkt, SIB)
- [x] Go to referenced source animation (F4): the "plays the motion of" link
- [x] Sort tracks: lanes by kind, by type number or by first event (the
      events' TAE groups are kept as the game stores them)
- [x] Import from animation (Ctrl+I): another animation's events, added or
      replacing, optionally its motion
- [x] Go to animation (Ctrl+G), go to category by number or TAE id (Ctrl+H),
      Find (Ctrl+F: events by type and a field's value, every category, a
      dock panel)
- [x] Mute / solo events in the viewer (1, 2; 3 clears), mute a whole event
      type (4), custom lane colors (C, or double-click a lane's name)
- [x] Tags on animations (F2)
- [x] Up/Down prev/next animation; Page Up/Down the same id in the previous /
      next category that has it; Alt+Left/Right back and forward

## Graph (timeline)
- [x] Drag to move, drag edges to resize, Delete, add event
- [x] Undo (Ctrl+Z), redo (Ctrl+Y / Ctrl+Shift+Z), every edit one step
- [x] Rectangle select on the empty timeline, Ctrl-click toggles, Shift-click
      adds, Ctrl+A, Esc; dragging one of several moves them all
- [x] Ctrl+X / C / V: cut, copy, paste at the playhead, into any animation
- [x] Ctrl+right-click (or double-click) places an event of the lane's type
- [x] Ctrl+wheel zoom
- [x] Click/drag on ruler scrubs; playhead

## Viewport
- [x] Character: skeleton, skinned FLVER parts with albedo, normal and ORM maps
- [~] Equipment: head, body, arms, legs, right/left weapon, female, and the
      way weapons are held (auto from the animation id, one-handed, right or
      left weapon two-handed: WepAbsorpPosParam's grips and hung places);
      the bare head's parts (face, hair, eyebrows, beard, eyelashes, an
      accessory: FaceParam's parts) when no helmet is worn, a plain one by
      default. Face shaping (FaceGen morphs) and skin, hair and eye colours
      aren't done (hair shows pale grey)
- [x] Animation playback (spline-compressed HKX), references followed
- [x] Root motion (enable), camera follow (and turning), multipliers along
      the ground, up and down, and turning
- [x] Playback: Space, Left/Right frame, Home/End, Ctrl+R, speed, loop
- [x] Helpers, each toggleable with its own color, plus master toggles:
  - [x] DummyPoly IDs and transforms; equipment dummies by slot (R:/L:) or
        as events name them (10000 + n right, 20000 + n left)
  - [x] FLVER bone lines, names, transforms and bounding boxes
  - [x] HKX bone transforms / names; bone glue joints
  - [x] Boost visibility: line thickness, dummy and bone axis sizes, label size
  - [x] Character hit capsule (NpcParam hitRadius / hitHeight; the player's
        is row 1, "Human"), now and where the animation started
  - [x] Attack hit shapes with names (hit slot · attack), attack reach line
        and length (the farthest hit edge from the start, over the animation)
  - [x] Root motion start / current transform / trail; sound markers with
        the sound event's name where each plays
  - [x] Helper X-ray mode, per-helper colors
- [x] Camera: orbit, pan, zoom, reset; weapon follow (F)
- [x] In-game lighting from the area's light probes, sun, exposure, backdrop

## Simulation (events acted out during playback)
- [x] Hitboxes per behaviour type → BehaviorParam_PC → AtkParam_Pc shapes
- [x] Active-events list; timeline bars light up while active
- [x] FFX spawns, bullet effects, chained bullets, effect lights, bloom
- [x] SpEffect application: each SpEffect event's own visual effect
      (SpEffectVfxParam midstSfxId at midstDmyId) plays while it's on
- [x] Anim speed gradient (608) changes playback speed while it runs
- [x] Opacity keyframes (193), weapons hidden (710), model masks (711/713)
- [x] Weapon style (how the weapons are held, see Equipment)
- [x] Weapon location overrides (712): while one runs, each weapon model
      goes to its one-handed, other hand's, two-handed or sheathed place
      (WepAbsorpPosParam), when the way it's held matches the event's flags
- [ ] Additive anims (601): listed only (which animation an AnimType
      layers isn't known)
- [x] Sounds: markers and names, and the sounds themselves during playback
      (the Wwise event's sounds from the character's or the player's banks,
      one of a random container's picked by weight, at the bank's loudness
      and pitch; Wwise Vorbis converted to Ogg the way ww2ogg does it). No
      distance, panning or filters; material switches play their default

## Game link
- [x] Force in-game entity reload (F5, File menu): saves, then the running
      game (offline, EAC off) reloads the player's model from the mod
      folder, as DSAS and Smithbox do; "reload after every save" option.
      Patterns checked against the game's exe; the reload itself is only
      testable in game

## Tools
- [x] Combo viewer (F8): animations one after another, cut at their R1 / R2 /
      dodge / any cancel window, a frame or their end; root motion carried
      on, blended, every step's events at their times
- [x] Export skeleton & animations: .glb (model, skeleton and the animation,
      or skeleton and animation), events as text (one animation or a
      category), animation names as JSON; import names (JSON or "a050_030000 =
      Name #tag" lines)

