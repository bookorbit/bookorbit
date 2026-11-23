import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import KoboReplacement from './KoboReplacement.vue'

vi.mock('@/lib/api', () => ({ api: vi.fn<typeof api>() }))
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
const card = (id: number, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  files: [{ format: 'epub' }],
  narrators: [],
  publisher: null,
  publishedYear: null,
  editionName: null,
  ...extra,
})

describe('Kobo replacement book selection', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('requires a new selection after changing the search query', async () => {
    vi.useFakeTimers()
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path === '/api/v1/books/query') {
        const query = JSON.parse(String(options?.body)) as { q: string }
        const book = query.q === 'first' ? card(1, 'First book') : card(2, 'Second book')
        return response({ items: [book], total: 1, page: 0 })
      }
      return response(null)
    })
    const wrapper = mount(KoboReplacement, {
      props: { devices: [{ id: 1, name: 'Reader', lastSeenAt: null, createdAt: '' }] },
    })
    const device = wrapper.find('select[id$="-device"]')
    const book = wrapper.find('select[id$="-result"]')
    const search = wrapper.find('input[type="search"]')
    const prepare = () => wrapper.find('button')

    await device.setValue('1')
    await search.setValue('first')
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    await book.setValue('1')
    await flushPromises()
    expect(prepare().attributes('disabled')).toBeUndefined()

    await search.setValue('second')
    await flushPromises()
    expect(prepare().attributes('disabled')).toBeDefined()
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    expect(prepare().attributes('disabled')).toBeDefined()

    await book.setValue('2')
    await flushPromises()
    await prepare().trigger('click')
    await flushPromises()
    expect(api).toHaveBeenCalledWith('/api/v1/kobo/devices/1/books/2/replacement', expect.objectContaining({ method: 'POST' }))
    expect(vi.mocked(api).mock.calls.some(([path, options]) => String(path).includes('/books/1/replacement') && options?.method === 'POST')).toBe(
      false,
    )
    wrapper.unmount()
  })

  it('names the edition of each result that shares a title', async () => {
    vi.useFakeTimers()
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === '/api/v1/books/query') {
        return response({
          items: [
            card(1, 'The Lantern Keeper', { editionName: 'First edition' }),
            card(2, 'The Lantern Keeper', { publisher: 'Northlight Books', publishedYear: 2024 }),
            card(3, 'Plain'),
          ],
          total: 3,
          page: 0,
        })
      }
      return response(null)
    })
    const wrapper = mount(KoboReplacement, { props: { devices: [{ id: 1, name: 'Reader', lastSeenAt: null, createdAt: '' }] } })
    await wrapper.find('input[type="search"]').setValue('lantern')
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()

    const options = wrapper.findAll('select[id$="-result"] option').map((option) => option.text())
    expect(options.slice(1)).toEqual(['The Lantern Keeper · First edition', 'The Lantern Keeper · Northlight Books · 2024', 'Plain'])
    wrapper.unmount()
  })
})
