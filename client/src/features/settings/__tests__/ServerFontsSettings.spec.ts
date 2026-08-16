import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { computed } from 'vue'
import { MAX_SERVER_FONTS } from '@bookorbit/types'
import ServerFontsSettings from '../ServerFontsSettings.vue'
import { makeCustomFontsMock, makeFontStore, mockFont, type MockFontStore } from './font-store-fixture'

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() },
}))

vi.mock('@/features/reader/epub/composables/useCustomFonts', () => ({
  useCustomFonts: vi.fn<() => unknown>(),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: vi.fn<() => unknown>(),
}))

vi.mock('../SettingsPageHeader.vue', () => ({
  default: { template: '<div />' },
}))

import { useCustomFonts } from '@/features/reader/epub/composables/useCustomFonts'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { toast } from 'vue-sonner'

const openDyslexic = [mockFont(1, 'OpenDyslexic', 400), mockFont(2, 'OpenDyslexic', 700)]
const atkinson = mockFont(3, 'Atkinson Hyperlegible')

function makeComposable(initialFonts = [] as Parameters<typeof makeFontStore>[1]): MockFontStore {
  const store = makeFontStore('server', initialFonts)
  vi.mocked(useCustomFonts).mockReturnValue(makeCustomFontsMock({ server: store }) as never)
  return store
}

function mountPage(props: { embedded?: boolean } = {}) {
  return mount(ServerFontsSettings, { props, attachTo: document.body })
}

