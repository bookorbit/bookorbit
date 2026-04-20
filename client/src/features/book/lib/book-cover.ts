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

  const bgL = 0.14 + (n2 % 10) * 0.018
  const bgC = 0.06 + (n3 % 8) * 0.015
  const from = `oklch(${bgL.toFixed(3)} ${bgC.toFixed(3)} ${Math.round(hue)})`
  const toL = Math.min(0.35, bgL + 0.06)
  const toC = Math.max(0.02, bgC - 0.02)
  const to = `oklch(${toL.toFixed(3)} ${toC.toFixed(3)} ${Math.round((hue + 20) % 360)})`

  const color = `oklch(0.99 0.025 ${Math.round(hue)})`

  const accentL = 0.7 + (n2 % 7) * 0.03
  const accentC = 0.14 + (n3 % 6) * 0.025
  const accent = `oklch(${accentL.toFixed(3)} ${accentC.toFixed(3)} ${Math.round(hue)})`
  const textMuted = `oklch(${(accentL + 0.1).toFixed(3)} ${Math.max(0.04, accentC - 0.08).toFixed(3)} ${Math.round(hue)})`

  return {
    gradient: `linear-gradient(150deg, ${from} 0%, ${to} 100%)`,
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
