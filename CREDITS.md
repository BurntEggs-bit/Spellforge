# Credits

Spellforge stands on the work of the souls modding community and of open-source projects. Each is listed once, under the main way Spellforge uses it. Code that uses one names it in a `Credit:` line. The licence texts the app ships with are in THIRD_PARTY_NOTICES.txt.

Spellforge is released under the MIT No Attribution licence (MIT-0): anyone may use, copy, change, borrow from and share it, for any purpose, with no permission needed and no credit owed. The work it includes or adapts keeps its own licence, listed in THIRD_PARTY_NOTICES.txt beside Spellforge.exe.

SoulsFormats, SoulsFormatsNEXT, Havok Format Library and SoulsAssetPipeline are GPL-3.0, a copyleft licence: an app that uses, modifies or links their code and is distributed must be released under GPL-3.0 as a whole. Spellforge only reads them to learn the game’s file formats and writes its own code. None of theirs is copied into it, linked by it or shipped with it, so Spellforge keeps its own licence.

_ELDEN RING © Bandai Namco Entertainment Inc. / © FromSoftware, Inc. Spellforge is an unofficial, fan-made tool, not affiliated with or endorsed by FromSoftware or Bandai Namco. It reads the player’s own copy of the game; no game files ship with the app._

## Data Spellforge ships

