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
      },
      global,
    })

    const buttons = wrapper.findAll('button')
    await buttons[0]!.trigger('click')
    await buttons[1]!.trigger('click')
    await buttons[2]!.trigger('click')
    await buttons[3]!.trigger('click')
    await buttons[4]!.trigger('click')

    expect(wrapper.emitted('back')?.length).toBe(1)
    expect(wrapper.emitted('toggleSidebar')?.length).toBe(1)
    expect(wrapper.emitted('toggleBookmark')?.length).toBe(1)
    expect(wrapper.emitted('toggleSearch')?.length).toBe(1)
    expect(wrapper.emitted('toggleFullscreen')?.length).toBe(1)
  })

  it('forwards dropdown open changes', () => {
    const wrapper = mount(ReaderHeader, {
      props: {
        chapterTitle: 'Chapter 4',
        isBookmarked: true,
        settingsOpen: true,
      },
      global,
    })

    wrapper.findComponent(DropdownMenuStub).vm.$emit('update:open', false)
    expect(wrapper.emitted('update:settingsOpen')?.[0]).toEqual([false])
  })
})