describe('ServerFontsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(usePermissions).mockReturnValue({ isDemoRestrictedAccount: computed(() => false) } as never)
  })

  describe('scope wiring', () => {
    it("manages the server collection, not the current user's fonts", async () => {
      const store = makeComposable()
      mountPage()
      await flushPromises()

      expect(vi.mocked(useCustomFonts).mock.results[0]!.value.scopeStore).toHaveBeenCalledWith('server')
      expect(store.scope).toBe('server')
    })

    it('loads the collection on mount', async () => {
      const store = makeComposable()
      mountPage()
      await flushPromises()

      expect(store.fetchFonts).toHaveBeenCalled()
    })

    it('uses the server cap rather than the per-user one', async () => {
      makeComposable([...openDyslexic])
      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.text()).toContain(`2 / ${MAX_SERVER_FONTS} used`)
    })

    it('labels the list as server fonts', async () => {
      makeComposable([atkinson])
      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.text()).toContain('Server fonts')
      expect(wrapper.text()).not.toContain('Your Fonts')
    })

    it('shows a server-specific empty state', async () => {
      makeComposable()
      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.text()).toContain('No server fonts yet')
      expect(wrapper.text()).toContain("Fonts you add here appear in every user's reader.")
      expect(wrapper.get('[data-testid="font-upload-surface"]').classes()).toContain('bg-card')
      expect(wrapper.get('[data-testid="font-empty-surface"]').classes()).toContain('bg-card')
    })

    it('does not repeat the page subtitle when embedded in the settings shell', async () => {
      makeComposable()
      const wrapper = mountPage({ embedded: true })
      await flushPromises()

      expect(wrapper.text()).not.toContain('Upload fonts that every user can pick in the eBook reader')
    })
  })

  describe('font list', () => {
    it('renders families grouped by name', async () => {
      makeComposable([...openDyslexic, atkinson])
      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.text()).toContain('OpenDyslexic')
      expect(wrapper.text()).toContain('Atkinson Hyperlegible')
      expect(wrapper.text()).toContain('2 files')
      expect(wrapper.text()).toContain('1 file')
      expect(wrapper.get('[data-testid="font-list-surface"]').classes()).toContain('settings-card')
    })

    it('previews each family under a server-scoped CSS family name', async () => {
      makeComposable([atkinson])
      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.html()).toContain('__serverfont_atkinson_hyperlegible')
      expect(wrapper.html()).not.toContain('__userfont_')
    })
  })

  describe('mutations', () => {
    it('uploads a dropped file to the server collection', async () => {
      const store = makeComposable()
      store.uploadFont.mockResolvedValue({ font: atkinson, suggestedFamilyName: 'Atkinson', suggestedWeight: 400, suggestedStyle: 'normal' })
      const wrapper = mountPage()
      await flushPromises()

      const file = new File(['data'], 'Atkinson.ttf', { type: 'font/ttf' })
      await wrapper.find('label').trigger('drop', { preventDefault: vi.fn<() => void>(), dataTransfer: { files: [file] } })
      await flushPromises()

      expect(store.uploadFont).toHaveBeenCalledWith(file)
      expect(toast.success).toHaveBeenCalledWith('"Atkinson.ttf" added')
    })

    it('surfaces an upload rejection inline', async () => {
      const store = makeComposable()
      store.uploadFont.mockRejectedValue(new Error('This font file has already been uploaded'))
      const wrapper = mountPage()
      await flushPromises()

      const file = new File(['data'], 'Dupe.ttf')
      await wrapper.find('label').trigger('drop', { preventDefault: vi.fn<() => void>(), dataTransfer: { files: [file] } })
      await flushPromises()

      expect(wrapper.text()).toContain('Dupe.ttf: This font file has already been uploaded')
    })

    it('deletes a family optimistically', async () => {
      const store = makeComposable([...openDyslexic, atkinson])
      store.deleteFont.mockResolvedValue(true)
      const wrapper = mountPage()
      await flushPromises()

      const deleteBtns = wrapper.findAll('button').filter((b) => b.attributes('title') === 'Delete family')
      await deleteBtns[1]?.trigger('click')
      await flushPromises()

      expect(store.deleteFont).toHaveBeenCalledWith(atkinson.id)
      expect(store.fonts.value.some((f) => f.familyName === 'Atkinson Hyperlegible')).toBe(false)
    })

    it('restores the list and reports failure when a delete is rejected', async () => {
      const store = makeComposable([atkinson])
      store.deleteFont.mockResolvedValue(false)
      const wrapper = mountPage()
      await flushPromises()

      await wrapper
        .findAll('button')
        .find((b) => b.attributes('title') === 'Delete family')
        ?.trigger('click')
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith('Failed to delete font family')
      expect(store.fetchFonts).toHaveBeenCalledTimes(2)
    })

    it('renames a family across all of its variants', async () => {
      const store = makeComposable([...openDyslexic])
      store.updateFont.mockResolvedValue({ ...openDyslexic[0]!, familyName: 'Open Dyslexic' })
      const wrapper = mountPage()
      await flushPromises()

      await wrapper
        .findAll('button')
        .find((b) => b.attributes('title') === 'Rename family')
        ?.trigger('click')
      await flushPromises()

      const textInput = wrapper.findAll('input').find((i) => i.attributes('type') !== 'file')
      await textInput!.setValue('Open Dyslexic')
      await textInput!.trigger('keydown', { key: 'Enter' })
      await flushPromises()

      expect(store.updateFont).toHaveBeenCalledTimes(2)
      expect(store.updateFont).toHaveBeenCalledWith(1, { familyName: 'Open Dyslexic' })
      expect(store.updateFont).toHaveBeenCalledWith(2, { familyName: 'Open Dyslexic' })
    })
  })

  describe('demo restriction', () => {
    beforeEach(() => {
      vi.mocked(usePermissions).mockReturnValue({ isDemoRestrictedAccount: computed(() => true) } as never)
    })

    it('blocks uploads', async () => {
      const store = makeComposable()
      const wrapper = mountPage()
      await flushPromises()

      const file = new File(['data'], 'Test.ttf')
      await wrapper.find('label').trigger('drop', { preventDefault: vi.fn<() => void>(), dataTransfer: { files: [file] } })
      await flushPromises()

      expect(store.uploadFont).not.toHaveBeenCalled()
      expect(wrapper.find('input[type="file"]').attributes('disabled')).toBeDefined()
    })

    it('hides the management controls but keeps the list readable', async () => {
      makeComposable([atkinson])
      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.findAll('button').find((b) => b.attributes('title') === 'Rename family')).toBeUndefined()
      expect(wrapper.findAll('button').find((b) => b.attributes('title') === 'Delete family')).toBeUndefined()
      expect(wrapper.text()).toContain('Atkinson Hyperlegible')
    })
  })
})
