import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import type { SmartScope } from '@bookorbit/types'
import SaveAsSmartScopeDialog from '../SaveAsSmartScopeDialog.vue'

const mockState = vi.hoisted(() => ({
  createSmartScope: vi.fn<(payload: Record<string, unknown>) => Promise<Pick<SmartScope, 'id'>>>(),
  push: vi.fn<() => void>(),
}))

vi.mock('@/features/smart-scope/composables/useSmartScopes', () => ({
  useSmartScopes: () => ({ createSmartScope: mockState.createSmartScope }),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockState.push }),
}))

const IconPickerStub = defineComponent({
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () =>
      h('input', {
        class: 'icon-picker',
        value: props.modelValue,
        onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value),
      })
  },
})

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(SaveAsSmartScopeDialog, {
    props: { open: true, filter: undefined, sort: [], ...props },
    global: { stubs: { Teleport: true, IconPicker: IconPickerStub } },
  })
}

async function submit(wrapper: ReturnType<typeof mountDialog>): Promise<void> {
  await wrapper.find('input[type="text"]').setValue('Listening')
  await wrapper.find('.icon-picker').setValue('Headphones')
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

describe('SaveAsSmartScopeDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.createSmartScope.mockResolvedValue({ id: 21 })
  })

  it('keeps the grid shape of the library the scope is saved from (issue #1926)', async () => {
    const wrapper = mountDialog({ coverAspectRatio: '1/1' })

    await submit(wrapper)

    expect(mockState.createSmartScope).toHaveBeenCalledWith(expect.objectContaining({ name: 'Listening', coverAspectRatio: '1/1' }))
    expect(mockState.push).toHaveBeenCalledWith({ name: 'smartScope', params: { id: 21 } })
  })

  it('leaves the shape to the server default when the view has none', async () => {
    const wrapper = mountDialog()

    await submit(wrapper)

    expect(mockState.createSmartScope.mock.calls[0]![0].coverAspectRatio).toBeUndefined()
  })
})
