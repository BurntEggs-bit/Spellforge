# Releasing

## Checklist

1. **Version.** `npm version <x.y.z> --no-git-tag-version`.
2. **Checks.** `npm run typecheck`, `npm run lint` and `npm test` pass.
3. **Notices.** `npm run credits`, so `CREDITS.md` and `THIRD_PARTY_NOTICES.txt` list every credit and every library
   inside the built app.
4. **Videos** (optional): put the walkthrough videos and their chapter lists in `media/tutorial/`, under the names
   `src/shared/videos.ts` lists, to build them in.
5. **Package.** `npm run dist` writes `release/win-unpacked/`. Zip that folder for the release, and try the app from
   the zip before posting it.

## What ships

The package holds only what the app needs at run time:

| Where                          | What                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `Spellforge.exe` and beside it | The Electron runtime, `LICENSE.txt`, `CREDITS.md`, `THIRD_PARTY_NOTICES.txt`, Electron's licences. |
| `resources/app.asar`           | The built app (`out/`), `package.json` and the runtime dependencies (koffi unpacked: it's native). |
| `resources/data`               | The bundled data, each with its licence.                                                  |
| `resources/tutorial`           | The walkthrough videos and their chapter lists, when `media/tutorial` has them.          |

Never in it: the sources, `tests/`, `docs/`, source maps, Oodle's DLL (the app loads the player's own copy from the
game) and anyone's settings.
