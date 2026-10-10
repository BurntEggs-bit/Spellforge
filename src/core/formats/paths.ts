/** Paths as the game's binders and files write them, with either slash. */

/** The file name at the end of a path: "N:\\GR\\data\\chr\\c0000.anibnd" -> "c0000.anibnd". */
export function fileNameOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return path.slice(cut + 1)
}
