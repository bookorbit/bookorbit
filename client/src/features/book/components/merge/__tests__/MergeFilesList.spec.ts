import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { BookMergeFilePlanEntry } from '@bookorbit/types'
import { activateI18nLocale, i18n } from '@/i18n'
import MergeFilesList from '../MergeFilesList.vue'
import { mergeFile } from './fixtures'

function placements(files: BookMergeFilePlanEntry[]): string[] {
  const wrapper = mount(MergeFilesList, {
    props: {
      files,
      bookLabels: new Map([
        [1, 'Book 1'],
        [2, 'Book 2'],
      ]),
      crossDeviceBytes: null,
      canRemoveIdenticalCopies: false,
      deleteIdenticalCopies: false,
    },
    global: { stubs: { BookFormatChip: true } },
  })
  return wrapper.findAll('[data-testid="merge-file"]').map((item) => item.findAll('p').at(-1)!.text())
}

describe('MergeFilesList', () => {
  it('says the kept book files are already in place, not left in the old folder', () => {
    activateI18nLocale('en')
    const t = i18n.global.t

    const [kept, sidecar, hidden, missing] = placements([
      mergeFile(10, 1, { action: 'stay', reason: 'already_in_destination', toRelPath: 'Ann Author/Book 1/book-10.epub' }),
      mergeFile(20, 2, { action: 'stay', reason: 'metadata_kept_in_place' }),
      mergeFile(21, 2, { action: 'hide', reason: 'metadata_hidden' }),
      mergeFile(22, 2, { action: 'stay', reason: 'missing' }),
    ])

    expect(kept).toBe(t('book.merge.files.inPlace'))
    expect(sidecar).toBe(t('book.merge.files.stays'))
    expect(hidden).toBe(t('book.merge.files.hidden'))
    expect(missing).toBe(t('book.merge.files.missing'))
  })
})

describe('MergeFilesList paths', () => {
  it('shows From and To only for a file that moves', () => {
    activateI18nLocale('en')
    const wrapper = mount(MergeFilesList, {
      props: {
        files: [
          mergeFile(10, 1, { action: 'stay', reason: 'already_in_destination', fromRelPath: 'Kept/book.epub', toRelPath: 'Kept/book.epub' }),
          mergeFile(11, 2, { action: 'move', fromRelPath: 'Other/book.pdf', toRelPath: 'Kept/book.pdf' }),
        ],
        bookLabels: new Map([
          [1, 'Book 1'],
          [2, 'Book 2'],
        ]),
        crossDeviceBytes: null,
        canRemoveIdenticalCopies: false,
        deleteIdenticalCopies: false,
      },
      global: { stubs: { BookFormatChip: true } },
    })
    const [kept, moved] = wrapper.findAll('[data-testid="merge-file"]').map((item) => item.text())

    expect(kept).toContain('Kept/book.epub')
    expect(kept).not.toContain('From')
    expect(moved).toContain('From Other/book.pdf')
    expect(moved).toContain('To Kept/book.pdf')
  })
})
