/**
 * Chapter clocks are positions, not durations: `H:MM:SS.mmm` reads the same in every locale and is
 * what other chapter tools print, so it is not run through the number formatters.
 */
export function formatChapterClock(ms: number, options: { withMs?: boolean; forceHours?: boolean } = {}): string {
  const safe = Math.max(0, Math.round(Number.isFinite(ms) ? ms : 0))
  const totalSeconds = Math.floor(safe / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const base =
    hours > 0 || options.forceHours
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${minutes}:${String(seconds).padStart(2, '0')}`
  if (options.withMs === false) return base
  return `${base}.${String(safe % 1000).padStart(3, '0')}`
}

/** A span such as a chapter length: whole seconds, `M:SS` or `H:MM:SS`. */
export function formatChapterLength(ms: number): string {
  return formatChapterClock(ms, { withMs: false })
}

const CLOCK_PATTERN = /^(?:(\d+):)?(?:(\d+):)?(\d+)(?:[.,](\d{1,3}))?$/

/**
 * Reads what people type into a start field: `90`, `90.5`, `1:30`, `1:02:03`, `1:02:03.250` or a
 * comma decimal. Minutes and seconds above 59 are refused once a larger unit is present, because
 * `1:75` is far more likely a typo than a deliberate 2:15.
 */
export function parseChapterClock(input: string): number | null {
  const text = input.trim()
  const match = CLOCK_PATTERN.exec(text)
  if (!match) return null
  const [, first, second, last, fraction] = match
  const parts = [first, second, last].filter((part): part is string => part !== undefined).map(Number)
  const fractionMs = fraction ? Number(fraction.padEnd(3, '0')) : 0

  let hours = 0
  let minutes = 0
  let seconds: number
  if (parts.length === 3) {
    ;[hours, minutes, seconds] = parts as [number, number, number]
    if (minutes > 59 || seconds > 59) return null
  } else if (parts.length === 2) {
    ;[minutes, seconds] = parts as [number, number]
    if (seconds > 59) return null
  } else {
    seconds = parts[0]!
  }
  const total = ((hours * 60 + minutes) * 60 + seconds) * 1000 + fractionMs
  return Number.isSafeInteger(total) ? total : null
}
