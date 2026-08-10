const CONTROL = '\\u0000-\\u001F\\u007F'
const ZERO_WIDTH_AND_BIDI = '\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF'

const DISPLAY_SAFE_TEXT_PATTERN = new RegExp(`^[^${CONTROL}${ZERO_WIDTH_AND_BIDI}]+$`, 'u')
const TRIMMED_TEXT_PATTERN = /^\S(.*\S)?$/u

export type IdentityTextProblem = 'unsafeCharacters' | 'untrimmed'

/**
 * Mirrors the server's RegisterDto rules so the sign-up form can explain a rejection in the
 * viewer's language instead of surfacing an English validation message from the API.
 */
export function checkIdentityText(value: string): IdentityTextProblem | null {
  if (!DISPLAY_SAFE_TEXT_PATTERN.test(value)) return 'unsafeCharacters'
  if (!TRIMMED_TEXT_PATTERN.test(value)) return 'untrimmed'
  return null
}
