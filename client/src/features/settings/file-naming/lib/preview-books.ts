import { EXAMPLE_PATTERN_METADATA } from '@bookorbit/types'

/**
 * Books the result can be previewed with. The shipped sample stays the default; the others are
 * the shapes that actually break a naming scheme: a long title inside a long series, a very long
 * subtitle, more than three authors, an audiobook, and a book that belongs to no series.
 *
 * Titles and names are bibliographic data and are never translated; only the note is.
 */
export const PREVIEW_BOOK_IDS = ['sample', 'longTitle', 'longSubtitle', 'manyAuthors', 'audiobook', 'standalone'] as const
export type PreviewBookId = (typeof PREVIEW_BOOK_IDS)[number]

export interface PreviewBook {
  id: PreviewBookId
  extension: string
  metadata: Record<string, string>
}

const book = (fields: Partial<Record<string, string>>): Record<string, string> => ({
  title: '',
  subtitle: '',
  authors: '',
  narrators: '',
  year: '',
  series: '',
  seriesIndex: '',
  language: 'English',
  publisher: '',
  isbn: '',
  library: 'Books',
  originalFilename: '',
  extension: '',
  readaloud: '',
  ...fields,
})

export const PREVIEW_BOOKS: Record<PreviewBookId, PreviewBook> = {
  sample: { id: 'sample', extension: 'epub', metadata: { ...EXAMPLE_PATTERN_METADATA } },
  longTitle: {
    id: 'longTitle',
    extension: 'epub',
    metadata: book({
      title: 'Through the Looking-Glass, and What Alice Found There',
      authors: 'Lewis Carroll',
      year: '1871',
      series: "Alice's Adventures in Wonderland",
      seriesIndex: '02',
      publisher: 'Macmillan',
      originalFilename: 'through-the-looking-glass',
      extension: 'epub',
    }),
  },
  longSubtitle: {
    id: 'longSubtitle',
    extension: 'epub',
    metadata: book({
      title: 'Robinson Crusoe',
      subtitle:
        'The Life and Strange Surprizing Adventures of Robinson Crusoe, of York, Mariner, Who Lived Eight and Twenty Years, All Alone in an Un-inhabited Island on the Coast of America',
      authors: 'Daniel Defoe',
      year: '1719',
      publisher: 'W. Taylor',
      originalFilename: 'robinson-crusoe',
      extension: 'epub',
    }),
  },
  manyAuthors: {
    id: 'manyAuthors',
    extension: 'cbz',
    metadata: book({
      title: 'Preludes & Nocturnes',
      authors: 'Neil Gaiman, Sam Kieth, Mike Dringenberg, Malcolm Jones III, Todd Klein',
      year: '1991',
      series: 'The Sandman',
      seriesIndex: '01',
      publisher: 'DC Comics',
      originalFilename: 'sandman-v01',
      extension: 'cbz',
    }),
  },
  audiobook: {
    id: 'audiobook',
    extension: 'm4b',
    metadata: book({
      title: 'Artificial Condition',
      authors: 'Martha Wells',
      narrators: 'Kevin R. Free',
      year: '2018',
      series: 'The Murderbot Diaries',
      seriesIndex: '02',
      publisher: 'Tor.com',
      originalFilename: 'artificial-condition',
      extension: 'm4b',
    }),
  },
  standalone: {
    id: 'standalone',
    extension: 'epub',
    metadata: book({
      title: 'The Ocean at the End of the Lane',
      authors: 'Neil Gaiman',
      narrators: 'Neil Gaiman',
      year: '2013',
      publisher: 'William Morrow',
      originalFilename: 'the-ocean-at-the-end-of-the-lane',
      extension: 'epub',
    }),
  },
}

/** Written out so a renamed message key fails the locale check instead of rendering raw. */
export const PREVIEW_BOOK_NOTE_KEYS: Record<PreviewBookId, string> = {
  sample: 'settings.reader.fileNaming.previewBook.sample',
  longTitle: 'settings.reader.fileNaming.previewBook.longTitle',
  longSubtitle: 'settings.reader.fileNaming.previewBook.longSubtitle',
  manyAuthors: 'settings.reader.fileNaming.previewBook.manyAuthors',
  audiobook: 'settings.reader.fileNaming.previewBook.audiobook',
  standalone: 'settings.reader.fileNaming.previewBook.standalone',
}

/** The book with some fields blanked, for previewing what a pattern does without them. */
export function withoutFields(metadata: Record<string, string>, fields: readonly string[]): Record<string, string> {
  const copy = { ...metadata }
  for (const field of fields) copy[field] = ''
  return copy
}
