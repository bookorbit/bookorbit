import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ServerFontVisibility from '../ServerFontVisibility.vue'
import { makeCustomFontsMock, makeFontStore, mockFont } from './font-store-fixture'

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() },
}))

import { toast } from 'vue-sonner'

const openDyslexic = [mockFont(1, 'OpenDyslexic', 400), mockFont(2, 'OpenDyslexic', 700)]
const atkinson = mockFont(3, 'Atkinson Hyperlegible')

function mountSection(serverFonts = [...openDyslexic, atkinson]) {
  const customFonts = makeCustomFontsMock({ server: makeFontStore('server', serverFonts) })
  const wrapper = mount(ServerFontVisibility, {
    props: { customFonts: customFonts as never },
    attachTo: document.body,
  })
  return { wrapper, customFonts }
}

function togglesOf(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('button[role="switch"]')
}

describe('ServerFontVisibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('lists one row per server family, not per variant', async () => {
      const { wrapper } = mountSection()
      await flushPromises()

      expect(togglesOf(wrapper)).toHaveLength(2)
      expect(wrapper.text()).toContain('OpenDyslexic')
      expect(wrapper.text()).toContain('Atkinson Hyperlegible')
      expect(wrapper.text()).toContain('2 files')
    })

    it('renders nothing at all when the server has no fonts', async () => {
      const { wrapper } = mountSection([])
      await flushPromises()

      expect(wrapper.text()).toBe('')
      expect(togglesOf(wrapper)).toHaveLength(0)
    })

    it('explains where the fonts come from', async () => {
      const { wrapper } = mountSection()
      await flushPromises()

      expect(wrapper.text()).toContain('Server fonts (shared by admin)')
      expect(wrapper.text()).toContain('come from your server administrator')
    })

    it('counts how many are shown', async () => {
      const { wrapper } = mountSection()
      await flushPromises()

      expect(wrapper.text()).toContain('2 of 2 shown')
    })

    it('previews each family in its own typeface', async () => {
      const { wrapper } = mountSection([atkinson])
      await flushPromises()

      expect(wrapper.html()).toContain('__serverfont_atkinson_hyperlegible')
    })

    it('starts with everything enabled, since server fonts are opt-out', async () => {
      const { wrapper } = mountSection()
      await flushPromises()

      for (const toggle of togglesOf(wrapper)) {
        expect(toggle.attributes('aria-checked')).toBe('true')
      }
    })
  })

  describe('toggling', () => {
    it('hides a family when its switch is turned off', async () => {
      const { wrapper, customFonts } = mountSection()
      await flushPromises()

      await togglesOf(wrapper)[0]!.trigger('click')
      await flushPromises()

      expect(customFonts.setServerFamilyHidden).toHaveBeenCalledWith('OpenDyslexic', true)
      expect(customFonts.hiddenServerFamilies.value).toEqual(['OpenDyslexic'])
    })

    it('restores a family when its switch is turned back on', async () => {
      const { wrapper, customFonts } = mountSection()
      await flushPromises()

      await togglesOf(wrapper)[0]!.trigger('click')
      await flushPromises()
      await togglesOf(wrapper)[0]!.trigger('click')
      await flushPromises()

      expect(customFonts.setServerFamilyHidden).toHaveBeenLastCalledWith('OpenDyslexic', false)
      expect(customFonts.hiddenServerFamilies.value).toEqual([])
    })

    it('leaves the hidden family listed so it can be restored', async () => {
      const { wrapper } = mountSection()
      await flushPromises()

      await togglesOf(wrapper)[0]!.trigger('click')
      await flushPromises()

      expect(togglesOf(wrapper)).toHaveLength(2)
      expect(togglesOf(wrapper)[0]!.attributes('aria-checked')).toBe('false')
      expect(wrapper.text()).toContain('OpenDyslexic')
    })

    it('updates the shown count', async () => {
      const { wrapper } = mountSection()
      await flushPromises()

      await togglesOf(wrapper)[0]!.trigger('click')
      await flushPromises()

      expect(wrapper.text()).toContain('1 of 2 shown')
    })

    it('only affects the family that was toggled', async () => {
      const { wrapper, customFonts } = mountSection()
      await flushPromises()

      await togglesOf(wrapper)[1]!.trigger('click')
      await flushPromises()

      expect(customFonts.hiddenServerFamilies.value).toEqual(['Atkinson Hyperlegible'])
      expect(customFonts.visibleServerFamilies.value.map((f) => f.name)).toEqual(['OpenDyslexic'])
    })

    it('warns when everything has been hidden', async () => {
      const { wrapper } = mountSection()
      await flushPromises()

      expect(wrapper.text()).not.toContain('All server fonts are hidden')

      await togglesOf(wrapper)[0]!.trigger('click')
      await flushPromises()
      await togglesOf(wrapper)[1]!.trigger('click')
      await flushPromises()

      expect(wrapper.text()).toContain('All server fonts are hidden')
    })

    it('reports a failed save', async () => {
      const { wrapper, customFonts } = mountSection()
      await flushPromises()
      customFonts.setServerFamilyHidden.mockResolvedValue(false)

      await togglesOf(wrapper)[0]!.trigger('click')
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith('Failed to update server font visibility')
    })

    it('disables the switch while its save is in flight', async () => {
      const { wrapper, customFonts } = mountSection()
      await flushPromises()

      let release!: () => void
      customFonts.setServerFamilyHidden.mockReturnValue(
        new Promise<boolean>((resolve) => {
          release = () => resolve(true)
        }),
      )

      await togglesOf(wrapper)[0]!.trigger('click')
      await wrapper.vm.$nextTick()
      expect(togglesOf(wrapper)[0]!.attributes('disabled')).toBeDefined()
      // The other rows stay usable.
      expect(togglesOf(wrapper)[1]!.attributes('disabled')).toBeUndefined()

      release()
      await flushPromises()
      expect(togglesOf(wrapper)[0]!.attributes('disabled')).toBeUndefined()
    })
  })
})
