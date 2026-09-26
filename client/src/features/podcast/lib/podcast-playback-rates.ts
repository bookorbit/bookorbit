/**
 * The rate ladder and its bounds, shared by the player and both player surfaces. The bounds are the
 * server's accepted range for `defaultPlaybackRate`; keeping them next to the ladder is what stops a
 * new step being added outside what the API will store.
 */
export const PLAYBACK_RATES = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]
export const MIN_PLAYBACK_RATE = 0.5
export const MAX_PLAYBACK_RATE = 3

export function isPlaybackRateInRange(rate: number): boolean {
  return Number.isFinite(rate) && rate >= MIN_PLAYBACK_RATE && rate <= MAX_PLAYBACK_RATE
}

/** The next rate on the ladder, wrapping at the end. */
export function cyclePlaybackRate(current: number): number {
  const index = PLAYBACK_RATES.findIndex((rate) => rate === current)
  return PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length] ?? 1
}

/** The nearest rung above or below, or `undefined` at either end of the ladder. */
export function stepPlaybackRate(current: number, direction: -1 | 1): number | undefined {
  return direction > 0 ? PLAYBACK_RATES.find((rate) => rate > current) : [...PLAYBACK_RATES].reverse().find((rate) => rate < current)
}
