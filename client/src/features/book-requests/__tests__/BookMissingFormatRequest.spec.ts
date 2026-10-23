import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import type { BookDetail } from '@bookorbit/types'

const state = vi.hoisted(() => ({
  api: vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(),
  hasPermission: vi.fn<(permission: string) => boolean>(),
  showBookRequests: true,
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
}))

vi.mock('@/lib/api', () => ({ api: state.api }))
vi.mock('vue-sonner', () => ({ toast: { success: state.toastSuccess, error: state.toastError } }))
vi.mock('@/features/auth/composables/usePermissions', () => ({ usePermissions: () => ({ hasPermission: state.hasPermission }) }))
vi.mock('../composables/useBookRequestVisibility', () => ({
  useBookRequestVisibility: () => ({ showBookRequests: computed(() => state.showBookRequests) }),
}))

import BookMissingFormatRequest from '../components/BookMissingFormatRequest.vue'

function book(formats: string[]): BookDetail {
  return {
    id: 42,
    title: 'Dune',
    authors: [{ id: 1, name: 'Frank Herbert', sortName: null }],
    isbn10: null,
    isbn13: '9780441013593',
    seriesName: null,
    publishedYear: 1965,
    language: 'en',
    files: formats.map((format, index) => ({ id: index + 1, format, role: 'content', filename: `dune.${format}` })),
  } as unknown as BookDetail
}

function json(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response
}

const NOTHING = { ownedBookId: null, existingRequestId: null, existingRequestStatus: null, alreadySubscribed: false }

async function render(formats: string[]) {
  const wrapper = mount(BookMissingFormatRequest, { props: { book: book(formats) }, global: { stubs: { RouterLink: RouterLinkStub } } })
  await flushPromises()
  return wrapper
}

describe('BookMissingFormatRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.showBookRequests = true
    state.hasPermission.mockReturnValue(true)
    state.api.mockResolvedValue(json([NOTHING]))
  })

  it('offers the audiobook an ebook is missing, and asks whether anybody has it already', async () => {
    const wrapper = await render(['epub'])

    expect(wrapper.text()).toContain('No audiobook yet')
    const [path, init] = state.api.mock.calls[0]!
    expect(path).toBe('/api/v1/book-requests/availability')
    expect(JSON.parse(init!.body as string).items[0]).toMatchObject({ title: 'Dune', mediaKind: 'audiobook', isbn13: '9780441013593' })
  })

  it('offers the ebook an audiobook is missing', async () => {
    const wrapper = await render(['m4b'])

    expect(wrapper.text()).toContain('No e-book yet')
    expect(wrapper.get('button').attributes('aria-label')).toBe('Request e-book')
  })

  it.each(['cbz', 'cbr', 'cb7', 'CBZ'])('recognizes %s as the non-audio half', async (format) => {
    const wrapper = await render([format])
    expect(wrapper.get('button').attributes('aria-label')).toBe('Request audiobook')
    const [, init] = state.api.mock.calls[0]!
    expect(JSON.parse(init!.body as string).items[0]).toMatchObject({ mediaKind: 'audiobook' })
  })

  it('asks for the format against this book, so it joins it rather than becoming another', async () => {
    const wrapper = await render(['epub'])
    state.api.mockResolvedValueOnce(json({ request: { id: 77, status: 'pending' }, subscribed: false }))

    await wrapper.get('button').trigger('click')
    await flushPromises()

    const [path, init] = state.api.mock.calls[1]!
    expect(path).toBe('/api/v1/book-requests')
    expect(JSON.parse(init!.body as string)).toMatchObject({ mediaKind: 'audiobook', targetBookId: 42, title: 'Dune', language: 'en' })
    expect(state.toastSuccess).toHaveBeenCalledWith('Requested. The audiobook will join this book when it arrives')
    expect(wrapper.text()).toContain('Requested')
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toMatchObject({ name: 'book-request-detail', params: { id: 77 } })
  })

  it('says the translated reason when the server refuses', async () => {
    const wrapper = await render(['epub'])
    state.api.mockResolvedValueOnce(json({ errorCode: 'SUBMIT_TARGET_BOOK_HAS_MEDIUM', message: 'That book already has a audiobook' }, false))

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(state.toastError).toHaveBeenCalledWith('Could not submit that request', { description: 'That book already has this format' })
  })

  it('offers to join a request somebody else already made', async () => {
    state.api.mockResolvedValue(json([{ ...NOTHING, existingRequestId: 9, existingRequestStatus: 'pending' }]))
    const wrapper = await render(['epub'])

    expect(wrapper.text()).toContain('Requested by someone else')
    expect(wrapper.get('button').text()).toBe('Add me too')
  })

  it.each([
    ['a book holding both formats', ['epub', 'm4b'], true, true],
    ['a comic holding audio too', ['cbz', 'mp3'], true, true],
    ['somebody without request access', ['epub'], false, true],
    ['somebody who hid requests', ['epub'], true, false],
  ])('stays out of the way for %s', async (_label, formats, permitted, visible) => {
    state.hasPermission.mockReturnValue(permitted)
    state.showBookRequests = visible

    const wrapper = await render(formats)

    expect(wrapper.find('[role="group"]').exists()).toBe(false)
    expect(state.api).not.toHaveBeenCalled()
  })
})
