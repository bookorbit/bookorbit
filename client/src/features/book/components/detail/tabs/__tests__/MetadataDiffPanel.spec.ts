import { describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import type { MetadataCandidate, MetadataProviderInfo, MetadataSource } from '@bookorbit/types'
import MetadataDiffPanel from '../MetadataDiffPanel.vue'
import type { SecondCoverInput } from '../../../../composables/useSecondCoverRow'

const current: MetadataSource = {
  title: 'Dune',
  subtitle: null,
  description: null,
  publisher: null,
  publishedDate: null,
  publishedYear: null,
  language: null,
  pageCount: null,
  seriesName: null,
  seriesIndex: null,
  isbn10: null,
  isbn13: null,
  authors: ['Frank Herbert'],
  genres: [],
  narrators: [],
  durationSeconds: null,
  abridged: null,
  hardcoverEditionId: null,
  communityRatings: [],
}

const providers: MetadataProviderInfo[] = [
  { key: 'google', label: 'Google Books', identifiable: true },
  { key: 'audible', label: 'Audible', identifiable: true },
  { key: 'itunes', label: 'iTunes', identifiable: true },
]

const google: MetadataCandidate = { provider: 'google', providerId: 'g1', title: 'Dune', coverUrl: '/covers/google.jpg', coverShape: 'portrait' }
const audible: MetadataCandidate = { provider: 'audible', providerId: 'a1', title: 'Dune', coverUrl: '/covers/audible.jpg', coverShape: 'square' }
const itunes: MetadataCandidate = { provider: 'itunes', providerId: 'i1', title: 'Dune', coverUrl: '/covers/itunes.jpg', coverShape: 'square' }

function secondCover(overrides: Partial<SecondCoverInput> = {}): SecondCoverInput {
  return { medium: 'audio', candidates: [itunes, audible], priority: ['audible', 'itunes'], currentUrl: '', searching: false, ...overrides }
}

function mountPanel(props: Record<string, unknown> = {}) {
  return mount(MetadataDiffPanel, {
    props: {
      current,
      candidates: [google],
      initialCandidate: google,
      providers,
      filteredResults: [google],
      currentCoverUrl: '',
      coverMedium: 'ebook',
      secondCover: secondCover(),
      ...props,
    },
  })
}

async function click(wrapper: VueWrapper, label: string) {
  await wrapper.get(`button[aria-label="${label}"]`).trigger('click')
}

async function clickText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text() === text)
  if (!button) throw new Error(`No button reads "${text}"`)
  await button.trigger('click')
}

function applied(wrapper: VueWrapper) {
  return wrapper.emitted('apply')?.[0]?.[0] as { coverUrl?: string; audioCoverUrl?: string } | undefined
}

describe('MetadataDiffPanel', () => {
  it('shows one cover row per medium for a book that has both', () => {
    const wrapper = mountPanel()

    expect(wrapper.text()).toContain('Book cover')
    expect(wrapper.text()).toContain('Audiobook cover')
  })

  it('applies the audiobook cover the Audiobook cover rule ranks first, to the audio slot only', async () => {
    const wrapper = mountPanel()

    await click(wrapper, 'Use the new Audiobook cover')
    await clickText(wrapper, 'Apply to form')

    const payload = applied(wrapper)
    expect(payload?.audioCoverUrl).toBe('/covers/audible.jpg')
    expect(payload?.coverUrl).toBeUndefined()
  })

  it('lets the audiobook cover come from another result of its own search', async () => {
    const wrapper = mountPanel()

    await click(wrapper, 'Show the iTunes cover, 2 of 2')
    await click(wrapper, 'Use the new Audiobook cover')
    await clickText(wrapper, 'Apply to form')

    expect(applied(wrapper)?.audioCoverUrl).toBe('/covers/itunes.jpg')
  })

  it('leaves the audiobook cover out of Copy All', async () => {
    const wrapper = mountPanel()

    await clickText(wrapper, 'Copy All')
    await clickText(wrapper, 'Apply to form')

    const payload = applied(wrapper)
    expect(payload?.coverUrl).toBe('/covers/google.jpg')
    expect(payload?.audioCoverUrl).toBeUndefined()
  })

  it('does not apply a pick for a locked audiobook cover', async () => {
    const wrapper = mountPanel({ lockedFields: ['audioCover'] })

    expect(wrapper.get('button[aria-label="Use the new Audiobook cover"]').attributes('disabled')).toBeDefined()
  })

  it('sends the one cover of a book that is only an audiobook to the audio slot', async () => {
    const wrapper = mountPanel({
      coverMedium: 'audio',
      secondCover: null,
      candidates: [audible],
      initialCandidate: audible,
      filteredResults: [audible],
    })

    expect(wrapper.text()).not.toContain('Audiobook cover')
    await click(wrapper, 'Use the new Cover')
    await clickText(wrapper, 'Apply to form')

    expect(applied(wrapper)).toMatchObject({ audioCoverUrl: '/covers/audible.jpg' })
    expect(applied(wrapper)?.coverUrl).toBeUndefined()
  })

  it('names portrait art offered for a filled audiobook slot, and keeps it out of Copy All', async () => {
    const wrapper = mountPanel({
      coverMedium: 'audio',
      secondCover: null,
      currentCoverUrl: '/api/v1/books/1/cover?medium=audio',
    })

    const hint = wrapper.findAll('p').find((paragraph) => paragraph.text() === 'Portrait image. Audiobook covers are square.')
    expect(hint).toBeDefined()
    expect(wrapper.get('button[aria-label="Use the new Cover"]').attributes('aria-describedby')).toBe(hint?.attributes('id'))

    await clickText(wrapper, 'Copy All')
    await clickText(wrapper, 'Apply to form')
    expect(applied(wrapper)?.audioCoverUrl).toBeUndefined()
  })

  it('says when the other medium is still being searched, or found nothing', async () => {
    const searching = mountPanel({ secondCover: secondCover({ candidates: [], searching: true }) })
    expect(searching.get('[role="status"]').text()).toBe('Searching audiobook editions...')

    const empty = mountPanel({ secondCover: secondCover({ candidates: [] }) })
    expect(empty.text()).toContain('No audiobook covers found.')
  })
})
