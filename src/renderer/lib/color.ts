/** Colours: '#rrggbb' strings, float RGB(A) as effects and three.js use it, and CSS for swatches. */

/** '#rrggbb' as its three bytes (0-255). */
function hexBytes(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** '#rrggbb' as [r, g, b] floats (0-1). */
export function hexToRgb(hex: string): number[] {
  return hexBytes(hex).map((b) => b / 255)
}

/** '#rrggbb' as [r, g, b, 1] floats (0-1). */
export function hexToRgba(hex: string): number[] {
  return [...hexToRgb(hex), 1]
}

/** A byte (0-255) as two hex digits. */
const byteHex = (b: number) => b.toString(16).padStart(2, '0')

/** [r, g, b] floats (0-1) as '#rrggbb', each channel rounded to the nearest byte. */
export function rgbToHex(rgb: number[]): string {
  return (
    '#' +
    rgb
      .slice(0, 3)
      .map((v) => byteHex(Math.round(Math.max(0, Math.min(1, v)) * 255)))
      .join('')
  )
}

/** Two '#rrggbb' colours mixed: t = 0 gives a, t = 1 gives b. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = hexBytes(a)
  const pb = hexBytes(b)
  return '#' + pa.map((v, i) => byteHex(Math.round(v + (pb[i] - v) * t))).join('')
}

/** '#rrggbb' as a CSS rgba() with this alpha. */
export function hexWithAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexBytes(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * `[r, g, b, a]` floats -> a CSS colour showing the *hue*. Effect colours are
 * often tiny (0.01) or HDR (>1) because textures and bloom supply the
 * brightness, so swatches normalise to the brightest channel; the real
 * values are in the swatch tooltip.
 */
export function cssColor(rgba: number[]): string {
  const [r, g, b, a = 1] = rgba
  const peak = Math.max(r, g, b)
  const scale = peak > 1e-6 ? 1 / peak : 0
  const c = (v: number) => Math.round(Math.max(0, Math.min(1, v * scale)) * 255)
  return `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${Math.max(0.35, Math.min(1, a))})`
}

/** HDR intensity above 1, shown next to swatches so bright effects aren't misread. */
export function intensity(rgba: number[]): number {
  return Math.max(rgba[0], rgba[1], rgba[2])
}
