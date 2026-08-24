/**
 * Splits a naming pattern into typed pieces so a template can colour each part of the
 * grammar. Returning data rather than markup keeps the renderer free of `v-html`.
 *
 * The grammar mirrors `replacePlaceholders` in `@bookorbit/types`:
 *   {token}          a metadata placeholder
 *   {token:modifier} a placeholder with a transform
 *   <...>            an optional group, dropped when a placeholder inside it is empty
 *   <a|b>            the same, with `b` used when `a` cannot be filled
 *   /                a path separator
 */
export type PatternPieceKind = 'literal' | 'token' | 'modifier' | 'optional' | 'fallback' | 'separator'

export interface PatternPiece {
  kind: PatternPieceKind
  text: string
  /** True while inside an `<...>` group, so the renderer can tint the whole run. */
  optional: boolean
}

/**
 * The modifiers `applyModifier` in @bookorbit/types implements. Anything else falls through
 * its switch and returns the value unchanged, so a typo silently produces a wrong path
 * rather than an error. Listing them here lets both the palette and the validator agree.
 */
export const PATTERN_MODIFIERS = ['first', 'sort', 'initial', 'fixed2', 'upper', 'lower'] as const
export type PatternModifier = (typeof PATTERN_MODIFIERS)[number]

const KNOWN_MODIFIERS = new Set<string>(PATTERN_MODIFIERS)

const SPECIAL = '<>|/{'

export function highlightPattern(pattern: string): PatternPiece[] {
  const pieces: PatternPiece[] = []
  let depth = 0
  let index = 0

  const push = (kind: PatternPieceKind, text: string) => {
    if (text) pieces.push({ kind, text, optional: depth > 0 })
  }

  while (index < pattern.length) {
    const char = pattern.charAt(index)

    if (char === '<') {
      depth += 1
      pieces.push({ kind: 'optional', text: char, optional: true })
      index += 1
      continue
    }

    if (char === '>' && depth > 0) {
      pieces.push({ kind: 'optional', text: char, optional: true })
      depth -= 1
      index += 1
      continue
    }

    if (char === '|' && depth > 0) {
      push('fallback', char)
      index += 1
      continue
    }

    if (char === '/') {
      push('separator', char)
      index += 1
      continue
    }

    if (char === '{') {
      const close = pattern.indexOf('}', index)
      if (close !== -1) {
        const inner = pattern.slice(index + 1, close)
        const colon = inner.indexOf(':')
        if (colon === -1) {
          push('token', `{${inner}}`)
        } else {
          push('token', `{${inner.slice(0, colon)}`)
          push('modifier', inner.slice(colon))
          push('token', '}')
        }
        index = close + 1
        continue
      }
    }

    let end = index
    while (end < pattern.length && !SPECIAL.includes(pattern.charAt(end))) end += 1
    if (end === index) end = index + 1
    push('literal', pattern.slice(index, end))
    index = end
  }

  return pieces
}

/** An unclosed `<` or `{` produces a pattern that silently resolves to something unexpected. */
export function findUnbalancedDelimiter(pattern: string): '<' | '{' | null {
  let depth = 0
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern.charAt(index)
    if (char === '<') depth += 1
    else if (char === '>' && depth > 0) depth -= 1
    else if (char === '{' && pattern.indexOf('}', index) === -1) return '{'
  }
  return depth > 0 ? '<' : null
}

/** The first modifier the resolver would ignore, so the field can say so instead of guessing. */
export function findUnknownModifier(pattern: string): string | null {
  for (const piece of highlightPattern(pattern)) {
    if (piece.kind !== 'modifier') continue
    const name = piece.text.slice(1)
    if (name && !KNOWN_MODIFIERS.has(name)) return name
  }
  return null
}
