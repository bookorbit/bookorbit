import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BookCoverSlot, BookDetail } from '@bookorbit/types'
import { COVER_ASPECT_RATIO_KEY } from '../../lib/cover-aspect-ratio'
import BookCoverLightbox from '../BookCoverLightbox.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../composables/useCoverVersions', () => ({
  useCoverVersions: () => ({
    coverUrl: (bookId: number, type: string, version?: string, medium?: string) =>
      `/api/v1/books/${bookId}/${type}?t=${version}&medium=${medium ?? ''}`,
  }),
}))

type LightboxBook = Pick<BookDetail, 'id' | 'title' | 'covers' | 'coverVersion'>

function slot(updatedAt: string): BookCoverSlot {
  return { source: 'extracted', updatedAt, width: null, height: null }
}

const bothSlots: LightboxBook = { id: 3, title: 'Dune', covers: { ebook: slot('e1'), audio: slot('a1') }, coverVersion: 'face' }

function mountLightbox(
  props: { book?: LightboxBook; medium?: 'ebook' | 'audio' | null; previews?: Record<string, string | null> } = {},
  aspectRatio = '2/3',
) {
  return mount(BookCoverLightbox, {
    props: { open: true, book: props.book ?? bothSlots, medium: props.medium, previews: props.previews },
    attachTo: document.body,
    global: { provide: { [COVER_ASPECT_RATIO_KEY as symbol]: ref(aspectRatio) } },
  })
}

function image(): HTMLImageElement {
  return document.body.querySelector('img')!
}

function radios(): HTMLButtonElement[] {
  return [...document.body.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
}

describe('BookCoverLightbox', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('is a titled dialog with a labelled close button', async () => {
    mountLightbox()
    await flushPromises()

    const dialog = document.body.querySelector('[role="dialog"]')!
    const titleId = dialog.getAttribute('aria-labelledby')!
    expect(document.getElementById(titleId)?.textContent).toBe('book.detail.coverLightbox.title')
    expect(document.body.querySelector('[aria-label="common.close"]')).not.toBeNull()
  })

  it('opens on the face and switches between the two slots', async () => {
    mountLightbox({}, '1/1')
    await flushPromises()

    expect(image().getAttribute('src')).toBe('/api/v1/books/3/cover?t=a1&medium=audio')
    expect(radios().map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'true'])

    radios()[0]!.click()
    await flushPromises()

    expect(image().getAttribute('src')).toBe('/api/v1/books/3/cover?t=e1&medium=ebook')
  })

  it('moves between the slots with the arrow keys', async () => {
    mountLightbox()
    await flushPromises()

    radios()[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()

    expect(radios()[1]!.getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(radios()[1])
  })

  it('opens on the slot it is given', async () => {
    mountLightbox({ medium: 'audio' })
    await flushPromises()

    expect(image().getAttribute('src')).toBe('/api/v1/books/3/cover?t=a1&medium=audio')
  })

  it('shows no switch and the bare face when only one slot has an image', async () => {
    mountLightbox({ book: { ...bothSlots, covers: { ebook: slot('e1'), audio: null } } })
    await flushPromises()

    expect(radios()).toHaveLength(0)
    expect(image().getAttribute('src')).toBe('/api/v1/books/3/cover?t=face&medium=')
  })

  it('shows an unsaved editor image in place of its slot', async () => {
    mountLightbox({ book: { ...bothSlots, covers: { ebook: slot('e1'), audio: null } }, medium: 'audio', previews: { audio: 'blob:square' } })
    await flushPromises()

    expect(radios()).toHaveLength(2)
    expect(image().getAttribute('src')).toBe('blob:square')
  })

  it('asks its parent to close on Escape', async () => {
    const wrapper = mountLightbox()
    await flushPromises()

    document.body.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()

    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })
})
