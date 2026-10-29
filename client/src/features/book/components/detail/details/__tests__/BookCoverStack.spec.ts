import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { BookDetail } from '@bookorbit/types'
import BookCoverStack from '../BookCoverStack.vue'

vi.mock('@/features/book/composables/useCoverVersions', () => ({
  useCoverVersions: () => ({
    coverUrl: (id: number, _type: string, _version: unknown, medium?: string) => `/cover/${id}/${medium ?? 'face'}`,
  }),
}))

const slot = { source: 'extracted' as const, updatedAt: '2026-01-01T00:00:00.000Z', width: null, height: null }
const book = { id: 7, title: 'Dear Debbie', coverVersion: 'v1', covers: { ebook: slot, audio: slot } } as Pick<
  BookDetail,
  'id' | 'title' | 'covers' | 'coverVersion'
>

function mountStack(props: { face?: 'ebook' | 'audio'; editable?: boolean } = {}) {
  return mount(BookCoverStack, {
    props: { book, face: props.face ?? 'audio', editable: props.editable },
    global: { stubs: { BookCoverArtwork: true } },
  })
}

describe('BookCoverStack', () => {
  it('puts the face in front and the other cover behind', () => {
    const wrapper = mountStack({ face: 'audio' })

    expect(wrapper.get('[data-test="cover-stack"]').attributes('data-front')).toBe('audio')
    expect(wrapper.get('[data-medium="audio"]').classes()).toContain('cover-stack__card--front')
    expect(wrapper.get('[data-medium="ebook"]').classes()).toContain('cover-stack__card--back')
  })

  it('labels the front card as the lightbox opener and the one behind as the swap', () => {
    const wrapper = mountStack({ face: 'audio' })

    expect(wrapper.get('[data-test="cover-stack-audio"]').attributes('aria-label')).toBe('View larger cover')
    expect(wrapper.get('[data-test="cover-stack-ebook"]').attributes('aria-label')).toBe('Show the book cover')
  })

  it('brings the cover behind forward when it is chosen, without opening anything', async () => {
    const wrapper = mountStack({ face: 'audio' })

    await wrapper.get('[data-test="cover-stack-ebook"]').trigger('click')

    expect(wrapper.get('[data-test="cover-stack"]').attributes('data-front')).toBe('ebook')
    expect(wrapper.get('[data-test="cover-stack-audio"]').attributes('aria-label')).toBe('Show the audiobook cover')
    expect(wrapper.get('[data-test="cover-stack-status"]').text()).toBe('Showing the book cover')
    expect(wrapper.emitted('open')).toBeUndefined()
  })

  it('opens the cover in front and keeps it in front', async () => {
    const wrapper = mountStack({ face: 'ebook' })

    await wrapper.get('[data-test="cover-stack-ebook"]').trigger('click')

    expect(wrapper.emitted('open')).toEqual([['ebook']])
    expect(wrapper.get('[data-test="cover-stack"]').attributes('data-front')).toBe('ebook')
  })

  it('goes back to the face when the face changes', async () => {
    const wrapper = mountStack({ face: 'audio' })
    await wrapper.get('[data-test="cover-stack-ebook"]').trigger('click')

    await wrapper.setProps({ face: 'ebook' })
    expect(wrapper.get('[data-test="cover-stack"]').attributes('data-front')).toBe('ebook')

    await wrapper.setProps({ face: 'audio' })
    expect(wrapper.get('[data-test="cover-stack"]').attributes('data-front')).toBe('audio')
  })

  it('asks each cover for its own slot', () => {
    const wrapper = mountStack()
    const sources = wrapper.findAllComponents({ name: 'BookCoverArtwork' }).map((artwork) => artwork.props('src'))

    expect(sources).toEqual(['/cover/7/ebook', '/cover/7/audio'])
  })

  it('offers cover editing only on the front card, and only to someone who can edit', async () => {
    expect(mountStack({ editable: false }).find('[data-test="cover-stack-edit"]').exists()).toBe(false)

    const wrapper = mountStack({ editable: true })
    expect(wrapper.findAll('[data-test="cover-stack-edit"]')).toHaveLength(1)
    await wrapper.get('[data-test="cover-stack-edit"]').trigger('click')
    expect(wrapper.emitted('edit')).toHaveLength(1)
    expect(wrapper.emitted('open')).toBeUndefined()
  })
})
