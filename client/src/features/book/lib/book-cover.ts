export function bookCoverStyle(seed: string): { background: string; color: string } {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  const useLightVariant = Math.abs(hash) % 5 < 2
  if (useLightVariant) {
    return {
      background: `oklch(0.90 0.10 ${hue})`,
      color: `oklch(0.28 0.12 ${hue})`,
    }
  }
  return {
    background: `oklch(0.26 0.14 ${hue})`,
    color: `oklch(0.96 0.06 ${hue})`,
  }
}

export function titleFontSizeClass(title: string): string {
  const len = title.length
  if (len <= 8) return 'text-[14cqi]'
  if (len <= 16) return 'text-[11cqi]'
  if (len <= 30) return 'text-[8cqi]'
  return 'text-[6cqi]'
}
