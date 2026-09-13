// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { validatePattern, type OrganizationMode } from '@bookorbit/types'
import { findUnbalancedDelimiter } from '../pattern-highlight'
import { PATTERN_EXAMPLES } from '../pattern-examples'
import { DOWNLOAD_RECIPES, UPLOAD_RECIPES, recipePattern } from '../pattern-recipes'
import { PREVIEW_CASES, previewDownloadName, previewUploadPath } from '../pattern-preview'

const MODES: OrganizationMode[] = ['book_per_file', 'book_per_folder']
const plain = { sanitizeForCrossPlatform: false }

/**
 * Every pattern this feature offers with one click has to survive the same validator the
 * field runs, or the click hands the user a pattern they cannot save. `#` slipped through
 * once as a no-author bucket and `validatePattern` rejects it, so the whole catalogue is
 * enumerated here rather than spot-checked.
 */
const SHIPPED_UPLOAD_PATTERNS: { id: string; pattern: string }[] = [
  ...UPLOAD_RECIPES.flatMap((recipe) => MODES.map((mode) => ({ id: `recipe:${recipe.id}:${mode}`, pattern: recipePattern(recipe, mode) }))),
  ...PATTERN_EXAMPLES.flatMap((example) =>
    MODES.map((mode) => ({ id: `example:${example.id}:${mode}`, pattern: example.patterns[mode] })).filter(
      (entry): entry is { id: string; pattern: string } => entry.pattern !== null,
    ),
  ),
]

const SHIPPED_DOWNLOAD_PATTERNS = DOWNLOAD_RECIPES.map((recipe) => ({ id: `recipe:${recipe.id}`, pattern: recipePattern(recipe, null) }))

const ALL_SHIPPED = [...SHIPPED_UPLOAD_PATTERNS, ...SHIPPED_DOWNLOAD_PATTERNS]

describe('shipped pattern catalogue', () => {
  it('offers a pattern for every recipe and mode', () => {
    expect(SHIPPED_UPLOAD_PATTERNS.length).toBe(UPLOAD_RECIPES.length * MODES.length + PATTERN_EXAMPLES.length * MODES.length - 1)
  })

  it.each(ALL_SHIPPED)('$id passes the validator the pattern field uses', ({ pattern }) => {
    expect(pattern).not.toBe('')
    expect(validatePattern(pattern)).toBe(true)
  })

  it.each(ALL_SHIPPED)('$id has balanced delimiters', ({ pattern }) => {
    expect(findUnbalancedDelimiter(pattern)).toBeNull()
  })

  it.each(SHIPPED_UPLOAD_PATTERNS)('$id resolves to a real path for every preview case', ({ pattern }) => {
    for (const previewCase of PREVIEW_CASES) {
      const resolved = previewUploadPath(pattern, plain, previewCase.metadata)

      expect(resolved).not.toBe('')
      // An empty segment means an unguarded token collapsed and left `//` behind.
      expect(resolved).not.toContain('//')
      expect(resolved.endsWith('/')).toBe(false)
    }
  })

  it.each(SHIPPED_DOWNLOAD_PATTERNS)('$id resolves to a bare filename for every preview case', ({ pattern }) => {
    for (const previewCase of PREVIEW_CASES) {
      const resolved = previewDownloadName(pattern, plain, previewCase.metadata)

      expect(resolved).not.toBe('')
      expect(resolved).not.toContain('/')
    }
  })

  it('gives Folder as Book recipes a book folder of their own', () => {
    for (const recipe of UPLOAD_RECIPES) {
      const resolved = previewUploadPath(recipePattern(recipe, 'book_per_folder'), plain)
      const fileResolved = previewUploadPath(recipePattern(recipe, 'book_per_file'), plain)

      expect(resolved.split('/').length).toBeGreaterThan(fileResolved.split('/').length)
    }
  })
})
