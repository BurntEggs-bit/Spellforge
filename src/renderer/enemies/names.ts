/** Names in a character's param rows, which tag them with whose they are. */

/** A row's name without the character's tag: "[Margit] Hammer Jump" -> "Hammer Jump". */
export const plainName = (name: string) => name.replace(/^\[[^\]]*\]\s*/, '').trim()
