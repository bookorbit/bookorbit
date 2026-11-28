import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { activateI18nLocale } from '@/i18n'
import { api } from '@/lib/api'
import RequestFulfilDialog from '../components/RequestFulfilDialog.vue'

vi.mock('@/lib/api', () => ({ api: vi.fn<typeof api>() }))

function file(format: string, role: string) {
  return { format, role }
}

describe('RequestFulfilDialog', () => {
  it('distinguishes same-title editions, showing each content medium once', async () => {
    activateI18nLocale('en')
    const book = { title: 'The Time Machine', authors: ['H. G. Wells'] }
    vi.mocked(api).mockResolvedValue(
      Response.json({
        items: [
          { ...book, id: 1, files: [file('epub', 'primary')] },
          { ...book, id: 2, files: [file('m4b', 'primary'), file('mp3', 'content'), file('jpg', 'artwork')] },
          { ...book, id: 3, files: [file('epub', 'primary'), file('mp3', 'content'), file('cbz', 'content')] },
          { ...book, id: 4, files: [file('jpg', 'artwork')] },
        ],
      }),
    )
    const wrapper = mount(RequestFulfilDialog, {
      props: { open: true, busy: false },
      global: { stubs: { BookCoverImage: true, DialogPortal: { template: '<div><slot /></div>' } } },
    })

    try {
      await wrapper.get('input[type="search"]').setValue(book.title)
      await vi.waitFor(() => expect(api).toHaveBeenCalled())
      await flushPromises()

      const rows = wrapper.findAll('li > button')
      expect(rows.map((row) => row.text().match(/E-book|Audiobook|Comic/g) ?? [])).toEqual([
        ['E-book'],
        ['Audiobook'],
        ['E-book', 'Audiobook', 'Comic'],
        [],
      ])

      await rows[1]!.trigger('click')
      expect(rows[1]!.attributes('aria-pressed')).toBe('true')
      await wrapper
        .findAll('button')
        .find((button) => button.text() === 'Mark fulfilled')!
        .trigger('click')
      expect(wrapper.emitted('fulfil')).toEqual([[{ matchedBookId: 2 }]])
    } finally {
      wrapper.unmount()
    }
  })
})
