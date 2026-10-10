# Walkthrough videos

`npm run dist` packs the walkthrough videos and their chapter lists from this folder into the app
(`resources/tutorial`), where the walkthrough window (Help > Walkthrough) plays them. They're far too large for git,
so this repository leaves them out: copy them from a release's `resources/tutorial` folder.

- `Spellforge-Tutorial.mp4` and `chapters.json`: the walkthrough;
- `Spellforge-Moveset-Example.mp4` and `moveset-example-chapters.json`: "Another example of a moveset";
- `Spellforge-Effect-Editor.mp4` and `effect-editor-chapters.json`: "The effect editor";
- `Spellforge-Recreating-Sacred-Arsenal.mp4` and `sacred-arsenal-chapters.json`: "Recreating Clever's Sacred
  Arsenal" (Sacred Arsenal is Clever's mod; the video credits him);
- `Spellforge-Behaviour-Scripts.mp4` and `behaviour-scripts-chapters.json`: "Behaviour scripts and custom
  animations" (it credits Clever and the EldenRingHKS authors for the techniques).

`src/shared/videos.ts` lists them. A video without its chapters isn't listed; without any, the walkthrough window
says the videos aren't part of the build.
