/** A project's folder as the modder thinks of it: its name, and saved files' paths inside it. */

/** A readable project name: the folder above `mod`, e.g. "ME2 - Bloody Scythe". */
export function projectName(modDir: string): string {
  const parts = modDir.split(/[\\/]+/).filter(Boolean)
  const i = parts.length - 1
  return parts[i]?.toLowerCase() === 'mod' && i > 0 ? parts[i - 1] : (parts[i] ?? modDir)
}

/**
 * A saved file's path as the modder thinks of it: inside the mod folder
 * (regulation.bin, sfx\…), backups next to it (..\.spellforge-backups\…).
 * Also keeps personal folder names out of screenshots and videos.
 */
export function projectPath(modDir: string, p: string): string {
  // Either slash, any case: Windows paths arrive both ways.
  const norm = (x: string) => x.replace(/[\\/]+/g, '/').replace(/\/$/, '')
  const base = norm(modDir)
  const parent = base.replace(/\/[^/]+$/, '')
  const path = norm(p)
  const under = (dir: string) => path.toLowerCase().startsWith(dir.toLowerCase() + '/')
  const win = (x: string) => x.replace(/\//g, '\\')
  if (under(base)) return win(path.slice(base.length + 1))
  if (parent && under(parent)) return win('..' + path.slice(parent.length))
  return p
}
