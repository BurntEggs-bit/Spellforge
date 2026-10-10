# Architecture

Spellforge is an Electron app. The **main process** owns every file and all state: it reads the game, keeps the open
project in memory and writes the project on save. The **renderer** is a React UI that shows that state and asks for
changes. Between them is a typed request/response API, and nothing else: the UI never touches a file.

```
renderer (React)                    preload                  main process
────────────────                    ───────                  ────────────
call('row:set', request) ──────────▶ window.spellforge ─IPC─▶ dispatch.ts ──▶ Session / service ──▶ src/core
        ▲                                                                            │
        └──────────────────────── value, or an Error with the message ◀──────────────┘
```

## Layers

Each layer imports only from the layers below it; ESLint's `no-restricted-imports` and the two TypeScript projects
(`tsconfig.node.json` for the Node side, `tsconfig.web.json` for the UI) enforce it.

| Layer          | Holds                                                                                     | Imports           |
| -------------- | ----------------------------------------------------------------------------------------- | ----------------- |
| `src/shared`   | The API contract, credits, small pure helpers both processes use.                         | nothing else      |
| `src/core`     | Libraries: file formats, params, effects, animation, behaviour scripts.                   | `shared`          |
| `src/main`     | The main process: the session, a service per area, workflows, IPC, windows.               | `core`, `shared`  |
| `src/preload`  | The bridge the UI calls through.                                                          | `shared`          |
| `src/renderer` | The UI.                                                                                   | `shared`          |

## `src/shared`: the contract

- `api.ts` re-exports `api/<area>.ts`: every channel's request and response types, grouped by area (params, effects,
  animations, character, enemies, moveset, behaviour, scale, ids, text, project, setup), and `api/channels.ts`, the map
  from each channel name to its `[request, response]` pair (`Api`, `Channel`). Everything crossing IPC is plain JSON
  described there.
- Helpers both sides need: `animIds.ts` (what an animation id is, in words), `frames.ts` (animation time in frames, at
  30 per second), `recipes.ts` (behaviour recipes as data: labels and checks), `coating.ts` (where a weapon buff coats
  the blade), `videos.ts` (the walkthrough videos), `credits.ts`, `format.ts` (counts with their nouns, sizes),
  `errors.ts`, `collections.ts`.

## `src/core`: the libraries

Plain TypeScript: no Electron, no UI. Each module reads or writes one thing, and the verify suites check each against
the game's own files.

