import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { computed } from 'vue'
import FontsSettings from '../FontsSettings.vue'
import { makeCustomFontsMock, makeFontStore, mockFont } from './font-store-fixture'

// --- Mocks ---

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() },
}))

vi.mock('@/features/reader/epub/composables/useCustomFonts', () => ({
  useCustomFonts: vi.fn<() => unknown>(),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: vi.fn<() => unknown>(),
}))

const literataFonts = [mockFont(1, 'Literata', 400), mockFont(2, 'Literata', 700)]
const georgiaPro = mockFont(3, 'Georgia Pro')

import { useCustomFonts } from '@/features/reader/epub/composables/useCustomFonts'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { toast } from 'vue-sonner'

/** Builds the user-scope store and installs it as the composable's scopeStore('user'). */
function makeComposable(initialFonts: Parameters<typeof makeFontStore>[1] = []) {
  const store = makeFontStore('user', initialFonts)
  vi.mocked(useCustomFonts).mockReturnValue(makeCustomFontsMock({ user: store }) as never)
  return store
}

function makePermissions(isDemo = false) {
  return { isDemoRestrictedAccount: computed(() => isDemo) }
}

describe('FontsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(usePermissions).mockReturnValue(makePermissions(false) as never)
  })

  describe('empty state', () => {
    it('shows empty state message when no fonts are loaded', async () => {
      makeComposable()
      const wrapper = mount(FontsSettings, { attachTo: document.body })
      await flushPromises()

      expect(wrapper.text()).toContain('No fonts uploaded yet')
    })

    it('shows quota counter as 0 / 50', async () => {
      makeComposable()
      const wrapper = mount(FontsSettings, { attachTo: document.body })
      await flushPromises()

      expect(wrapper.text()).toContain('0 / 50 used')
    })
  })

  describe('with fonts', () => {
    it('renders font family names', async () => {
      makeComposable([...literataFonts, georgiaPro])
      const wrapper = mount(FontsSettings, { attachTo: document.body })
      await flushPromises()

      expect(wrapper.text()).toContain('Literata')
      expect(wrapper.text()).toContain('Georgia Pro')
    })

    it('shows correct quota count', async () => {
      makeComposable([...literataFonts, georgiaPro])
      const wrapper = mount(FontsSettings, { attachTo: document.body })
      await flushPromises()

      expect(wrapper.text()).toContain('3 / 50 used')
    })

    it('shows file count per family', async () => {
      makeComposable([...literataFonts, georgiaPro])
      const wrapper = mount(FontsSettings, { attachTo: document.body })
      await flushPromises()

      expect(wrapper.text()).toContain('2 files')
      expect(wrapper.text()).toContain('1 file')
    })
  })

  describe('upload', () => {
    it('calls uploadFont when a file is dropped', async () => {
      const composable = makeComposable()
      composable.uploadFont.mockResolvedValue({
        font: literataFonts[0],
        suggestedFamilyName: 'Literata',
        suggestedWeight: 400,
        suggestedStyle: 'normal',
      })

      const wrapper = mount(FontsSettings, { attachTo: document.body })
      await flushPromises()

      const file = new File(['data'], 'Literata.ttf', { type: 'font/ttf' })
      const label = wrapper.find('label')
      const dt = { files: [file] }
      await label.trigger('drop', { preventDefault: vi.fn<() => void>(), dataTransfer: dt })
      await flushPromises()

      expect(composable.uploadFont).toHaveBeenCalledWith(file)
      expect(toast.success).toHaveBeenCalledWith('"Literata.ttf" added')
    })

    it('shows error toast when upload fails', async () => {
      const composable = makeComposable()
      composable.uploadFont.mockRejectedValue(new Error('File too large'))

      const wrapper = mount(FontsSettings, { attachTo: document.body })
      await flushPromises()

      const file = new File(['data'], 'big.ttf')
      const label = wrapper.find('label')
      await label.trigger('drop', { preventDefault: vi.fn<() => void>(), dataTransfer: { files: [file] } })
      await flushPromises()

      expect(wrapper.text()).toContain('big.ttf: File too large')
    })

    it('dismisses an error when X is clicked', async () => {
      const composable = makeComposable()
      composable.uploadFont.mockRejectedValue(new Error('Oops'))

      const wrapper = mount(FontsSettings, { attachTo: document.body })
      await flushPromises()

      const file = new File(['data'], 'test.ttf')
      await wrapper.find('label').trigger('drop', { preventDefault: vi.fn<() => void>(), dataTransfer: { files: [file] } })
      await flushPromises()

      expect(wrapper.text()).toContain('test.ttf: Oops')

      const dismissBtn = wrapper.findAll('button').find((b) => b.find('svg').exists() && b.classes().some((c) => c.includes('shrink-0')))
      await dismissBtn?.trigger('click')

      expect(wrapper.text()).not.toContain('test.ttf: Oops')
    })
  })

  describe('delete', () => {
    it('removes font family (optimistic) and completes silently', async () => {
      const composable = makeComposable([...literataFonts, georgiaPro])
      composable.deleteFont.mockResolvedValue(true)

      const wrapper = mount(FontsSettings, { attachTo: document.body })
      await flushPromises()

      expect(wrapper.text()).toContain('Georgia Pro')

      const allButtons = wrapper.findAll('button')
      const deleteBtns = allButtons.filter((b) => b.attributes('title') === 'Delete family')
      await deleteBtns[1]?.trigger('click')
      await flushPromises()

      expect(composable.deleteFont).toHaveBeenCalledWith(georgiaPro.id)
      expect(composable.fonts.value.some((f) => f.familyName === 'Georgia Pro')).toBe(false)
    })

    it('refetches and shows error toast when family delete fails', async () => {
      const composable = makeComposable([georgiaPro])
      composable.deleteFont.mockResolvedValue(false)

      const wrapper = mount(FontsSettings, { attachTo: document.body })
      await flushPromises()

      const deleteBtn = wrapper.findAll('button').find((b) => b.attributes('title') === 'Delete family')
      await deleteBtn?.trigger('click')
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith('Failed to delete font family')
      expect(composable.fetchFonts).toHaveBeenCalled()
    })

    it('removes variant (optimistic) and completes silently', async () => {
      const composable = makeComposable([...literataFonts])
      composable.deleteFont.mockResolvedValue(true)

      const wrapper = mount(FontsSettings, { attachTo: document.body })
      await flushPromises()

      // Expand the Literata family
      const toggleBtn = wrapper.find('button')
      await toggleBtn.trigger('click')
      await flushPromises()

      const deleteVariantBtn = wrapper.findAll('button').find((b) => b.attributes('title') === 'Delete variant')
      await deleteVariantBtn?.trigger('click')
      await flushPromises()

      expect(composable.deleteFont).toHaveBeenCalledWith(literataFonts[0]!.id)
      expect(composable.fonts.value.some((f) => f.id === literataFonts[0]!.id)).toBe(false)
    })

    it('restores variant and shows error toast when variant delete fails', async () => {
      const composable = makeComposable([...literataFonts])
      composable.deleteFont.mockResolvedValue(false)

      const wrapper = mount(FontsSettings, { attachTo: document.body })
      await flushPromises()

      const toggleBtn = wrapper.find('button')
      await toggleBtn.trigger('click')
      await flushPromises()

      const deleteVariantBtn = wrapper.findAll('button').find((b) => b.attributes('title') === 'Delete variant')
      await deleteVariantBtn?.trigger('click')
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith('Failed to delete font')
      expect(composable.fonts.value.some((f) => f.id === literataFonts[0]!.id)).toBe(true)
    })
  })

  describe('inline family rename', () => {
    it('shows input when pencil is clicked and saves on Enter', async () => {
      const composable = makeComposable([georgiaPro])
      composable.updateFont.mockResolvedValue({ ...georgiaPro, familyName: 'New Name' })

      const wrapper = mount(FontsSettings, { attachTo: document.body })
      await flushPromises()

      const pencilBtn = wrapper.findAll('button').find((b) => b.attributes('title') === 'Rename family')
      await pencilBtn?.trigger('click')
      await flushPromises()

      const textInput = wrapper.findAll('input').find((i) => i.attributes('type') !== 'file')
      expect(textInput?.exists()).toBe(true)

      await textInput!.setValue('New Name')
      await textInput!.trigger('keydown', { key: 'Enter' })
      await flushPromises()

      expect(composable.updateFont).toHaveBeenCalledWith(3, { familyName: 'New Name' })
      expect(toast.success).toHaveBeenCalledWith('Renamed to "New Name"')
    })

    it('cancels edit on Escape', async () => {
      const composable = makeComposable([georgiaPro])

      const wrapper = mount(FontsSettings, { attachTo: document.body })
      await flushPromises()

      const pencilBtn = wrapper.findAll('button').find((b) => b.attributes('title') === 'Rename family')
      await pencilBtn?.trigger('click')

      const textInput = wrapper.findAll('input').find((i) => i.attributes('type') !== 'file')
      expect(textInput?.exists()).toBe(true)
      await textInput!.trigger('keydown', { key: 'Escape' })

      const afterInputs = wrapper.findAll('input').filter((i) => i.attributes('type') !== 'file')
      expect(afterInputs.length).toBe(0)
      expect(composable.updateFont).not.toHaveBeenCalled()
    })

    it('shows error and refetches if rename partially fails', async () => {
      const composable = makeComposable([...literataFonts])
      composable.updateFont.mockResolvedValueOnce({ ...literataFonts[0]!, familyName: 'New' }).mockResolvedValueOnce(null)

      const wrapper = mount(FontsSettings, { attachTo: document.body })
      await flushPromises()

      const pencilBtn = wrapper.findAll('button').find((b) => b.attributes('title') === 'Rename family')
      await pencilBtn?.trigger('click')

      const textInput = wrapper.findAll('input').find((i) => i.attributes('type') !== 'file')
      await textInput!.setValue('New')
      await textInput!.trigger('keydown', { key: 'Enter' })
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith('Failed to rename font family')
      expect(composable.fetchFonts).toHaveBeenCalled()
    })
  })

  describe('variant expand', () => {
    it('shows variant rows when family header is clicked', async () => {
      makeComposable([...literataFonts])

      const wrapper = mount(FontsSettings, { attachTo: document.body })
      await flushPromises()

      expect(wrapper.text()).not.toContain('Regular')

      // Click the family toggle button
      const toggleBtn = wrapper.find('button')
      await toggleBtn.trigger('click')
      await flushPromises()

      expect(wrapper.text()).toContain('Regular')
      expect(wrapper.text()).toContain('Bold')
    })
  })

  describe('demo restriction', () => {
    beforeEach(() => {
      vi.mocked(usePermissions).mockReturnValue(makePermissions(true) as never)
    })

    it('shows "Not available for demo accounts" text in upload zone', async () => {
      makeComposable()
      const wrapper = mount(FontsSettings, { attachTo: document.body })
      await flushPromises()

      expect(wrapper.text()).toContain('Not available for demo accounts')
    })

    it('disables the file input', async () => {
      makeComposable()
      const wrapper = mount(FontsSettings, { attachTo: document.body })
      await flushPromises()

      const fileInput = wrapper.find('input[type="file"]')
      expect(fileInput.attributes('disabled')).toBeDefined()
    })

    it('does not call uploadFont when file is dropped', async () => {
      const composable = makeComposable()

      const wrapper = mount(FontsSettings, { attachTo: document.body })
      await flushPromises()

      const file = new File(['data'], 'Test.ttf', { type: 'font/ttf' })
      const label = wrapper.find('label')
      await label.trigger('drop', { preventDefault: vi.fn<() => void>(), dataTransfer: { files: [file] } })
      await flushPromises()

      expect(composable.uploadFont).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith('Demo-restricted account cannot manage fonts')
    })

    it('hides Rename family and Delete family buttons', async () => {
      makeComposable([georgiaPro])
      const wrapper = mount(FontsSettings, { attachTo: document.body })
      await flushPromises()

      const renameFamilyBtn = wrapper.findAll('button').find((b) => b.attributes('title') === 'Rename family')
      const deleteFamilyBtn = wrapper.findAll('button').find((b) => b.attributes('title') === 'Delete family')

      expect(renameFamilyBtn).toBeUndefined()
      expect(deleteFamilyBtn).toBeUndefined()
    })

    it('hides Edit weight/style and Delete variant buttons when variants are expanded', async () => {
      makeComposable([...literataFonts])
      const wrapper = mount(FontsSettings, { attachTo: document.body })
      await flushPromises()

      const toggleBtn = wrapper.find('button')
      await toggleBtn.trigger('click')
      await flushPromises()

      const editVariantBtn = wrapper.findAll('button').find((b) => b.attributes('title') === 'Edit weight/style')
      const deleteVariantBtn = wrapper.findAll('button').find((b) => b.attributes('title') === 'Delete variant')

      expect(editVariantBtn).toBeUndefined()
      expect(deleteVariantBtn).toBeUndefined()
    })

    it('still shows font families (read access is allowed)', async () => {
      makeComposable([georgiaPro])
      const wrapper = mount(FontsSettings, { attachTo: document.body })
      await flushPromises()

      expect(wrapper.text()).toContain('Georgia Pro')
    })

    it('still shows quota counter', async () => {
      makeComposable([georgiaPro])
      const wrapper = mount(FontsSettings, { attachTo: document.body })
      await flushPromises()

      expect(wrapper.text()).toContain('1 / 50 used')
    })
  })
})
