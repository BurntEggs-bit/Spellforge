/**
 * The walkthrough videos, in the order the walkthrough window lists them:
 * the walkthrough first, then the shorter ones under it. Each ships in
 * `resources/tutorial` (from `media/tutorial`) with its chapters; one whose
 * chapters aren't there isn't listed.
 */
export const WALKTHROUGH_VIDEOS = [
  { file: 'Spellforge-Tutorial.mp4', chapters: 'chapters.json', title: 'Spellforge walkthrough' },
  {
    file: 'Spellforge-Moveset-Example.mp4',
    chapters: 'moveset-example-chapters.json',
    title: 'Another example of a moveset',
  },
  { file: 'Spellforge-Effect-Editor.mp4', chapters: 'effect-editor-chapters.json', title: 'The effect editor' },
  {
    file: 'Spellforge-Recreating-Sacred-Arsenal.mp4',
    chapters: 'sacred-arsenal-chapters.json',
    title: 'Recreating Clever’s Sacred Arsenal',
  },
  {
    file: 'Spellforge-Behaviour-Scripts.mp4',
    chapters: 'behaviour-scripts-chapters.json',
    title: 'Behaviour scripts and custom animations',
  },
]