| Folder       | Holds                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| `formats/`   | One module per file format. Containers: `dcx` (with `oodle`, through the game's own DLL), `bnd4`, `bhd5` and `archiveKeys` (the packed game), `regulation`. Models and textures: `flver`, `matbin`, `textures` (BCn), `bc6h`. Text: `fmg`. Animation: `tae`, `taeFile`, and `havok/` (the tagfile, its objects, skeletons, and spline-compressed animations: decoding with `splineBlock`, `quantization` and `bspline`, writing with `animationFile`). Behaviour scripts: `hks/` (bytecode, lexer, parser, compiler, decompiler, disassembler, comparison). Sound: `wwise`, `wemVorbis`. Game scripts and maps: `emevd`, `esd`, `msb`. Menus: `menuLayout`. |
| `params/`    | `paramDef` (row layouts from Smithbox's definitions), `param` (one param's rows), `paramDb` (the regulation's params), `paramMeta` (Smithbox's references between params), `hints`, `clone` (planning a duplicate), `upgrade` (the three-way merge after a game update), `diff`, `workflow`, `behaviorIds`. |
| `effects/`   | `effects` (the effect library over the bundles), `preview` (an effect as the preview plays it), `fxEdit` (field editing), `fxrFields` (reading @cccode/fxr's objects by field name), `environment` (light probes), `modelAnim`. |
| `animation/` | `animations` (TAE binders and events), `behavior` (registering animations in the behaviour graph), `character` (body, armour and weapon models), `retarget` (an enemy's motion fitted to the player), `dummies` (dummy poly ids and frames). |
| `behavior/`  | `recipes` (behaviour recipes written as HavokScript), `lint` (the script editor's checks).                 |
| `project/`   | `project` (the mod folder over the game, and the write guard), `files`, `gameFiles` (the Steam install and its archives), `vanilla` (each game version's files, kept), `text` and `textEdit`, `eventScripts`, `mapIndex`, `packing`. |
| `math/`      | `vector`, `quaternion`.                                                                                     |

## `src/main`: the main process

- `index.ts` starts the app: the session, the `app://spellforge` scheme the UI is served from (`protocol.ts`), the
  windows (`windows.ts`: secure preferences, navigation confined to the app's own pages; `walkthrough.ts`: the video
  window), and the IPC handlers.
- `session.ts` holds all state: the settings and the open project. Opening a project creates an `Open` record with its
  param database, effect library, records and a fresh set of services, so nothing cached for one project survives into
  another. `save()` writes what changed, through `Project.writeProjectFile`.
- `services/` has one service per area, created per project: `params`, `text`, `effects`, `assets` (textures, models,
  icons, light probes), `clone`, `gameUpdate`, `animations`, `character` (the viewer's character), `enemies`, `sounds`,
  `icons`, `ids` ("What is this ID?"), `behavior` (the behaviour script), `recovery` (the crash journal) and `gameLink`
  (F5). Each takes the session and reaches the others through it.
- `workflows/` holds operations that span several services: `enemyMoves` (an enemy's move made the player's),
  `moveset`, `scale`.
- `dispatch.ts` maps every channel to its handler, for Electron's IPC and the browser harness alike. Channels that
  change the project are listed in `CHANGES`: each successful call is journaled until the next save, so a crash can
  replay them.

## `src/renderer`: the UI

React 19, laid out with dockview (panels that rearrange, stack and pop out into their own windows), the viewers drawn
with three.js.

| Folder        | Holds                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| `app/`        | The shell: `App` (the start screen), the workspace and top bar, docking and pop-out windows, navigation (Back / Forward), saving and F5, themes, recovery, the walkthrough window and About. |
| `params/`     | The Params page: Browse, the row Inspector and its dialogs, the reference tree, Duplicate and Scale.        |
| `effects/`    | The effect Inspector, parts editor and resource slots; `preview/`, the effect preview scene.                  |
| `animations/` | The Animations page: its lists and panels, `editor/` (the timeline and event inspector), `dialogs/`, Moveset, and `behaviour/` (the recipes and the script editor). |
| `enemies/`    | The Enemies page: `panels/` and the Make it… `dialogs/`.                                                      |
| `viewer/`     | The character viewer used by Animations and Enemies: the scene (`scene/`: pose, parts, weapons, dummy polys, overlays), what events do (`sim/`: bullets, lights, effect runs), equipment, helpers, lighting, the play clock, sounds, glTF export. |
| `fx/`         | The particle engine both the preview and the viewer draw effects with: emitters, curves, shaders, textures, models. |
| `text/`       | The Text page and its `panels/`.                                                                             |
| `ids/`        | "What is this ID?".                                                                                           |
| `shared/`     | UI building blocks: modals, menus, split panes, icons, the ID picker.                                        |
| `lib/`        | Plain helpers: the IPC client (`ipc.ts`), the caches a project opening empties (`projectCaches.ts`), colour and math, saved preferences, hooks, the render loop. |
| `styles/`     | The stylesheets, by area.                                                                                    |
| `tutorial/`   | The walkthrough window's page.                                                                               |

Each page keeps its state in a hook (`useAnimationsPage`, `useEnemiesPage`, `useTextPage`; the Params page's is built
by the workspace, which navigates it) and hands it to its dock panels through a context in its `pageContext.ts` (`useAnimations()`,
`useEnemies()`, `useText()`, `useParams()`). The UI calls the main process through `lib/ipc.ts`, typed by the
contract in `src/shared/api`.

## How a feature flows

Take "set a field of a row":

1. The Inspector calls `call('row:set', { param, id, field, value })`.
2. The preload passes it to the main process over IPC; `dispatch.ts` finds the `row:set` handler and calls the params
   service. The channel is in `CHANGES`, so the call is journaled.
3. The service changes the row in the open project's `paramDb` and returns the row's new view, which the UI shows.
4. Nothing is written until Save: `session.save()` asks each part what changed and writes those files through
   `Project.writeProjectFile`, which backs up what it replaces and clears the journal.

[development.md](development.md#adding-a-feature) lists the steps for adding one.

## Data and files

| What                                   | Where                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------- |
| The game (read only)                   | Its Steam install, read through `gameFiles.ts`, or an unpacked copy         |
| The project                            | The `mod` folder; Spellforge's records in `mod\.spellforge\`                |
| Backups of replaced files              | `.spellforge-backups\<time>\` beside the `mod` folder                       |
| Bundled data                           | `data/er` (`resources/data` in the package)                                 |
| Settings, crash journals, caches       | `%APPDATA%\spellforge`: `settings.json`, `recovery\`, `archive-cache\`, `icon-cache\`, `vanilla\<version>\` |

## Builds

electron-vite builds three bundles: the main process (ESM; dependencies stay in `node_modules`, koffi being native),
the preload (CommonJS, as sandboxed preloads must be) and the UI (three pages: the app, the blank page panels pop out
into, the walkthrough window). electron-builder packages
the app with the data and videos as resources; [releasing.md](releasing.md#what-ships) lists what ships.

## Checks

- `tests/`: unit tests of pure logic (`npm test`).

[development.md](development.md#checks) describes each.
