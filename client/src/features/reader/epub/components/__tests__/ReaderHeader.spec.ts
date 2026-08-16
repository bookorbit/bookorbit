import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import ReaderHeader from '../ReaderHeader.vue'

const viewport = vi.hoisted(() => ({ isCompact: false }))

vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vueuse/core')>()
  const { computed } = await import('vue')
  return { ...actual, useMediaQuery: () => computed(() => viewport.isCompact) }
})

const PopoverStub = defineComponent({
  name: 'SettingsPopover',
  emits: ['update:open'],
  template: '<div><slot /></div>',
})

const SheetStub = defineComponent({
  name: 'SettingsSheet',
  props: { open: { type: Boolean, default: false } },
  emits: ['update:open'],
  template: '<div><slot /></div>',
})

const global = {
  stubs: {
    Tooltip: { template: '<div><slot /></div>' },
    TooltipTrigger: { template: '<div><slot /></div>' },
    TooltipContent: { template: '<div><slot /></div>' },
    Popover: PopoverStub,
    PopoverTrigger: { template: '<div><slot /></div>' },
    PopoverContent: { template: '<div><slot /></div>' },
    ReaderSettingsSheet: SheetStub,
  },
}

function mountHeader(props: Record<string, unknown> = {}) {
  return mount(ReaderHeader, {
    props: {
      chapterTitle: 'Chapter 4',
      isBookmarked: false,
      settingsOpen: false,
      footerMode: 0,
      ...props,
    },
    slots: { settingsPanel: '<p data-testid="settings-panel">Panel body</p>' },
    global,
  })
}

describe('ReaderHeader', () => {
  it('emits main toolbar actions', async () => {
    const wrapper = mountHeader()

    await wrapper.get('button[aria-label="Go back"]').trigger('click')
    await wrapper.get('button[aria-label="Table of contents"]').trigger('click')
    await wrapper.get('button[aria-label="Toggle bookmark"]').trigger('click')
    await wrapper.get('button[aria-label="Search"]').trigger('click')
    await wrapper.get('button[aria-label="Cycle footer info mode"]').trigger('click')
    await wrapper.get('button[aria-label="Keyboard Shortcuts"]').trigger('click')
    await wrapper.get('button[aria-label="Enter fullscreen"]').trigger('click')

    expect(wrapper.emitted('back')?.length).toBe(1)
    expect(wrapper.emitted('toggleSidebar')?.length).toBe(1)
    expect(wrapper.emitted('toggleBookmark')?.length).toBe(1)
    expect(wrapper.emitted('toggleSearch')?.length).toBe(1)
    expect(wrapper.emitted('cycleFooterMode')?.length).toBe(1)
    expect(wrapper.emitted('toggleHelp')?.length).toBe(1)
    expect(wrapper.emitted('toggleFullscreen')?.length).toBe(1)
    expect(wrapper.get('button[aria-label="Enter fullscreen"]').classes()).not.toContain('hidden')
  })

  describe('settings container', () => {
    it('anchors settings to a popover on wide viewports', () => {
      viewport.isCompact = false
      const wrapper = mountHeader({ settingsOpen: true })

      expect(wrapper.findComponent(PopoverStub).exists()).toBe(true)
      expect(wrapper.findComponent(SheetStub).exists()).toBe(false)

      wrapper.findComponent(PopoverStub).vm.$emit('update:open', false)
      expect(wrapper.emitted('update:settingsOpen')?.[0]).toEqual([false])
    })

    it('drops settings into a bottom sheet on compact viewports', async () => {
      viewport.isCompact = true
      const wrapper = mountHeader()

      expect(wrapper.findComponent(SheetStub).exists()).toBe(true)
      expect(wrapper.findComponent(PopoverStub).exists()).toBe(false)

      await wrapper.get('button[aria-label="Reader settings"]').trigger('click')
      expect(wrapper.emitted('update:settingsOpen')?.[0]).toEqual([true])

      wrapper.findComponent(SheetStub).vm.$emit('update:open', false)
      expect(wrapper.emitted('update:settingsOpen')?.[1]).toEqual([false])

      viewport.isCompact = false
    })

    it('renders the settings panel inside the compact sheet', () => {
      viewport.isCompact = true
      const wrapper = mountHeader({ settingsOpen: true })

      expect(wrapper.findComponent(SheetStub).find('[data-testid="settings-panel"]').exists()).toBe(true)

      viewport.isCompact = false
    })

    it('forwards the open state to the compact sheet', async () => {
      viewport.isCompact = true
      const wrapper = mountHeader()
      expect(wrapper.findComponent(SheetStub).props('open')).toBe(false)

      await wrapper.setProps({ settingsOpen: true })
      expect(wrapper.findComponent(SheetStub).props('open')).toBe(true)

      viewport.isCompact = false
    })

    it('toggles rather than only opening when the compact trigger is pressed', async () => {
      // The compact trigger used to hard-set `true`, so it could never take the panel back down.
      // The wide path gets this for free from PopoverTrigger; the compact path has to do it itself.
      viewport.isCompact = true
      const wrapper = mountHeader({ settingsOpen: true })

      await wrapper.get('button[aria-label="Reader settings"]').trigger('click')

      expect(wrapper.emitted('update:settingsOpen')?.[0]).toEqual([false])

      viewport.isCompact = false
    })
  })
})
