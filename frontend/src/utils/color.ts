/**
 * Returns a legible foreground color (#1a1a1a or #ffffff) for a given
 * background hex color, based on perceived luminance.
 */
export function textColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.5 ? '#1a1a1a' : '#ffffff'
}
