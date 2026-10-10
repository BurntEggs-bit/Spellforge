/**
 * Everyone whose work Spellforge uses or learned from. The About page shows
 * this list; `npm run credits` writes it to CREDITS.md (its notices to ABOUT.md) and gathers the
 * licence texts the app ships with into THIRD_PARTY_NOTICES.txt. Code that
 * uses one of these names it in a `Credit:` line, and a test checks that
 * every such line names an entry here.
 */

/** How Spellforge uses someone's work. */
export type CreditKind =
  /** Data files Spellforge ships. The first kind listed is the main one. */
  | 'data'
  /** Code Spellforge ported or adapted (its licence ships with the app). */
  | 'code'
  /** Formats or behaviour learned from their documentation or tools; Spellforge's code is its own. */
  | 'docs'
  /** Modding techniques and designs learned from their mods or tools. */
  | 'technique'
  /** Libraries Spellforge is built on. */
  | 'library'

/** The kinds in the order lists show them, each with its heading. A credit is listed once, under its first kind. */
export const CREDIT_SECTIONS: [CreditKind, string][] = [
  ['data', 'Data Spellforge ships'],
  ['code', 'Code Spellforge adapts'],
  ['docs', 'Formats and behaviour learned from their documentation'],
  ['technique', 'Techniques and designs learned from their mods and tools'],
  ['library', 'Libraries'],
]

export interface Credit {
  /** The work, as `Credit:` lines in the code name it. */
  name: string
  by: string
  url?: string
  /** Its licence, when it states one. */
  license?: string
  kinds: CreditKind[]
  /** What Spellforge uses it for. */
  use: string
}

