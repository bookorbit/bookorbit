import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ContentFilterChipInput from '../ContentFilterChipInput.vue'

interface Item {
  id: number
  name: string
}

function mountInput(searchFn: (query: string) => Promise<Item[]>, modelValue: Item[] = []) {
  return mount(ContentFilterChipInput, { props: { modelValue, searchFn } })
}

describe('ContentFilterChipInput', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches immediately and selects an exact existing item when Enter is pressed', async () => {
    const exact = { id: 21, name: 'Young Adult' }
    const partials = Array.from({ length: 15 }, (_, index) => ({ id: index + 1, name: `Young Adult category ${index + 1}` }))
    const searchFn = vi.fn<(query: string) => Promise<Item[]>>().mockResolvedValue([...partials, exact])
    const wrapper = mountInput(searchFn)
    const input = wrapper.get('input')

    await input.setValue('young adult')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(searchFn).toHaveBeenCalledExactlyOnceWith('young adult')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([[exact]])
    expect((input.element as HTMLInputElement).value).toBe('')
  })

  it('uses a loaded exact match without issuing a duplicate request', async () => {
    const exact = { id: 7, name: 'Caf\u00e9 Society' }
    const searchFn = vi.fn<(query: string) => Promise<Item[]>>().mockResolvedValue([{ id: 8, name: 'Cafe Society Stories' }, exact])
    const wrapper = mountInput(searchFn)
    const input = wrapper.get('input')

    await input.setValue('  CAFE SOCIETY  ')
    await vi.advanceTimersByTimeAsync(200)
    await flushPromises()
    await input.trigger('keydown', { key: 'Enter' })

    expect(searchFn).toHaveBeenCalledOnce()
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([[exact]])
  })

  it('does not create a restriction when no exact catalog item exists', async () => {
    const partials = [
      { id: 1, name: 'Young Adult Fiction' },
      { id: 2, name: 'Fiction for Young Adults' },
    ]
    const searchFn = vi.fn<(query: string) => Promise<Item[]>>().mockResolvedValue(partials)
    const wrapper = mountInput(searchFn)
    const input = wrapper.get('input')

    await input.setValue('Young Adult')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.findAll('li').map((item) => item.text())).toEqual(partials.map((item) => item.name))
    expect((input.element as HTMLInputElement).value).toBe('Young Adult')
  })

  it('ignores an older response after a newer exact match has been selected', async () => {
    let resolveOlder!: (items: Item[]) => void
    const olderResponse = new Promise<Item[]>((resolve) => {
      resolveOlder = resolve
    })
    const exact = { id: 21, name: 'Young Adult' }
    const searchFn = vi.fn<(query: string) => Promise<Item[]>>().mockReturnValueOnce(olderResponse).mockResolvedValueOnce([exact])
    const wrapper = mountInput(searchFn)
    const input = wrapper.get('input')

    await input.setValue('Young')
    await vi.advanceTimersByTimeAsync(200)
    await input.setValue('Young Adult')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    resolveOlder([{ id: 1, name: 'Young Readers' }])
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([[exact]])
    expect(wrapper.findAll('li')).toHaveLength(0)
    expect((input.element as HTMLInputElement).value).toBe('')
  })
})
