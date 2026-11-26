import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { AnnotationItem } from '@bookorbit/types'
import type { ComicNote } from '../../composables/useComicNotes'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key) }),
}))

const scrolledTo = vi.hoisted(() => vi.fn<(index: number) => void>())

vi.mock('vue-virtual-scroller', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    RecycleScroller: defineComponent({
      inheritAttrs: false,
      props: { items: { type: Array, required: true } },
      setup(props, { attrs, slots, expose }) {
        expose({ scrollToItem: scrolledTo })
        return () =>
          h(
            'div',
            attrs,
            props.items.map((item, index) => slots.default?.({ item, index, active: true })),
          )
      },
    }),
  }
})

import ComicNotesPanel from '../ComicNotesPanel.vue'
import ComicNoteRow from '../ComicNoteRow.vue'

function note(id: number, page: number): ComicNote {
  const annotation: AnnotationItem = {
    id,
    bookId: 7,
    cfi: null,
    jumpFileId: 70,
    pageno: page + 1,
    text: '',
    color: '#38BDF8',
    style: 'highlight',
    note: `Note ${id}`,
    chapterTitle: null,
    origin: 'web',
    positionStatus: null,
    chapterIndex: null,
    highlightedAt: '2026-11-20T10:00:00.000Z',
    createdAt: '2026-11-20T10:00:00.000Z',
    page: { page },
  }
  return { annotation, page }
}

function mountPanel(props: Partial<InstanceType<typeof ComicNotesPanel>['$props']> = {}) {
  return mount(ComicNotesPanel, {
    props: {
      notes: [note(1, 2), note(2, 6), note(3, 7)],
      total: 3,
      currentPages: [6, 7],
      thumbnailUrl: (page: number) => `/thumb/${page}`,
      showClose: true,
      ...props,
    },
  })
}

describe('ComicNotesPanel', () => {
  it('offers to add to the pages on screen and marks their notes as current', () => {
    const wrapper = mountPanel()

    expect(wrapper.get('[data-testid="comic-note-add"]').text()).toBe('reader.cbz.notes.addToPages:{"start":7,"end":8}')
    const rows = wrapper.findAllComponents(ComicNoteRow)
    expect(rows.map((row) => row.props('current'))).toEqual([false, true, true])
    expect(rows[0]!.find('img').attributes('src')).toBe('/thumb/2')
    expect(wrapper.findAll('[aria-current="page"]')).toHaveLength(2)
  })

  it('opens on the notes for the pages on screen', async () => {
    scrolledTo.mockClear()
    mountPanel()
    await flushPromises()
    expect(scrolledTo).toHaveBeenCalledWith(1)
  })

  it('names a single page and passes row actions up', async () => {
    const wrapper = mountPanel({ currentPages: [2] })

    expect(wrapper.get('[data-testid="comic-note-add"]').text()).toBe('reader.cbz.notes.addToPage:{"page":3}')
    await wrapper.get('[data-testid="comic-note-add"]').trigger('click')
    await wrapper.findAll('[data-testid="comic-note-row"] button')[0]!.trigger('click')
    wrapper.findAllComponents(ComicNoteRow)[1]!.vm.$emit('delete', note(2, 6))
    await wrapper.get('[aria-label="reader.cbz.notes.close"]').trigger('click')

    expect(wrapper.emitted('add')).toHaveLength(1)
    expect(wrapper.emitted('open')?.[0]?.[0]).toMatchObject({ page: 2 })
    expect(wrapper.emitted('delete')?.[0]?.[0]).toMatchObject({ page: 6 })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('shows the empty state, and a retry when the notes could not load', async () => {
    const empty = mountPanel({ notes: [], total: 0 })
    expect(empty.text()).toContain('reader.cbz.notes.empty')

    const failed = mountPanel({ notes: [], total: 0, loadError: true })
    expect(failed.get('[role="alert"]').text()).toContain('reader.cbz.notes.loadError')
    await failed.get('[role="alert"] button').trigger('click')
    expect(failed.emitted('retry')).toHaveLength(1)
  })

  it('leaves the close button out of the phone sheet', () => {
    const wrapper = mountPanel({ showClose: false })
    expect(wrapper.find('[aria-label="reader.cbz.notes.close"]').exists()).toBe(false)
  })
})
