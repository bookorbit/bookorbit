export interface BookCoverPalette {
  gradient: string
  from: string
  to: string
  color: string
  accent: string
  textMuted: string
}

function seedHash(seed: string): number {
  let h = 5381
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0
  }
  return h
}

export function bookCoverPalette(seed: string): BookCoverPalette {
  const n = seedHash(seed)
  const hue = (n * 137.508) % 360
  const n2 = (n >>> 8) & 0xff
  const n3 = (n >>> 16) & 0xff

  // Base Lightness: 0.45 to 0.75 (Clean and vibrant)
  const baseL = 0.45 + (n2 % 6) * 0.05
  const baseC = 0.12 + (n3 % 5) * 0.02
  const from = `oklch(${baseL.toFixed(3)} ${baseC.toFixed(3)} ${Math.round(hue)})`

  // Gradient: 20% lightness drop
  const toL = baseL - 0.2
  const to = `oklch(${toL.toFixed(3)} ${baseC.toFixed(3)} ${Math.round(hue)})`

  // Text: Purest tint
  const color = `oklch(0.99 0.01 ${Math.round(hue)})`

  // Accent: Brightest highlight
  const accentL = Math.min(0.95, baseL + 0.35)
  const accent = `oklch(${accentL.toFixed(3)} ${Math.max(0.02, baseC - 0.08).toFixed(3)} ${Math.round(hue)})`

  const textMuted = `oklch(0.9 0.02 ${Math.round(hue)})`

  return {
    gradient: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
    from,
    to,
    color,
    accent,
    textMuted,
  }
}

export function bookCoverStyle(seed: string): { background: string; color: string } {
  const p = bookCoverPalette(seed)
  return { background: p.gradient, color: p.color }
}

export function titleFontSizeClass(title: string): string {
  const len = title.length
  if (len <= 6) return 'text-[30cqi]'
  if (len <= 12) return 'text-[24cqi]'
  if (len <= 22) return 'text-[18cqi]'
  if (len <= 35) return 'text-[13cqi]'
  return 'text-[10cqi]'
}
