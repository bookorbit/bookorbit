import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { LinkedBookSummary } from '@bookorbit/types'
import { i18n } from '@/i18n'
import type { EditionEntry } from '@/features/book/lib/book-editions'

const mocks = vi.hoisted(() => ({ api: vi.fn<(input: string) => Promise<Response>>() }))
vi.mock('@/lib/api', () => ({ api: mocks.api }))

const DiscoverRow = (await import('../DiscoverRow.vue')).default

function entry(bookId: number, label: string, current = false, extra: Partial<LinkedBookSummary> = {}): EditionEntry {
  return {
    label,
    current,
    summary: {
      bookId,
      libraryId: 1,
      libraryName: 'Novels',
      title: 'Dune',
      formats: ['epub'],
      mediaKind: 'ebook',
      status: 'present',
      isLead: false,
      ...extra,
    },
  }
}

const editions = [entry(7, 'First edition', true, { isLead: true }), entry(8, 'Unabridged', false, { formats: ['m4b'], mediaKind: 'audiobook' })]

function response(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response
}

function mountRow(props: Record<string, unknown> = {}) {
  return mount(DiscoverRow, {
    props: { bookId: 7, seriesName: null, authorCount: 0, ...props },
    global: {
      stubs: {
        BookCarousel: { props: ['books'], template: '<div data-testid="carousel">{{ books.length }}</div>' },
        EditionsTable: {
          name: 'EditionsTable',
          props: ['editions', 'canMakeMain', 'removableBookIds', 'pending'],
          emits: ['make-main', 'remove'],
          template: '<div data-testid="table">{{ editions.length }}</div>',
        },
      },
    },
  })
}

describe('DiscoverRow', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
    mocks.api.mockReset().mockImplementation(async (url) => response(url.endsWith('/recommendations') ? [{ id: 99, title: 'Similar' }] : []))
  })

  it('puts an Editions tab first and opens it, with Add edition in place of the scroll arrows', async () => {
    const wrapper = mountRow({ editions, canAddEdition: true })
    await flushPromises()

    const pills = wrapper.findAll('[data-testid^="discover-pill-"]')
    expect(pills.map((pill) => pill.attributes('data-testid'))).toEqual(['discover-pill-editions', 'discover-pill-similar'])
    expect(pills[0]!.text()).toBe('Editions2')
    expect(pills[0]!.attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid="table"]').text()).toBe('2')
    expect(wrapper.find('[data-testid="carousel"]').exists()).toBe(false)

    await wrapper.get('[data-testid="discover-add-edition"]').trigger('click')
    expect(wrapper.emitted('add-edition')).toHaveLength(1)
  })

  it('hides Add edition from a viewer who may not group editions', async () => {
    const wrapper = mountRow({ editions })
    await flushPromises()
    expect(wrapper.find('[data-testid="discover-add-edition"]').exists()).toBe(false)
  })

  it('has no Editions tab for a book with no other edition', async () => {
    const wrapper = mountRow({ editions: [entry(7, 'Only', true)] })
    await flushPromises()
    expect(wrapper.find('[data-testid="discover-pill-editions"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="carousel"]').text()).toBe('1')
  })

  it('comes back to the Editions tab when the strip asks for all editions', async () => {
    const wrapper = mountRow({ editions })
    await flushPromises()
    await wrapper.get('[data-testid="discover-pill-similar"]').trigger('click')
    expect(wrapper.find('[data-testid="table"]').exists()).toBe(false)

    await (wrapper.vm as unknown as { showEditions: () => Promise<void> }).showEditions()
    await flushPromises()
    expect(wrapper.find('[data-testid="table"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="discover-pill-editions"]').attributes('aria-pressed')).toBe('true')
  })

  it('passes the row actions up to the page', async () => {
    const wrapper = mountRow({ editions, canMakeMainEdition: true, removableEditionIds: [8] })
    await flushPromises()
    const table = wrapper.findComponent({ name: 'EditionsTable' })
    expect(table.props()).toMatchObject({ canMakeMain: true, removableBookIds: [8] })
    table.vm.$emit('make-main', 8)
    table.vm.$emit('remove', 8)
    expect(wrapper.emitted('make-main-edition')).toEqual([[8]])
    expect(wrapper.emitted('remove-edition')).toEqual([[8]])
  })

  it('moves to another tab when the last other edition is removed', async () => {
    const wrapper = mountRow({ editions })
    await flushPromises()
    await wrapper.setProps({ editions: [] })
    expect(wrapper.find('[data-testid="discover-pill-editions"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="carousel"]').text()).toBe('1')
  })
})
