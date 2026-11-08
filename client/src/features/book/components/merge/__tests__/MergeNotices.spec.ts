import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { BookMergeBlocker, BookMergeWarning } from '@bookorbit/types'
import { i18n } from '@/i18n'
import MergeBlockers from '../MergeBlockers.vue'
import MergeWarnings from '../MergeWarnings.vue'

const libraryNames = new Map([
  [1, 'Books'],
  [2, 'Audiobooks'],
])
const bookLabels = new Map([[2, 'Frankenstein']])

beforeEach(() => {
  i18n.global.locale.value = 'en'
})

describe('MergeWarnings across libraries', () => {
  function texts(warnings: BookMergeWarning[]): string[] {
    const wrapper = mount(MergeWarnings, { props: { warnings, bookLabels, libraryNames, destinationLibraryId: 2 } })
    return wrapper.findAll('[data-testid="merge-warning"]').map((item) => item.text())
  }

  it.each([
    [
      { code: 'LIBRARY_ACCESS_NARROWS', libraryId: 2, count: 3 },
      '3 readers cannot open Audiobooks, so they lose access to this book and its reading data until they get access to it.',
    ],
    [
      { code: 'LIBRARY_ACCESS_NARROWS', libraryId: 2 },
      'Some readers cannot open Audiobooks, so they lose access to this book and its reading data until they get access to it.',
    ],
    [{ code: 'KOBO_REMOVAL', count: 2 }, 'This book leaves the Kobo of 2 readers on their next sync.'],
    [{ code: 'KOBO_REMOVAL' }, 'This book leaves the Kobo devices of readers who cannot open Audiobooks on their next sync.'],
    [{ code: 'CUSTOM_FIELDS_HIDDEN', libraryId: 2, count: 1 }, 'Audiobooks does not use 1 custom field of this book. Its value is kept but hidden.'],
    [{ code: 'HARDLINKED_FILES', count: 4 }, expect.stringMatching(/^4 files have other hard links/)],
    [{ code: 'TARGET_CHANGES_LIBRARY', libraryId: 1 }, 'The kept book moves to Books.'],
    [
      { code: 'COMPANION_REQUEST_STAYS', libraryId: 2, count: 1 },
      '1 requested other format of this book will arrive in Audiobooks as a book of its own instead of joining the merged book.',
    ],
    [
      { code: 'COMPANION_REQUEST_STAYS', libraryId: 2 },
      'A requested other format of this book will arrive in Audiobooks as a book of its own instead of joining the merged book.',
    ],
  ] as [BookMergeWarning, string][])('says %o in words', (warning, text) => {
    expect(texts([warning])).toEqual([text])
  })

  it('falls back to general words for a code this bundle does not know', () => {
    expect(texts([{ code: 'SOMETHING_NEW' as never }])).toEqual([i18n.global.t('book.merge.warnings.unknown')])
  })
})

describe('MergeBlockers across libraries', () => {
  function item(blocker: BookMergeBlocker) {
    const wrapper = mount(MergeBlockers, { props: { blockers: [blocker], bookLabels, libraryNames, canLink: true } })
    return wrapper.get('[data-testid="merge-blocker"]')
  }

  it.each([
    [{ code: 'INSUFFICIENT_SPACE', bytes: Math.round(1.2 * 1024 ** 3) }, 'The copy needs 1.2 GB.'],
    [{ code: 'FORMAT_NOT_ALLOWED', bookId: 2, libraryId: 2, format: 'pdf' }, 'Audiobooks does not allow PDF files'],
    [{ code: 'PATH_EXCLUDED', libraryId: 2, relPath: 'Mary Shelley/Frankenstein/extras/a.mp3' }, 'Audiobooks skips this path when it scans'],
    [{ code: 'LEFTOVER_CONTENT', libraryId: 1, relPath: 'Mary Shelley/Frankenstein/a.pdf' }, 'stay behind in Books'],
    [{ code: 'READERS_LOSE_ACCESS' }, 'Other readers would lose access to this book and its reading data.'],
    [{ code: 'LIBRARY_BUSY', libraryId: 2 }, 'is running in Audiobooks'],
    [{ code: 'DIFFERENT_LIBRARIES' }, 'These books are in different libraries.'],
  ] as [BookMergeBlocker, string][])('says %o in words', (blocker, text) => {
    const rendered = item(blocker)
    expect(rendered.text()).toContain(text)
    expect(rendered.text()).not.toContain(i18n.global.t('book.merge.blockers.unknown'))
  })

  it.each([
    'FORMAT_NOT_ALLOWED',
    'PATH_EXCLUDED',
    'LEFTOVER_CONTENT',
    'READERS_LOSE_ACCESS',
    'FOLDER_NOT_WRITABLE',
    'BOTH_HAVE_AUDIO',
    'FILE_PER_BOOK_LIBRARY',
  ] as const)('offers Link instead of %s', (code) => {
    expect(item({ code }).find('[data-testid="merge-link-instead"]').exists()).toBe(true)
  })

  it('shows the path a blocker is about and the book it names', () => {
    const rendered = item({ code: 'PATH_EXCLUDED', bookId: 2, libraryId: 2, relPath: 'Mary Shelley/Frankenstein/extras/a.mp3' })
    expect(rendered.text()).toContain('Frankenstein')
    expect(rendered.get('[dir="auto"]').text()).toBe('Mary Shelley/Frankenstein/extras/a.mp3')
  })
})
