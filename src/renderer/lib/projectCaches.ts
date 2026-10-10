/**
 * Caches of what the UI has read from the open project (effect previews,
 * textures, thumbnails, icons) are kept by id, and another project can have
 * something else under the same id. Each such cache registers how to empty
 * itself, and opening a project empties them all.
 */
const clears: (() => void)[] = []

/** Has `clear` run whenever a project is opened. */
export function clearOnProjectChange(clear: () => void): void {
  clears.push(clear)
}

/** Empties every cache of the previous project's data: call it when a project opens. */
export function projectChanged(): void {
  for (const clear of clears) clear()
}