export const CREDITS: Credit[] = [
  {
    name: 'Smithbox',
    by: 'Vawser and contributors (from DSMapStudio by Katalash and Meowmaritus)',
    url: 'https://github.com/vawser/Smithbox',
    license: 'MIT',
    kinds: ['data', 'technique'],
    use: 'Param definitions, field descriptions, value lists, field layouts (the Inspector’s groups) and the community’s row names; the alias lists behind “What is this ID?”; the game’s file name dictionary. How it writes params and reloads them in the running game.',
  },
  {
    name: 'DS Anim Studio',
    by: 'Meowmaritus and contributors',
    url: 'https://github.com/Meowmaritus/DSAnimStudio',
    license: 'MIT',
    kinds: ['data', 'technique'],
    use: 'The Elden Ring animation event template (event names and fields). Its editing workflow, combo viewer and in-game reload (F5) are the model for the Animations page.',
  },
  {
    name: 'FXR ID sheet',
    by: 'the souls modding community: Rayan, MyGoodSir, Rodan, Rusty., Evanlyn, Bruhballs, Challenger Andy, CCCode, lugia19, Pandamygdala',
    url: 'https://docs.google.com/spreadsheets/d/1gmUiSpJtxFFl0g04MWMIIs37W13Yjp-WUxtbyv99JIQ',
    kinds: ['data'],
    use: 'Names and notes for the game’s effects.',
  },
  {
    name: 'ww2ogg',
    by: 'Adam Gashlin (hcs)',
    url: 'https://github.com/hcs64/ww2ogg',
    license: 'BSD-3-Clause',
    kinds: ['code', 'data'],
    use: 'How Wwise’s Vorbis audio is turned back into Ogg Vorbis (Spellforge follows its algorithm), and its packed codebooks, so the viewer can play the game’s sounds.',
  },
  {
    name: 'Vorbis',
    by: 'Xiph.org Foundation; codebooks tuned by aoTuV (Aoyumi)',
    url: 'https://xiph.org/vorbis/',
    license: 'BSD-3-Clause',
    kinds: ['code', 'docs'],
    use: 'The Vorbis I format, Tremor’s codebook rules, and the aoTuV 6.03 codebooks Wwise’s sounds are encoded with.',
  },
  {
    name: 'Lua 5.1',
    by: 'Lua.org, PUC-Rio',
    url: 'https://www.lua.org',
    license: 'MIT',
    kinds: ['code'],
    use: 'The behaviour script compiler is a port of Lua 5.1.5’s parser and code generator (lparser.c, lcode.c); the lexer and parser follow its grammar.',
  },
  {
    name: 'hksc',
    by: 'Jake-NotTheMuss',
    url: 'https://github.com/Jake-NotTheMuss/hksc',
    license: 'MIT, on Lua’s terms',
    kinds: ['code', 'docs'],
    use: 'HavokScript’s opcode numbering and operand modes, and its bytecode layout.',
  },
  {
    name: 'bcdec',
    by: 'Sergii “iOrange” Kudlai',
    url: 'https://github.com/iOrange/bcdec',
    license: 'MIT or Unlicense',
    kinds: ['code'],
    use: 'The BC6H texture decoder (the game’s light probes) is a port of it.',
  },
  {
    name: 'SoulsFormats',
    by: 'TKGP and contributors',
    url: 'https://github.com/JKAnderson/SoulsFormats',
    license: 'GPL-3.0; read as documentation only',
    kinds: ['docs'],
    use: 'The layouts of the game’s file formats: BND4, BHD5, DCX, FLVER, PARAM and PARAMDEF, FMG, EMEVD, ESD, MATBIN, MSB and TPF, and their names for FLVER’s layout types and BND4’s flags.',
  },
  {
    name: 'SoulsFormatsNEXT',
    by: 'the soulsmods community, continuing TKGP’s SoulsFormats',
    url: 'https://github.com/soulsmods/SoulsFormatsNEXT',
    license: 'GPL-3.0; read as documentation only',
    kinds: ['docs'],
    use: 'The same layouts as the community keeps them up to date for Elden Ring.',
  },
  {
    name: 'Havok Format Library',
    by: 'Lukas Cone (PredatorCZ)',
    url: 'https://github.com/PredatorCZ/HavokLib',
    license: 'GPL-3.0; read as documentation only',
    kinds: ['docs'],
    use: 'How spline-compressed animations and their quantised rotations are stored.',
  },
  {
    name: 'SoulsAssetPipeline',
    by: 'Meowmaritus and Katalash',
    url: 'https://github.com/Meowmaritus/SoulsAssetPipeline',
    license: 'GPL-3.0; read as documentation only',
    kinds: ['docs'],
    use: 'How the game’s animation files are laid out and played.',
  },
  {
    name: 'BinderTool',
    by: 'Atvaark',
    url: 'https://github.com/Atvaark/BinderTool',
    kinds: ['docs'],
    use: 'The game archives’ encryption keys and the BHD5 header layout.',
  },
  {
    name: 'UXM Selective Unpack',
    by: 'TKGP and Nordgaren',
    url: 'https://github.com/Nordgaren/UXM-Selective-Unpack',
    kinds: ['docs'],
    use: 'The game archives’ encryption keys, and reading the archives the way it unpacks them.',
  },
  {
    name: 'wwiser',
    by: 'bnnm',
    url: 'https://github.com/bnnm/wwiser',
    kinds: ['docs'],
    use: 'The layouts of Wwise sound banks.',
  },
  {
    name: 'er_soundbank_helper',
    by: 'ndahn',
    url: 'https://github.com/ndahn/er_soundbank_helper',
    license: 'MIT',
    kinds: ['technique'],
    use: 'How sounds copied into another bank are placed so the game keeps loading it: the bank writer places them the same way.',
  },
  {
    name: 'ERClipGeneratorTool',
    by: 'The12thAvenger',
    url: 'https://github.com/The12thAvenger/ERClipGeneratorTool',
    license: 'MIT',
    kinds: ['technique'],
    use: 'Registering new animations in the behaviour graph: Spellforge adds the same clips it does.',
  },
  {
    name: 'Syyyke',
    by: 'Syyyke (“Elden Ring Moveset Tutorial”, parts 1–3)',
    url: 'https://www.youtube.com/watch?v=orzGXBcUUhs',
    kinds: ['technique'],
    use: 'The moveset workflow Spellforge builds in: a weapon’s own animation category, combo length, a behaviour copied so any weapon can fire it, jump attack landings bound to TimeActEditor_10, and Barbaric Roar’s second heavy set.',
  },
  {
    name: 'Souls Modding wiki',
    by: 'the Souls Modding wiki’s authors',
    url: 'https://soulsmodding.wikidot.com',
    license: 'CC BY-SA 3.0',
    kinds: ['technique', 'docs'],
    use: 'The community’s guides: the event script techniques the Events page’s recipes follow (the boss fight pattern, the item lot test marker), and the workflows the tutorials teach.',
  },
  {
    name: 'FXR Playground',
    by: 'the FXR Playground guides’ authors',
    url: 'https://fxr-playground.pages.dev/guides',
    kinds: ['docs'],
    use: 'How effects are put together, and the recolouring advice in the effect inspector.',
  },
  {
    name: 'The NURBS Book',
    by: 'Les Piegl and Wayne Tiller',
    kinds: ['docs'],
    use: 'The B-spline algorithms the animation decoder uses (A2.1, A2.2).',
  },
  {
    name: 'Clever',
    by: 'Clever (Sacred Arsenal, Moveset Modpack)',
    url: 'https://www.nexusmods.com/eldenring/mods/4649',
    kinds: ['technique'],
    use: 'Behaviour script techniques (animation jumps and chains, the two-hand button as a transform, special attacks), studied in his mods; the “Recreating Sacred Arsenal” video rebuilds his mod’s ideas. Nothing of his is copied or shipped.',
  },
  {
    name: 'EldenRingHKS',
    by: 'ividyon, Vawser, Exelot and the souls modding community',
    url: 'https://github.com/ividyon/EldenRingHKS',
    kinds: ['technique', 'docs'],
    use: 'The community’s annotated behaviour script (c0000.hks): what the script’s functions and ids do, studied for the behaviour recipes. Not shipped.',
  },
  {
    name: '@cccode/fxr',
    by: 'CCCode',
    url: 'https://github.com/EvenTorset/fxr',
    license: 'Unlicense',
    kinds: ['library', 'docs'],
    use: 'Reading, editing and writing effects (FXR), and its documentation of every effect action and field.',
  },
  {
    name: 'Electron',
    by: 'OpenJS Foundation and contributors (with Chromium and Node.js)',
    url: 'https://www.electronjs.org',
    license: 'MIT',
    kinds: ['library'],
    use: 'The application shell.',
  },
  {
    name: 'React',
    by: 'Meta Platforms, Inc.',
    url: 'https://react.dev',
    license: 'MIT',
    kinds: ['library'],
    use: 'The UI.',
  },
  {
    name: 'three.js',
    by: 'the three.js authors',
    url: 'https://threejs.org',
    license: 'MIT',
    kinds: ['library'],
    use: 'The 3D viewer and the effect preview.',
  },
  {
    name: 'dockview',
    by: 'mathuo',
    url: 'https://dockview.dev',
    license: 'MIT',
    kinds: ['library'],
    use: 'Dockable panels and pop-out windows.',
  },
  {
    name: 'fast-xml-parser',
    by: 'Amit Kumar Gupta',
    url: 'https://github.com/NaturalIntelligence/fast-xml-parser',
    license: 'MIT',
    kinds: ['library'],
    use: 'Reading the param definitions.',
  },
  {
    name: 'koffi',
    by: 'Niels Martignène',
    url: 'https://koffi.dev',
    license: 'MIT',
    kinds: ['library'],
    use: 'Calling the game’s Oodle library and the in-game reload.',
  },
  {
    name: 'Oodle',
    by: 'RAD Game Tools (Epic Games)',
    kinds: ['library'],
    use: 'Unpacking and packing the game’s Kraken-compressed files, with the oo2core library from the player’s own game folder (not shipped with Spellforge).',
  },
]

