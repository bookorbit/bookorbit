import { mount, RouterLinkStub } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { ReadingHistoryItem } from '@bookorbit/types'
import HistoryReadNotes from '../components/HistoryReadNotes.vue'

function item(overrides: Partial<ReadingHistoryItem>): ReadingHistoryItem {
  return {
    id: 1,
    bookId: 10,
    title: 'A Time to Kill',
    startedOn: '2025-12-15',
    endedOn: '2026-01-10',
    rating: null,
    highlightCount: 0,
    journalCount: 0,
    ...overrides,
  } as ReadingHistoryItem
}

function mountNotes(read: ReadingHistoryItem) {
  return mount(HistoryReadNotes, {
    props: { item: read, marks: undefined, ratingBusy: false },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
}

describe('HistoryReadNotes', () => {
  it('asks for the notes of a read that has some', () => {
    const wrapper = mountNotes(item({ id: 130, highlightCount: 31 }))

    expect(wrapper.emitted('load')).toEqual([[130]])
  })

  it('does not ask for a read without notes', () => {
    const wrapper = mountNotes(item({ id: 7 }))

    expect(wrapper.emitted('load')).toBeUndefined()
  })

  it('asks again when the panel switches to another read with notes', async () => {
    const wrapper = mountNotes(item({ id: 7 }))

    await wrapper.setProps({ item: item({ id: 130, highlightCount: 31 }) })

    expect(wrapper.emitted('load')).toEqual([[130]])
  })
})
