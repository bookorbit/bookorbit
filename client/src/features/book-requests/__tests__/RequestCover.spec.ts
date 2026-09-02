import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import RequestCover from '../components/RequestCover.vue'

describe('RequestCover', () => {
  it('renders the cover when there is one', () => {
    const wrapper = mount(RequestCover, { props: { src: 'https://example.test/cover.jpg', mediaKind: 'ebook' } })

    expect(wrapper.find('img').exists()).toBe(true)
    expect(wrapper.find('img').attributes('src')).toBe('https://example.test/cover.jpg')
  })

  it('falls back to the media icon when there is no cover url', () => {
    const wrapper = mount(RequestCover, { props: { src: null, mediaKind: 'audiobook' } })

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('svg').exists()).toBe(true)
  })

  /**
   * The case a plain `v-if="src"` misses. Provider cover URLs point at hosts BookOrbit does not
   * control, and a dead one used to leave a transparent gap where the cover should be.
   */
  it('falls back when a cover url is present but fails to load', async () => {
    const wrapper = mount(RequestCover, { props: { src: 'https://example.test/gone.jpg', mediaKind: 'ebook' } })

    await wrapper.find('img').trigger('error')

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('svg').exists()).toBe(true)
  })

  it('retries the next cover rather than staying broken for the rest of the session', async () => {
    const wrapper = mount(RequestCover, { props: { src: 'https://example.test/gone.jpg', mediaKind: 'ebook' } })
    await wrapper.find('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)

    await wrapper.setProps({ src: 'https://example.test/other.jpg' })

    expect(wrapper.find('img').exists()).toBe(true)
  })

  it('advances through ordered fallback sources when a provider cover fails', async () => {
    const wrapper = mount(RequestCover, {
      props: {
        src: 'https://example.test/first.jpg',
        fallbackSources: ['https://example.test/second.jpg', 'https://example.test/third.jpg'],
        sourceKey: 'dune',
        mediaKind: 'ebook',
      },
    })

    await wrapper.find('img').trigger('error')
    expect(wrapper.find('img').attributes('src')).toBe('https://example.test/second.jpg')

    await wrapper.find('img').trigger('error')
    expect(wrapper.find('img').attributes('src')).toBe('https://example.test/third.jpg')

    await wrapper.find('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.emitted('sourceChange')).toEqual([
      [{ key: 'dune', src: 'https://example.test/first.jpg' }],
      [{ key: 'dune', src: 'https://example.test/second.jpg' }],
      [{ key: 'dune', src: 'https://example.test/third.jpg' }],
      [{ key: 'dune', src: null }],
    ])
  })

  it('does not retry a failed cover when the parent recreates an unchanged fallback list', async () => {
    const wrapper = mount(RequestCover, {
      props: {
        src: 'https://example.test/first.jpg',
        fallbackSources: ['https://example.test/second.jpg'],
        mediaKind: 'ebook',
      },
    })

    await wrapper.find('img').trigger('error')
    await wrapper.setProps({ fallbackSources: ['https://example.test/second.jpg'] })

    expect(wrapper.find('img').attributes('src')).toBe('https://example.test/second.jpg')
  })

  it('keeps the slot out of the accessibility tree either way, since the title is right beside it', () => {
    const withCover = mount(RequestCover, { props: { src: 'https://example.test/cover.jpg', mediaKind: 'ebook' } })
    const withoutCover = mount(RequestCover, { props: { src: null, mediaKind: 'ebook' } })

    expect(withCover.find('img').attributes('alt')).toBe('')
    expect(withoutCover.find('div').attributes('aria-hidden')).toBe('true')
  })
})
