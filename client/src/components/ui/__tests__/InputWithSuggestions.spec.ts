import { mount } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InputWithSuggestions from '../InputWithSuggestions.vue'

function mountHost(initialValue: string | null, searchFn: (query: string) => Promise<string[]>) {
  const Host = defineComponent({
    components: { InputWithSuggestions },
    setup() {
      const model = ref<string | null>(initialValue)
      return { model, searchFn }
    },
    template: '<InputWithSuggestions v-model="model" :search-fn="searchFn" />',
  })

  return mount(Host, {
    global: {
      stubs: {
        teleport: true,
      },
    },
  })
}

describe('InputWithSuggestions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not fetch suggestions on programmatic model updates', async () => {
    const searchFn = vi.fn<(query: string) => Promise<string[]>>().mockResolvedValue(['English'])
    const wrapper = mountHost(null, searchFn)

    ;(wrapper.vm as { model: string | null }).model = 'English'
    await nextTick()
    await vi.advanceTimersByTimeAsync(250)

    expect(searchFn).not.toHaveBeenCalled()
    expect(wrapper.findAll('button')).toHaveLength(0)
  })

  it('fetches suggestions after user typing in a focused input', async () => {
    const searchFn = vi.fn<(query: string) => Promise<string[]>>().mockResolvedValue(['English', 'French'])
    const wrapper = mountHost(null, searchFn)
    const input = wrapper.get('input')

    await input.trigger('focus')
    await input.setValue('En')
    await vi.advanceTimersByTimeAsync(250)
    await nextTick()

    expect(searchFn).toHaveBeenCalledWith('En')
    expect(wrapper.findAll('button')).toHaveLength(2)
  })

  it('cancels pending lookup when value is replaced programmatically', async () => {
    const searchFn = vi.fn<(query: string) => Promise<string[]>>().mockResolvedValue(['English'])
    const wrapper = mountHost(null, searchFn)
    const input = wrapper.get('input')

    await input.trigger('focus')
    await input.setValue('En')
    ;(wrapper.vm as { model: string | null }).model = 'French'
    await nextTick()
    await vi.advanceTimersByTimeAsync(250)

    expect(searchFn).not.toHaveBeenCalled()
    expect(wrapper.findAll('button')).toHaveLength(0)
  })
})
