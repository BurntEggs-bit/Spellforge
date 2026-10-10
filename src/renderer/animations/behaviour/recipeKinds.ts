/** The kinds of behaviour recipe, as the Behaviour tab names and explains them. */
import type { Recipe } from '../../../shared/recipes.ts'

export type Kind = Recipe['kind']

/** Each kind's name and what it does, in the order the + Add ▾ menu lists them. */
export const KINDS: { kind: Kind; label: string; hint: string }[] = [
  {
    kind: 'jump',
    label: 'Animation jump',
    hint: 'During part of an animation, R1 / R2… plays another animation instead of the next (custom combos)',
  },
  {
    kind: 'chain',
    label: 'Chain into another animation',
    hint: 'At a point of an animation, go straight into another one (no input)',
  },
  {
    kind: 'handChange',
    label: 'Two-hand button plays an animation',
    hint: 'A weapon’s grip change becomes a move: a trick-weapon transform',
  },
  {
    kind: 'specialAttack',
    label: 'Special attacks',
    hint: 'Charging R2, the dodge button plays 030950: the special attacks curved and thrusting swords have',
  },
  {
    kind: 'heavySet',
    label: 'Second heavy attacks',
    hint: 'While a SpEffect is on, R2 plays another set of heavy attacks (030600), as after Barbaric Roar or War Cry',
  },
  {
    kind: 'comboLength',
    label: 'Combo length',
    hint: 'How many attacks a weapon’s R1 chain (or powerstance chain) has',
  },
  { kind: 'skillType', label: 'Skill type', hint: 'A skill acts as a stance, a quickstep, a bow stance…' },
  { kind: 'dodge', label: 'Dodge', hint: 'A weapon rolls like another equip load (or your own rolls)' },
  { kind: 'noGuard', label: 'No guard', hint: 'A weapon can’t block (two-handed, or at all): L1 is free for attacks' },
  {
    kind: 'code',
    label: 'A script of your own',
    hint: 'Write HKS in the script editor: checked as you type, errors shown in the code',
  },
]