/**
 * The GPL-3.0 works in the list, and why their copyleft doesn't reach
 * Spellforge: the GPL covers software that uses, modifies or links their
 * code, and Spellforge only reads them to learn the game's formats.
 */
const GPL_WORKS = CREDITS.filter((c) => /^GPL/.test(c.license ?? '')).map((c) => c.name)
export const GPL_NOTICE = `${GPL_WORKS.slice(0, -1).join(', ')} and ${GPL_WORKS.at(-1)} are GPL-3.0, a copyleft licence: an app that uses, modifies or links their code and is distributed must be released under GPL-3.0 as a whole. Spellforge only reads them to learn the game’s file formats and writes its own code. None of theirs is copied into it, linked by it or shipped with it, so Spellforge keeps its own licence.`

/**
 * Spellforge's own licence in words: MIT No Attribution, so its code can be used, copied and learned from with no
 * permission asked and no credit owed. What it includes or adapts keeps its own licence (THIRD_PARTY_NOTICES).
 */
export const LICENSE_NOTICE =
  'Spellforge is released under the MIT No Attribution licence (MIT-0): anyone may use, copy, change, borrow from and share it, for any purpose, with no permission needed and no credit owed. The work it includes or adapts keeps its own licence, listed in THIRD_PARTY_NOTICES.txt beside Spellforge.exe.'

/** The game itself: Spellforge reads the player's own copy and isn't affiliated with its makers. */
export const GAME_NOTICE =
  'ELDEN RING © Bandai Namco Entertainment Inc. / © FromSoftware, Inc. Spellforge is an unofficial, fan-made tool, not affiliated with or endorsed by FromSoftware or Bandai Namco. It reads the player’s own copy of the game; no game files ship with the app.'
