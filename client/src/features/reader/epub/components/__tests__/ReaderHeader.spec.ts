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
    Sheet: SheetStub,
    SheetContent: { template: '<div><slot /></div>' },
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
  })
})
