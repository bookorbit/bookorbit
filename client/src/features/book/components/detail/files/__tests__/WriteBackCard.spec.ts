import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { BookDetail, BookFileWriteStatus } from '@bookorbit/types'

import WriteBackCard from '../WriteBackCard.vue'

function book(fileWriteStatus: BookFileWriteStatus): BookDetail {
  return {
    title: 'Dune',
    isbn13: null,
    authors: [],
    genres: [],
    tags: [],
    providerIds: {},
    coverSource: null,
    covers: { ebook: null, audio: null },
    files: [],
    audioMetadata: { narrators: [{ id: 1, name: 'Scott Brick' }], durationSeconds: null, abridged: false, chapters: null },
    comicMetadata: null,
    lastWrittenAt: null,
    fileWriteStatus,
  } as unknown as BookDetail
}

const EPUB_ONLY: BookFileWriteStatus = {
  enabled: true,
  reason: null,
  writableFormats: ['epub'],
  writableFields: ['title', 'isbn13'],
  targets: [{ fileId: 1, format: 'epub', writable: true, reason: null, writableFields: ['title', 'isbn13'] }],
}

const MIXED: BookFileWriteStatus = {
  enabled: true,
  reason: null,
  writableFormats: ['epub', 'm4b'],
  writableFields: ['title', 'isbn13', 'narrators'],
  targets: [
    { fileId: 1, format: 'epub', writable: true, reason: null, writableFields: ['title', 'isbn13'] },
    { fileId: 2, format: 'm4b', writable: true, reason: null, writableFields: ['title', 'narrators'] },
  ],
}

describe('WriteBackCard', () => {
  it('names the single format a book writes into', () => {
    const wrapper = mount(WriteBackCard, { props: { book: book(EPUB_ONLY), canEdit: false } })

    expect(wrapper.text()).toContain('written into the EPUB.')
    expect(wrapper.findAll('li')).toHaveLength(0)
  })

  it('names every format of a mixed book and counts what each file receives', () => {
    const wrapper = mount(WriteBackCard, { props: { book: book(MIXED), canEdit: false } })

    expect(wrapper.text()).toContain('written into the EPUB and M4B.')
    const rows = wrapper.findAll('li').map((row) => row.text())
    expect(rows).toEqual(['epub1 / 2 set', 'm4b2 / 2 set'])
  })
})
