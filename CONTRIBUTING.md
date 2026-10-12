# Contributing

How changes to Spellforge are made. [docs/development.md](docs/development.md) covers the setup and the commands,
[docs/architecture.md](docs/architecture.md) how the code fits together.

## Ground rules

- **The game folder is never written to.** Every write into a project goes through `Project.writeProjectFile`
  (`src/core/project/project.ts`), which refuses any path outside the project or inside the game folder and backs up
  what it replaces. Nothing else writes into a project.
- **No network code in the app.** It reads the player's own game and writes their project, nothing more.
- **What the UI claims gets checked:** against the game's own files, or by looking at it in the built app. What can
  only be seen in game is said to be untested until someone has tried it in game.

## Code layout

The code is in layers, each importing only from the layers below it. ESLint (`no-restricted-imports`) and the two
TypeScript projects enforce it.

| Layer           | Holds                                                                                       | May import       |
| --------------- | ------------------------------------------------------------------------------------------- | ---------------- |
| `src/shared`    | The API contract between the processes (`api/`), credits, small pure helpers.               | nothing else     |
| `src/core`      | Libraries: file formats, params, effects, animation, behaviour scripts. No Electron, no UI. | `shared`         |
| `src/main`      | The Electron main process: the session, a service per area, workflows, IPC, windows.        | `core`, `shared` |
| `src/preload`   | The bridge the UI calls the main process through.                                           | `shared`         |
| `src/renderer`  | The React UI. Reaches the main process only through the API client.                         | `shared`         |

`tests/` holds the unit tests and `scripts/` the script that writes the credits and notices; neither ships.

## Conventions

- **TypeScript, strict.** No `any`: type what you know, and use `unknown` and narrow what you don't. Type-only imports
  use `import type`. Node runs the sources directly with type stripping, so `verbatimModuleSyntax` and
  `erasableSyntaxOnly` are on: no enums, namespaces or parameter properties.
- **Names.** Modules are camelCase files named for what they hold (`paramDb.ts`, `animationFile.ts`); React components
  are PascalCase files named for the component (`RowInspector.tsx`); hooks are named for the hook
  (`useAnimationsPage.ts`); command-line scripts are kebab-case (`check-package.ts`). In code: camelCase for functions
  and variables, PascalCase for types, classes and components, UPPER_SNAKE_CASE for constants.
- **One responsibility per module.** Split a file before it becomes a grab-bag, keep functions small and named for what
  they do, and reuse the shared helper (vector math, binary readers, param access, dummy poly frames) rather than
  writing another.
- **Comments say what the code does and why, as it is now.** Every module starts with a doc comment saying what it is
  for; exported functions and types say what they promise. History, dates, test stories and commented-out code don't
  belong in code: they go in commit messages or the format notes.
- **Errors** are `Error`s whose message tells a modder what's wrong and, when it can, what fixes it.
  `errorMessage()` (`src/shared/errors.ts`) turns anything caught into text.
- **The UI is an editor, not a tutorial.** A field lives in the field list with the others; a selected thing's actions
  sit in its header toolbar; field and option descriptions are kept, explanations of how Spellforge works go in
  tooltips; empty states are one line; warnings are for real problems and say what fixes them.
- **Formatting** is Prettier's and **lint** is ESLint's; both must be clean (`npm run format`, `npm run lint`).

## Credits and licences

Spellforge is released under the MIT No Attribution licence (MIT-0): anyone may use it with no credit owed, and a
contribution is made under the same terms. It builds on others' work, which does ask for credit, so every use of
someone's work is credited where it happens.

- Add the work to `src/shared/credits.ts`: who made it, where it is, its licence, and what Spellforge uses it for. Then
  `npm run credits` updates `CREDITS.md` and `THIRD_PARTY_NOTICES.txt`.
- Mark the code that follows it with a `Credit:` line in the module's doc comment, naming the work as `credits.ts`
  names it; `npm test` checks that every such line does.

  ```ts
  /**
   * Evaluating a B-spline at a parameter, with the standard algorithms of
   * Piegl and Tiller, The NURBS Book (2nd ed.).
   *
   * Credit: The NURBS Book (Les Piegl and Wayne Tiller): the algorithms named above.
   */
  ```

- Code may be adapted only from permissively licensed work (MIT, BSD, Unlicense and the like), and its licence then
  ships in `THIRD_PARTY_NOTICES.txt`. GPL code (SoulsFormats and SoulsFormatsNEXT, the Havok Format Library,
  SoulsAssetPipeline) is documentation only: read it to understand a format, then write Spellforge's own code. Never
  copy, port, link or bundle it, its DLLs included (`SoulsFormats.dll`, Smithbox's `Andre.SoulsFormats.dll`):
  GPL-3.0 is copyleft, so an app that uses, modifies or links GPL code and is distributed must be released under
  GPL-3.0 as a whole, and Spellforge is MIT-0.
- Other modders' mods and scripts are studied for their techniques, never copied or shipped; credit them wherever their
  ideas show. DarkScript3's EMEDF and the community's EldenRingHKS script text are never bundled.
- No game files ship. The app reads the player's own copy, the game's Oodle DLL included.

## Before you submit

1. `npm run typecheck`, `npm run lint` and `npm test` pass.
2. A visible change has been looked at in the built app, and what it writes into a mod tried on a throwaway project.
3. `npm run dist` builds.

Commits are small and do one thing. The message starts with a short summary in the imperative ("Fit held effects to
the hand"), then says why, when that isn't obvious.
