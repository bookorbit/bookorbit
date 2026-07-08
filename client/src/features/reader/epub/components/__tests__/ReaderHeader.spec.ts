import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it } from 'vitest'
import ReaderHeader from '../ReaderHeader.vue'

const DropdownMenuStub = defineComponent({
  name: 'DropdownMenu',
  emits: ['update:open'],
  template: '<div><slot /></div>',
})

describe('ReaderHeader', () => {
  const global = {
    stubs: {
      Tooltip: { template: '<div><slot /></div>' },
      TooltipTrigger: { template: '<div><slot /></div>' },
      TooltipContent: { template: '<div><slot /></div>' },
      DropdownMenu: DropdownMenuStub,
      DropdownMenuTrigger: { template: '<div><slot /></div>' },
      DropdownMenuContent: { template: '<div><slot /></div>' },
    },
  }

  it('emits main toolbar actions', async () => {
    const wrapper = mount(ReaderHeader, {
      props: {
        chapterTitle: 'Chapter 4',
        isBookmarked: false,
        settingsOpen: false,
        footerMode: 0,
      },
      global,
    })

    await wrapper.get('button[aria-label="Go back"]').trigger('click')
    await wrapper.get('button[aria-label="Table of contents"]').trigger('click')
    await wrapper.get('button[aria-label="Toggle bookmark"]').trigger('click')
    await wrapper.get('button[aria-label="Search"]').trigger('click')
    await wrapper.get('button[aria-label="Cycle footer info mode"]').trigger('click')
    await wrapper.get('button[aria-label="Keyboard shortcuts"]').trigger('click')
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

  it('forwards dropdown open changes', () => {
    const wrapper = mount(ReaderHeader, {
      props: {
        chapterTitle: 'Chapter 4',
        isBookmarked: true,
        settingsOpen: true,
        footerMode: 1,
      },
      global,
    })

    wrapper.findComponent(DropdownMenuStub).vm.$emit('update:open', false)
    expect(wrapper.emitted('update:settingsOpen')?.[0]).toEqual([false])
  })
})
