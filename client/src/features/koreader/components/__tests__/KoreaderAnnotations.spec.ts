import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { KoreaderAnnotationItem } from '@bookorbit/types'
import KoreaderAnnotations from '../KoreaderAnnotations.vue'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

function makeAnnotation(overrides: Partial<KoreaderAnnotationItem> = {}): KoreaderAnnotationItem {
  return {
    id: 1,
    drawer: 'lighten',
    color: null,
    text: 'a memorable quote',
    note: null,
    chapter: 'Chapter 3',
    pageno: 42,
    posFormat: 'xpointer',
    deviceCreatedAt: '2026-06-01 21:14:03',
    deviceUpdatedAt: null,
    ...overrides,
  }
}

function makeResponse(data: unknown, options: { ok?: boolean; status?: number } = {}): Response {
  const { ok = true, status = ok ? 200 : 500 } = options
  return {
    ok,
    status,
    json: async () => data,
  } as Response
}

describe('KoreaderAnnotations', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it('renders nothing when there are no annotations', async () => {
    apiMock.mockResolvedValueOnce(makeResponse([]))

    const wrapper = mount(KoreaderAnnotations, { props: { bookId: 7 } })
    await flushPromises()

    expect(wrapper.find('section').exists()).toBe(false)
  })

  it('renders annotations grouped by chapter with text, note and meta', async () => {
    apiMock.mockResolvedValueOnce(
      makeResponse([makeAnnotation(), makeAnnotation({ id: 2, chapter: 'Chapter 4', note: 'my thought', text: 'second quote' })]),
    )

    const wrapper = mount(KoreaderAnnotations, { props: { bookId: 7 } })
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/koreader/books/7/annotations')
    expect(wrapper.text()).toContain('KOReader highlights and notes')
    expect(wrapper.text()).toContain('Chapter 3')
    expect(wrapper.text()).toContain('Chapter 4')
    expect(wrapper.text()).toContain('a memorable quote')
    expect(wrapper.text()).toContain('second quote')
    expect(wrapper.text()).toContain('my thought')
    expect(wrapper.text()).toContain('p. 42')
    expect(wrapper.text()).toContain('2026-06-01 21:14')
  })

  it('hides the section when the request is forbidden', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({ message: 'forbidden' }, { ok: false, status: 403 }))

    const wrapper = mount(KoreaderAnnotations, { props: { bookId: 7 } })
    await flushPromises()

    expect(wrapper.find('section').exists()).toBe(false)
  })
})
