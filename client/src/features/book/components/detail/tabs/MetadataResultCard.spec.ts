import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { MetadataCandidate, MetadataProviderInfo } from '@bookorbit/types'
import MetadataResultCard from './MetadataResultCard.vue'

const providers: MetadataProviderInfo[] = [{ key: 'comicvine', label: 'ComicVine', identifiable: true }]

function makeCandidate(overrides: Partial<MetadataCandidate> = {}): MetadataCandidate {
  return {
    provider: 'comicvine',
    providerId: '777',
    title: 'The Origin',
    coverUrl: 'https://example.com/cover.jpg',
    ...overrides,
  }
}

describe('MetadataResultCard', () => {
  it('renders displayTitle as the headline when present', () => {
    const wrapper = mount(MetadataResultCard, {
      props: { candidate: makeCandidate({ displayTitle: 'Series Name #12.5 - The Origin' }), providers },
    })

    expect(wrapper.text()).toContain('Series Name #12.5 - The Origin')
  })

  it('falls back to title as the headline when displayTitle is absent', () => {
    const wrapper = mount(MetadataResultCard, {
      props: { candidate: makeCandidate({ title: 'The Way of Kings', displayTitle: undefined }), providers: [] },
    })

    expect(wrapper.text()).toContain('The Way of Kings')
  })

  it('still labels an unnamed comic issue, which has a displayTitle but no title', () => {
    const wrapper = mount(MetadataResultCard, {
      props: { candidate: makeCandidate({ title: undefined, displayTitle: 'Series Name #7' }), providers },
    })

    expect(wrapper.text()).toContain('Series Name #7')
  })

  it('hides the cover from assistive technology because the headline already names the result', () => {
    const wrapper = mount(MetadataResultCard, {
      props: { candidate: makeCandidate({ displayTitle: 'Series Name #12.5 - The Origin' }), providers },
    })

    expect(wrapper.find('img').attributes('alt')).toBe('')
  })
})
