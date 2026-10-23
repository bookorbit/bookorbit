import type { AchievementRarity } from '@bookorbit/types'

export const MEDAL_RARITIES: readonly AchievementRarity[] = ['common', 'rare', 'epic', 'legendary']

/** The server may grow the rarity set before this build knows the new value; draw it as common. */
export function medalRarity(value: string | null | undefined): AchievementRarity {
  return MEDAL_RARITIES.includes(value as AchievementRarity) ? (value as AchievementRarity) : 'common'
}

export function rarityRank(value: AchievementRarity): number {
  return MEDAL_RARITIES.indexOf(value)
}

const CENTER = 50

function polar(radius: number, angle: number): [number, number] {
  return [CENTER + radius * Math.cos(angle), CENTER + radius * Math.sin(angle)]
}

function point([x, y]: [number, number]): string {
  return `${x.toFixed(2)} ${y.toFixed(2)}`
}

/** A closed outline of `count` rounded lobes between two radii. */
function lobes(count: number, inner: number, outer: number): string {
  const start = -Math.PI / 2
  let path = ''
  for (let index = 0; index < count; index++) {
    const from = start + (index / count) * Math.PI * 2
    const to = start + ((index + 1) / count) * Math.PI * 2
    if (index === 0) path += `M${point(polar(inner, from))}`
    path += `Q${point(polar(outer, (from + to) / 2))} ${point(polar(inner, to))}`
  }
  return `${path}Z`
}

function circle(radius: number): string {
  return `M${CENTER - radius} ${CENTER}a${radius} ${radius} 0 1 0 ${radius * 2} 0a${radius} ${radius} 0 1 0 ${-radius * 2} 0Z`
}

/**
 * Rarity is carried by the silhouette as well as the metal, so it never rests on colour alone:
 * a plain coin, a beaded coin, an eight-lobe rosette and a sunburst. All fit the same 100 box.
 */
export const MEDAL_SHAPES: Record<AchievementRarity, string> = {
  common: circle(46),
  rare: circle(46.5),
  epic: lobes(8, 41.2, 53.2),
  legendary: lobes(24, 43, 50.6),
}

/** The bead ring on a rare medal's rim: one dashed stroke with round caps, 36 beads, instead of 36 circles. */
export const BEAD_RADIUS = 42.6
export const BEAD_DASH = `0 ${((2 * Math.PI * BEAD_RADIUS) / 36).toFixed(3)}`

/** Tier pips sit on the lower rim, spread symmetrically around the bottom. */
export function pipPositions(count: number): Array<[number, number]> {
  if (count <= 0) return []
  const spread = 0.62
  return Array.from({ length: count }, (_, index) => {
    const offset = count === 1 ? 0 : (index / (count - 1) - 0.5) * spread * 2
    return polar(50.5, Math.PI / 2 - offset)
  })
}

export const PROGRESS_RING_RADIUS = 38.6

export function progressDash(fraction: number, radius = PROGRESS_RING_RADIUS): { length: number; dash: number } {
  const length = 2 * Math.PI * radius
  return { length, dash: length * Math.min(1, Math.max(0, fraction)) }
}
