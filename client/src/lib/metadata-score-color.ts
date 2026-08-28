type RampStop = {
  at: number
  token: string
}

const RAMP: RampStop[] = [
  { at: 0, token: '--score-red' },
  { at: 35, token: '--score-orange' },
  { at: 65, token: '--score-yellow' },
  { at: 100, token: '--score-green' },
]

/**
 * A metadata score as a point on the red-to-green ramp, mixed in oklch so a value between two
 * stops resolves to a real hue on the spectrum instead of snapping to a tier. The stops are theme
 * tokens, so the same score stays legible on a light card and a dark one.
 */
export function metadataScoreColor(score: number): string {
  const value = Math.min(100, Math.max(0, score))

  let index = 1
  while (index < RAMP.length - 1 && value > RAMP[index]!.at) index += 1

  const lower = RAMP[index - 1]!
  const upper = RAMP[index]!
  const weight = ((value - lower.at) / (upper.at - lower.at)) * 100

  return `color-mix(in oklch, var(${upper.token}) ${weight.toFixed(2)}%, var(${lower.token}))`
}
