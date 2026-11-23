import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { i18n } from '@/i18n'
import DeleteBookDialog from '../DeleteBookDialog.vue'
import type { DeleteEditionsChoice } from '@/features/book/lib/book-editions'

const editions: DeleteEditionsChoice = {
  current: { label: 'Ballantine Books · 2012', formats: ['epub', 'm4b'], libraryName: 'Novels' },
  others: [
    { bookId: 20, label: 'Full Cast', libraryName: 'Audiobooks' },
    { bookId: 30, label: 'Read-along', libraryName: 'ReadAloud+' },
    { bookId: 40, label: 'French translation', libraryName: 'Novels' },
  ],
  kept: 0,
}

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(DeleteBookDialog, { props: { open: true, deleting: false, ...props }, global: { stubs: { Teleport: true } } })
}

describe('DeleteBookDialog', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
  })

  it('asks whether the other editions go too, defaulting to this edition', async () => {
    const wrapper = mountDialog({ linked: true, editions })

    expect(wrapper.get('[role="radiogroup"]').attributes('aria-label')).toBe('What to delete')
    const edition = wrapper.get('[data-testid="delete-scope-edition"]')
    const all = wrapper.get('[data-testid="delete-scope-all"]')
    expect(edition.text()).toContain('This edition')
    expect(edition.text()).toContain('Ballantine Books · 2012, EPUB and M4B, in Novels')
    expect(all.text()).toContain('All 4 editions')
    expect(all.text()).toContain('Also Full Cast, Read-along, French translation, in Audiobooks, ReadAloud+, and Novels')
    expect(wrapper.find('[data-testid="delete-linked-note"]').exists()).toBe(false)

    await wrapper.get('[data-testid="delete-confirm"]').trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([['edition']])

    await all.get('input').setValue(true)
    await wrapper.get('[data-testid="delete-confirm"]').trigger('click')
    expect(wrapper.emitted('confirm')?.[1]).toEqual(['all'])
  })

  it('says how many editions stay when some sit in libraries the user cannot delete from', () => {
    const wrapper = mountDialog({ editions: { ...editions, kept: 1 } })
    expect(wrapper.get('[data-testid="delete-editions-kept"]').text()).toBe('1 edition is in a library you cannot delete from, so it stays.')
  })

  it('keeps the plain prompt when no other edition can be deleted', async () => {
    const wrapper = mountDialog({ linked: true, editions: { ...editions, others: [], kept: 2 } })
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="delete-linked-note"]').exists()).toBe(true)
    await wrapper.get('[data-testid="delete-confirm"]').trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([['edition']])
  })

  it('starts on this edition again each time it opens', async () => {
    const wrapper = mountDialog({ editions })
    await wrapper.get('[data-testid="delete-scope-all"] input').setValue(true)
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await wrapper.get('[data-testid="delete-confirm"]').trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([['edition']])
  })
})
