/** The Events page's words: the kinds of event recipe, and the banners a boss fight can end with. */
import type { EventRecipe, EventRecipeKind } from '../../shared/api.ts'

/** Each kind's name and what it does, in the order the + Add ▾ menu lists them. */
export const EVENT_KINDS: { kind: EventRecipeKind; label: string; hint: string }[] = [
  {
    kind: 'giveItems',
    label: 'Give an item',
    hint: 'The player gets an item lot as the script loads: once per save, or every time',
  },
  {
    kind: 'setFlag',
    label: 'Set a flag',
    hint: 'A flag turns on or off as the script loads, when another flag turns on, or when the player walks into an area',
  },
  {
    kind: 'whileSpEffect',
    label: 'While a SpEffect is on',
    hint: 'While a character has a SpEffect: give it another, set a flag or give an item; undone when it ends',
  },
  {
    kind: 'enableEnemy',
    label: 'Bring in an enemy',
    hint: 'An enemy placed in the map stays away until a flag turns on',
  },
  {
    kind: 'boss',
    label: 'Boss fight',
    hint: 'Gone once defeated, idle until the player is in its arena, then its health bar; the banner and its flag when it dies',
  },
]

/** The banners a boss's defeat shows, as the game's bosses use them. */
export const BANNERS: { value: number; label: string }[] = [
  { value: 18, label: 'Enemy felled' },
  { value: 17, label: 'Great enemy felled' },
  { value: 16, label: 'Demigod felled' },
  { value: 15, label: 'Legend felled' },
]

/** A recipe in plain words (as the Event panel heads it). */
export function recipeSentence(r: EventRecipe): string {
  switch (r.kind) {
    case 'giveItems':
      return `Gives item lot ${r.lot} ${r.flag ? `once per save (flag ${r.flag})` : 'every time the script loads'}`
    case 'setFlag':
      return `Sets flag ${r.flag} ${r.state ? 'on' : 'off'} ${
        r.when.kind === 'load'
          ? 'as the script loads'
          : r.when.kind === 'flag'
            ? `when flag ${r.when.flag} turns on`
            : `when the player walks into area ${r.when.area}`
      }`
    case 'whileSpEffect':
      return `While ${r.entity === 10000 ? 'the player' : r.entity} has SpEffect ${r.speffect}: ${
        r.do.kind === 'speffect'
          ? `SpEffect ${r.do.speffect} too`
          : r.do.kind === 'flag'
            ? `flag ${r.do.flag} on`
            : `gives item lot ${r.do.lot}`
      }`
    case 'enableEnemy':
      return `Enemy ${r.entity} stays away until flag ${r.flag} turns on`
    case 'boss':
      return `Boss ${r.entity}: arena ${r.arena}, defeat flag ${r.defeatFlag}`
  }
}
