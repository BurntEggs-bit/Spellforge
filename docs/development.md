# Development

How to build Spellforge, run it, and check a change. Read [CONTRIBUTING.md](../CONTRIBUTING.md) for the conventions
and [architecture.md](architecture.md) for how the code fits together.

## Requirements

- Windows 10 or 11, 64-bit.
- Node.js 22.18 or newer. The scripts and tests run TypeScript directly, with Node's type stripping.
- Elden Ring installed through Steam, to run the app against (it reads the game and never writes to it).

## Setup

```bash
npm install
```

Install scripts run only for the packages approved in `package.json` (`allowScripts`: Electron, esbuild, koffi). After
upgrading one of them, approve the new version with `npm approve-scripts <package>`.

## Commands

| Command                          | What it does                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run dev`                    | The app, with hot reload of the UI.                                                 |
| `npm run build`                  | Builds the main process, preload and UI into `out/`.                                |
| `npm start`                      | Runs the built app.                                                                 |
| `npm run typecheck`              | Type-checks the Node side (`tsconfig.node.json`) and the UI (`tsconfig.web.json`). |
| `npm run lint`                   | ESLint, including the layer rules ([CONTRIBUTING.md](../CONTRIBUTING.md)).          |
| `npm run format`, `format:check` | Prettier.                                                                           |
| `npm test`                       | The unit tests in `tests/`. A second or two; no game files needed.                  |
| `npm run dist`                   | Packages the app: `release/win-unpacked/Spellforge.exe`.                            |
| `npm run credits`                | Writes `CREDITS.md` and `THIRD_PARTY_NOTICES.txt` from `src/shared/credits.ts`.      |

## Checks

Before calling a change done: `npm run typecheck`, `npm run lint` and `npm test` pass, then `npm run dist` and the
change tried in the built app, against a throwaway mod project.

The unit tests (`tests/*.test.ts`, `node:test`) cover pure logic: id arithmetic (dummy polys, BehaviorParam rows,
animation names), the animation decoder's B-splines and quantisation, effect transforms, texture encoding, small shared
helpers, and that every `Credit:` line in the code names a credited work.

What the app writes into a mod is best checked in game. Say what you tried and what you couldn't.

## Bundled data

`data/er` holds the data the app ships, each part with its licence beside it:

| Data                                                                   | From                         | Licence                        |
| ---------------------------------------------------------------------- | ---------------------------- | ------------------------------ |
| `Defs`, `Param Meta`, `Param Annotations`, `Param Enums`, `Param Row Names`, `Field Layouts`, `Aliases`, `file-dictionary.txt` | Smithbox (`SOURCE.json` has its version) | MIT (`LICENSE-Smithbox.txt`) |
| `tae-template.json`                                                    | DS Anim Studio               | MIT (`LICENSE-DSAS.txt`)       |
| `wwise/`                                                               | ww2ogg's Vorbis codebooks     | BSD-3-Clause (`wwise/COPYING-ww2ogg.txt`) |

Everything else is read from the player's own game. The community FXR ID sheet's effect names
(`data/er/effect-names.json`) aren't in this repository, as the sheet states no licence: import its CSV in the app
(start screen, **Sources**, **Effect names**).

After changing a credit in `src/shared/credits.ts`, or a dependency, run `npm run credits` so `CREDITS.md` and
`THIRD_PARTY_NOTICES.txt` match.

## Adding a feature

1. Add its channel to the API contract (`src/shared/api/<area>.ts`): the request and the response types.
2. Handle it in `src/main/dispatch.ts` with a Session or service call. A call that changes the project also goes in
   `CHANGES`, so the crash journal can replay it.
3. Implement it in the service for its area (`src/main/services/`), on top of `src/core`. Multi-step operations that
   span several services go in `src/main/workflows/`.
4. Build the UI in `src/renderer/<area>/`, calling the channel through the API client.
5. Check it: a unit test for pure logic, and the feature tried in the built app on a throwaway project.
