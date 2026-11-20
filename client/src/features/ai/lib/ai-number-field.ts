/** Dollars and builds the server accepts, the same ceilings as its request validation. */
export const AI_MAX_DOLLARS = 1_000_000
export const AI_MAX_BUILDS_PER_MONTH = 100_000

export interface NumberFieldRule {
  min: number
  max: number
  /** Whole numbers only. */
  integer?: boolean
  /** Empty means null instead of an error. */
  optional?: boolean
}

export type ParsedNumberField = { ok: true; value: number | null } | { ok: false }

/** A typed number field: empty is null when the field is optional, anything else must be in range. */
export function parseNumberField(raw: string, rule: NumberFieldRule): ParsedNumberField {
  const trimmed = raw.trim()
  if (!trimmed) return rule.optional ? { ok: true, value: null } : { ok: false }
  const pattern = rule.integer ? /^\d+$/ : /^\d+(\.\d{1,2})?$/
  if (!pattern.test(trimmed)) return { ok: false }
  const value = Number(trimmed)
  return value >= rule.min && value <= rule.max ? { ok: true, value } : { ok: false }
}

export function numberFieldText(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value)
}
