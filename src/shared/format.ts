/** Text helpers: counts with their nouns, sizes, HTML escaping, ids. */

/** A count and its noun: "1 event", "3 events" (`many` for other plurals: "entries", "matches"). */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** plural(), the count in the reader's number format: "1,204 rows". */
export function pluralLocale(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

/** A file size: "120 KB" (at least 1), or "3.4 MB" from a megabyte up. */
export function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** Text made safe to put into HTML. */
export function escapeHtml(t: string): string {
  return t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

/** A short random id (8 letters and digits), for items the UI keeps apart before they are saved. */
export function randomId(): string {
  return Math.random().toString(36).slice(2, 10)
}
