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
    mediaType: 'books',
    libraryId: null,
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

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(CreateSmartScopeDialog, {
    props: { open: true, ...props },
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

  describe('podcast scopes', () => {
    it('creates a podcast scope against the given library, with default episode rules', async () => {
      mockState.createSmartScope.mockResolvedValue(makeSmartScope({ id: 21, mediaType: 'podcasts', libraryId: 4 }))
      const wrapper = mountDialog({ mediaType: 'podcasts', libraryId: 4 })

      await fillRequiredFields(wrapper, 'Short commutes')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(mockState.createSmartScope).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Short commutes',
          mediaType: 'podcasts',
          libraryId: 4,
          filter: expect.objectContaining({ filter: expect.any(String) }),
        }),
      )
    })

    it('routes to the podcast playlist view rather than the book scope one', async () => {
      mockState.createSmartScope.mockResolvedValue(makeSmartScope({ id: 21, mediaType: 'podcasts', libraryId: 4 }))
      const wrapper = mountDialog({ mediaType: 'podcasts', libraryId: 4 })

      await fillRequiredFields(wrapper, 'Short commutes')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(mockState.push).toHaveBeenCalledWith({ name: 'podcast-playlist', params: { id: 21 } })
    })

    it('hides the Kobo option, which cannot apply to podcasts', () => {
      const books = mountDialog()
      const podcasts = mountDialog({ mediaType: 'podcasts', libraryId: 4 })

      expect(books.findAll('input[type="checkbox"]')).toHaveLength(2)
      expect(podcasts.findAll('input[type="checkbox"]')).toHaveLength(1)
    })

    it('never sends syncToKobo for a podcast scope', async () => {
      mockState.createSmartScope.mockResolvedValue(makeSmartScope({ mediaType: 'podcasts', libraryId: 4 }))
      const wrapper = mountDialog({ mediaType: 'podcasts', libraryId: 4 })

      await fillRequiredFields(wrapper, 'Short commutes')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(mockState.createSmartScope).toHaveBeenCalledWith(expect.objectContaining({ syncToKobo: false }))
    })

    it('still creates a book scope by default', async () => {
      const wrapper = mountDialog()

      await fillRequiredFields(wrapper, 'Unread')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      const payload = mockState.createSmartScope.mock.calls[0]![0]
      expect(payload.mediaType).toBeUndefined()
      expect(mockState.push).toHaveBeenCalledWith({ name: 'smartScope', params: { id: 11 } })
    })
  })
})
