import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { AuthorDetail } from '@bookorbit/types'
import AuthorHeader from './AuthorHeader.vue'

const author: AuthorDetail = {
  id: 7,
  name: 'Author',
  sortName: null,
  description: null,
  imageUrl: null,
  bookCount: 24,
  lastAddedAt: '2026-01-01T00:00:00.000Z',
  birthDate: null,
  birthYear: null,
  deathDate: null,
  deathYear: null,
  website: null,
  genres: [],
  influences: [],
  metadataProvider: null,
  metadataProviderId: null,
}

describe('AuthorHeader', () => {
  it('does not shrink when the book list exceeds the scroll viewport', () => {
    const wrapper = mount(AuthorHeader, {
      props: { author },
    })

    expect(wrapper.get('section').classes()).toContain('shrink-0')
  })
})

describe('life dates', () => {
  it('renders the stored day regardless of a timezone behind UTC', () => {
    // yyyy-MM-dd parses as UTC midnight; formatting it in America/Denver
    // without pinning the zone renders the previous day.
    const wrapper = mount(AuthorHeader, {
      props: { author: { ...author, birthDate: '1898-11-29', deathDate: '1963-11-22' } },
    })

    expect(wrapper.text()).toContain('Nov 29, 1898')
    expect(wrapper.text()).toContain('Nov 22, 1963')
  })

  it('falls back to the year when only a year is known', () => {
    const wrapper = mount(AuthorHeader, {
      props: { author: { ...author, birthDate: null, birthYear: 1929 } },
    })

    expect(wrapper.text()).toContain('1929')
  })
})

describe('fresh metadata lookup', () => {
  const freshButton = '[data-testid="metadata-cache-search-fresh"]'

  it('is offered once the lookup finished, even when it found nothing', async () => {
    const wrapper = mount(AuthorHeader, { props: { author, previewSearched: true } })

    await wrapper.get(freshButton).trigger('click')

    expect(wrapper.emitted('searchFresh')).toHaveLength(1)
  })

  it('is not offered before the lookup finished or when the author has a biography of their own', () => {
    expect(mount(AuthorHeader, { props: { author } }).find(freshButton).exists()).toBe(false)
    expect(
      mount(AuthorHeader, { props: { author, previewSearched: true, loadingPreview: true } })
        .find(freshButton)
        .exists(),
    ).toBe(false)
    expect(
      mount(AuthorHeader, {
        props: { author: { ...author, description: 'Written by hand', imageUrl: 'https://img.example/a.jpg' }, previewSearched: true },
      })
        .find(freshButton)
        .exists(),
    ).toBe(false)
  })
})
