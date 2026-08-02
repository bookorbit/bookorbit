import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import type { SmartScope } from '@bookorbit/types'
import CreateSmartScopeDialog from '../CreateSmartScopeDialog.vue'

const mockState = vi.hoisted(() => ({
  createSmartScope: vi.fn<(payload: Record<string, unknown>) => Promise<SmartScope>>(),
  push: vi.fn<() => void>(),
}))

vi.mock('@/features/smart-scope/composables/useSmartScopes', () => ({
  useSmartScopes: () => ({ createSmartScope: mockState.createSmartScope }),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockState.push }),
}))

function makeSmartScope(overrides: Partial<SmartScope> = {}): SmartScope {
  return {
    id: 11,
    userId: 3,
    name: 'Unread Sci-Fi',
    icon: 'Aperture',
    filter: null,
    defaultSort: [],
    isPublic: false,
    syncToKobo: false,
    koboSyncEnabled: false,
    isOwner: true,
    displayOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

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

function mountDialog() {
  return mount(CreateSmartScopeDialog, {
    props: { open: true },
    global: {
      stubs: {
        Teleport: true,
        IconPicker: IconPickerStub,
      },
    },
  })
}

async function fillRequiredFields(wrapper: ReturnType<typeof mountDialog>, name: string): Promise<void> {
  await wrapper.find('input[type="text"]').setValue(name)
  await wrapper.find('.icon-picker').setValue('Aperture')
}

describe('CreateSmartScopeDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.createSmartScope.mockResolvedValue(makeSmartScope())
  })

  it('labels the sharing checkbox with the message the editor panel also uses', () => {
    const wrapper = mountDialog()

    expect(wrapper.text()).toContain('Visible to all users')
  })

  it('creates a shared scope when the sharing checkbox is ticked', async () => {
    const wrapper = mountDialog()

    await fillRequiredFields(wrapper, 'Shared Sci-Fi')
    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(true)
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mockState.createSmartScope).toHaveBeenCalledWith({
      name: 'Shared Sci-Fi',
      icon: 'Aperture',
      defaultSort: [],
      isPublic: true,
      syncToKobo: false,
    })
  })

  it('creates a private scope by default', async () => {
    const wrapper = mountDialog()

    await fillRequiredFields(wrapper, 'Private Sci-Fi')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mockState.createSmartScope).toHaveBeenCalledWith(expect.objectContaining({ isPublic: false, syncToKobo: false }))
  })
})
