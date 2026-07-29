import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PdfReaderToolbar from '../components/PdfReaderToolbar.vue'

const passthrough = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      h('div', slots.default?.()),
})

function mountToolbar(overrides: Partial<InstanceType<typeof PdfReaderToolbar>['$props']> = {}) {
  return mount(PdfReaderToolbar, {
    props: {
      currentPageStart: 12,
      currentPageEnd: 13,
      totalPages: 240,
      zoomPercent: 100,
      sidebarOpen: false,
      searchOpen: false,
      settingsOpen: false,
      panActive: true,
      fullscreen: false,
      fullscreenSupported: true,
      headerPinned: false,
      ...overrides,
    },
    global: {
      stubs: {
        Tooltip: passthrough,
        TooltipTrigger: passthrough,
        TooltipContent: passthrough,
        DropdownMenu: passthrough,
        DropdownMenuTrigger: passthrough,
        DropdownMenuContent: passthrough,
      },
    },
  })
}

describe('PdfReaderToolbar', () => {
  it('shows the current spread and commits a clamped page number', async () => {
    const wrapper = mountToolbar()
    const input = wrapper.get('input[aria-label="Current page"]')

    expect(wrapper.text()).toContain('-13')
    expect(wrapper.text()).toContain('/ 240')

    ;(input.element as HTMLInputElement).value = '999'
    await input.trigger('change')

    expect(wrapper.emitted('goToPage')).toEqual([[240]])
    expect((input.element as HTMLInputElement).value).toBe('240')
  })

  it('keeps search available outside fullscreen and exposes responsive tools', async () => {
    const wrapper = mountToolbar()

    expect(wrapper.findAll('button[aria-label="Search document"]')).toHaveLength(1)
    expect(wrapper.find('button[aria-label="More PDF tools"]').exists()).toBe(true)

    const buttons = wrapper.findAll('button')
    await buttons.find((button) => button.text().trim() === 'Search')!.trigger('click')
    await buttons.find((button) => button.text().trim() === 'Select text')!.trigger('click')
    await buttons.find((button) => button.text().trim() === 'Pan')!.trigger('click')

    expect(wrapper.emitted('toggleSearch')).toHaveLength(1)
    expect(wrapper.emitted('selectTool')).toHaveLength(1)
    expect(wrapper.emitted('togglePan')).toHaveLength(1)
  })

  it('shows the header pin only while fullscreen', async () => {
    const windowed = mountToolbar()
    expect(windowed.find('button[aria-label="Pin reader header"]').exists()).toBe(false)

    const fullscreen = mountToolbar({ fullscreen: true })
    const pinButtons = fullscreen.findAll('button[aria-label="Pin reader header"]')
    expect(pinButtons).toHaveLength(1)

    await pinButtons[0]!.trigger('click')
    expect(fullscreen.emitted('toggleHeaderPin')).toHaveLength(1)
  })
})