- **[Smithbox](https://github.com/vawser/Smithbox)**, by Vawser and contributors (from DSMapStudio by Katalash and Meowmaritus) (MIT): Param definitions, field descriptions, value lists, field layouts (the Inspector’s groups) and the community’s row names; the alias lists behind “What is this ID?”; the game’s file name dictionary. How it writes params and reloads them in the running game.
- **[DS Anim Studio](https://github.com/Meowmaritus/DSAnimStudio)**, by Meowmaritus and contributors (MIT): The Elden Ring animation event template (event names and fields). Its editing workflow, combo viewer and in-game reload (F5) are the model for the Animations page.
- **[FXR ID sheet](https://docs.google.com/spreadsheets/d/1gmUiSpJtxFFl0g04MWMIIs37W13Yjp-WUxtbyv99JIQ)**, by the souls modding community: Rayan, MyGoodSir, Rodan, Rusty., Evanlyn, Bruhballs, Challenger Andy, CCCode, lugia19, Pandamygdala: Names and notes for the game’s effects.

## Code Spellforge adapts

- **[ww2ogg](https://github.com/hcs64/ww2ogg)**, by Adam Gashlin (hcs) (BSD-3-Clause): How Wwise’s Vorbis audio is turned back into Ogg Vorbis (Spellforge follows its algorithm), and its packed codebooks, so the viewer can play the game’s sounds.
- **[Vorbis](https://xiph.org/vorbis/)**, by Xiph.org Foundation; codebooks tuned by aoTuV (Aoyumi) (BSD-3-Clause): The Vorbis I format, Tremor’s codebook rules, and the aoTuV 6.03 codebooks Wwise’s sounds are encoded with.
- **[Lua 5.1](https://www.lua.org)**, by Lua.org, PUC-Rio (MIT): The behaviour script compiler is a port of Lua 5.1.5’s parser and code generator (lparser.c, lcode.c); the lexer and parser follow its grammar.
- **[hksc](https://github.com/Jake-NotTheMuss/hksc)**, by Jake-NotTheMuss (MIT, on Lua’s terms): HavokScript’s opcode numbering and operand modes, and its bytecode layout.
- **[bcdec](https://github.com/iOrange/bcdec)**, by Sergii “iOrange” Kudlai (MIT or Unlicense): The BC6H texture decoder (the game’s light probes) is a port of it.

## Formats and behaviour learned from their documentation

- **[SoulsFormats](https://github.com/JKAnderson/SoulsFormats)**, by TKGP and contributors (GPL-3.0; read as documentation only): The layouts of the game’s file formats: BND4, BHD5, DCX, FLVER, PARAM and PARAMDEF, FMG, EMEVD, ESD, MATBIN, MSB and TPF, and their names for FLVER’s layout types and BND4’s flags.
- **[SoulsFormatsNEXT](https://github.com/soulsmods/SoulsFormatsNEXT)**, by the soulsmods community, continuing TKGP’s SoulsFormats (GPL-3.0; read as documentation only): The same layouts as the community keeps them up to date for Elden Ring.
- **[Havok Format Library](https://github.com/PredatorCZ/HavokLib)**, by Lukas Cone (PredatorCZ) (GPL-3.0; read as documentation only): How spline-compressed animations and their quantised rotations are stored.
- **[SoulsAssetPipeline](https://github.com/Meowmaritus/SoulsAssetPipeline)**, by Meowmaritus and Katalash (GPL-3.0; read as documentation only): How the game’s animation files are laid out and played.
- **[BinderTool](https://github.com/Atvaark/BinderTool)**, by Atvaark: The game archives’ encryption keys and the BHD5 header layout.
- **[UXM Selective Unpack](https://github.com/Nordgaren/UXM-Selective-Unpack)**, by TKGP and Nordgaren: The game archives’ encryption keys, and reading the archives the way it unpacks them.
- **[wwiser](https://github.com/bnnm/wwiser)**, by bnnm: The layouts of Wwise sound banks.
- **[FXR Playground](https://fxr-playground.pages.dev/guides)**, by the FXR Playground guides’ authors: How effects are put together, and the recolouring advice in the effect inspector.
- **The NURBS Book**, by Les Piegl and Wayne Tiller: The B-spline algorithms the animation decoder uses (A2.1, A2.2).

## Techniques and designs learned from their mods and tools

- **[er_soundbank_helper](https://github.com/ndahn/er_soundbank_helper)**, by ndahn (MIT): How sounds copied into another bank are placed so the game keeps loading it: the bank writer places them the same way.
- **[ERClipGeneratorTool](https://github.com/The12thAvenger/ERClipGeneratorTool)**, by The12thAvenger (MIT): Registering new animations in the behaviour graph: Spellforge adds the same clips it does.
- **[Syyyke](https://www.youtube.com/watch?v=orzGXBcUUhs)**, by Syyyke (“Elden Ring Moveset Tutorial”, parts 1–3): The moveset workflow Spellforge builds in: a weapon’s own animation category, combo length, a behaviour copied so any weapon can fire it, jump attack landings bound to TimeActEditor_10, and Barbaric Roar’s second heavy set.
- **[Souls Modding wiki](https://soulsmodding.wikidot.com)**, by the Souls Modding wiki’s authors (CC BY-SA 3.0): The community’s guides: the event script techniques the Events page’s recipes follow (the boss fight pattern, the item lot test marker), and the workflows the tutorials teach.
- **[Clever](https://www.nexusmods.com/eldenring/mods/4649)**, by Clever (Sacred Arsenal, Moveset Modpack): Behaviour script techniques (animation jumps and chains, the two-hand button as a transform, special attacks), studied in his mods; the “Recreating Sacred Arsenal” video rebuilds his mod’s ideas. Nothing of his is copied or shipped.
- **[EldenRingHKS](https://github.com/ividyon/EldenRingHKS)**, by ividyon, Vawser, Exelot and the souls modding community: The community’s annotated behaviour script (c0000.hks): what the script’s functions and ids do, studied for the behaviour recipes. Not shipped.

## Libraries

- **[@cccode/fxr](https://github.com/EvenTorset/fxr)**, by CCCode (Unlicense): Reading, editing and writing effects (FXR), and its documentation of every effect action and field.
- **[Electron](https://www.electronjs.org)**, by OpenJS Foundation and contributors (with Chromium and Node.js) (MIT): The application shell.
- **[React](https://react.dev)**, by Meta Platforms, Inc. (MIT): The UI.
- **[three.js](https://threejs.org)**, by the three.js authors (MIT): The 3D viewer and the effect preview.
- **[dockview](https://dockview.dev)**, by mathuo (MIT): Dockable panels and pop-out windows.
- **[fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser)**, by Amit Kumar Gupta (MIT): Reading the param definitions.
- **[koffi](https://koffi.dev)**, by Niels Martignène (MIT): Calling the game’s Oodle library and the in-game reload.
- **Oodle**, by RAD Game Tools (Epic Games): Unpacking and packing the game’s Kraken-compressed files, with the oo2core library from the player’s own game folder (not shipped with Spellforge).

## Built with

Written with Claude, Anthropic’s AI model, a co-author of the repository.

TypeScript, Vite, electron-vite, electron-builder, ESLint and Prettier (development only, not part of the app).
