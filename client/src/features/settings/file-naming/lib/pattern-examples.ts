import type { OrganizationMode } from '@bookorbit/types'

/**
 * Idioms the recipe strip does not cover. Each one exists to teach a single piece of the
 * grammar, so the list stays short; anything a recipe already offers was dropped when the
 * recipes landed.
 *
 * These live outside the sheet component so `pattern-catalog.spec.ts` can hold every
 * shipped pattern to the same validator the field uses.
 */
export interface PatternExample {
  id: string
  labelKey: string
  /** Null for the organization mode an example cannot sensibly express. */
  patterns: Record<OrganizationMode, string | null>
  cases: { labelKey: string; omit: string[] }[]
}

const BOOK_STEM = '<{title}|{originalFilename}>'

const COMPLETE = { labelKey: 'settings.reader.fileNaming.exampleCase.complete', omit: [] }

export const PATTERN_EXAMPLES: PatternExample[] = [
  {
    id: 'seriesOrStandalone',
    labelKey: 'settings.reader.fileNaming.example.seriesOrStandalone',
    patterns: {
      book_per_file: `<{series}|Standalone>/<{seriesIndex}. >${BOOK_STEM}`,
      book_per_folder: `<{series}|Standalone>/<{seriesIndex}. >${BOOK_STEM}/${BOOK_STEM}`,
    },
    cases: [COMPLETE, { labelKey: 'settings.reader.fileNaming.exampleCase.noSeries', omit: ['series', 'seriesIndex'] }],
  },
  {
    id: 'optionalSubtitle',
    labelKey: 'settings.reader.fileNaming.example.optionalSubtitle',
    patterns: {
      book_per_file: `<{authors:first} - >${BOOK_STEM}< - {subtitle}>< ({year})>`,
      book_per_folder: `<{authors:first} - >${BOOK_STEM}< - {subtitle}>< ({year})>/${BOOK_STEM}`,
    },
    cases: [COMPLETE, { labelKey: 'settings.reader.fileNaming.exampleCase.noSubtitle', omit: ['subtitle'] }],
  },
  {
    id: 'languageFolder',
    labelKey: 'settings.reader.fileNaming.example.languageFolder',
    patterns: {
      book_per_file: `<{language:upper}/><{authors}|Unknown Author>/${BOOK_STEM}`,
      book_per_folder: `<{language:upper}/><{authors}|Unknown Author>/${BOOK_STEM}/${BOOK_STEM}`,
    },
    cases: [COMPLETE, { labelKey: 'settings.reader.fileNaming.exampleCase.noLanguage', omit: ['language'] }],
  },
  {
    id: 'publisherFolder',
    labelKey: 'settings.reader.fileNaming.example.publisherFolder',
    patterns: {
      book_per_file: `<{publisher}/><{authors:first}|Unknown Author>/${BOOK_STEM}`,
      book_per_folder: `<{publisher}/><{authors:first}|Unknown Author>/${BOOK_STEM}/${BOOK_STEM}`,
    },
    cases: [COMPLETE, { labelKey: 'settings.reader.fileNaming.exampleCase.noPublisher', omit: ['publisher'] }],
  },
  {
    id: 'stackedOptional',
    labelKey: 'settings.reader.fileNaming.example.stackedOptional',
    patterns: {
      book_per_file: `<{language:upper}/><{publisher}|Unknown Publisher>/<{authors:first}|Unknown Author>/${BOOK_STEM}`,
      book_per_folder: `<{language:upper}/><{publisher}|Unknown Publisher>/<{authors:first}|Unknown Author>/${BOOK_STEM}/${BOOK_STEM}`,
    },
    cases: [COMPLETE, { labelKey: 'settings.reader.fileNaming.exampleCase.noPublisher', omit: ['publisher'] }],
  },
  {
    id: 'folderDrop',
    labelKey: 'settings.reader.fileNaming.example.folderDrop',
    // A trailing slash resolves to a folder and keeps the uploaded filename inside it.
    // Folder as Book needs a filename segment of its own, so it has no variant here.
    patterns: {
      book_per_file: '<{authors:initial}|_>/<{authors:sort}|Unknown Author>/<{series}/>',
      book_per_folder: null,
    },
    cases: [COMPLETE, { labelKey: 'settings.reader.fileNaming.exampleCase.noSeries', omit: ['series', 'seriesIndex'] }],
  },
]
