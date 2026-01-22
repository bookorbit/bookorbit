export function bookCoverStyle(seed: string): { background: string; color: string } {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return {
    background: `oklch(0.22 0.07 ${hue})`,
    color: `oklch(0.92 0.03 ${hue})`,
  }
}
