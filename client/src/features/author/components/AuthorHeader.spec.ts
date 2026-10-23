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
  metadataProviderPinned: false,
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

describe('provider source and website', () => {
  it('links the matched provider page and marks a pinned match', () => {
    const wrapper = mount(AuthorHeader, {
      props: { author: { ...author, metadataProvider: 'goodreads', metadataProviderId: '2222', metadataProviderPinned: true } },
    })

    const source = wrapper.get('[data-testid="author-source"]')
    expect(source.get('a').attributes('href')).toBe('https://www.goodreads.com/author/show/2222')
    expect(source.text()).toContain('Goodreads')
    expect(source.findAll('span').some((span) => span.classes().includes('text-primary'))).toBe(true)
  })

  it('shows no pinned label for a match enrichment chose', () => {
    const wrapper = mount(AuthorHeader, {
      props: { author: { ...author, metadataProvider: 'audnexus', metadataProviderId: 'B001H6UH2C' } },
    })

    const source = wrapper.get('[data-testid="author-source"]')
    expect(source.get('a').attributes('href')).toBe('https://www.audible.com/author/B001H6UH2C')
    expect(source.findAll('span').some((span) => span.classes().includes('text-primary'))).toBe(false)
  })

  it('shows influences when they are the only author fact', () => {
    const wrapper = mount(AuthorHeader, { props: { author: { ...author, influences: ['Alistair MacLean'] } } })

    expect(wrapper.text()).toContain('Alistair MacLean')
  })

  it('renders a website that is not http(s) as text, never as a link', () => {
    const wrapper = mount(AuthorHeader, { props: { author: { ...author, website: 'javascript:alert(1)' } } })

    expect(wrapper.text()).toContain('javascript:alert(1)')
    expect(wrapper.findAll('a').some((link) => link.attributes('href')?.startsWith('javascript:'))).toBe(false)
  })

  it('links an http(s) website', () => {
    const wrapper = mount(AuthorHeader, { props: { author: { ...author, website: 'https://johnreid.example' } } })

    expect(wrapper.findAll('a').some((link) => link.attributes('href') === 'https://johnreid.example')).toBe(true)
  })
})
