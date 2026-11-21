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
      showSidebarToggle: true,
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

  it('shows and describes the PDF label while keeping the input a physical page jump', async () => {
    const wrapper = mountToolbar({ pageLabel: '24', currentPageStart: 5, currentPageEnd: 5, totalPages: 6 })
    const input = wrapper.get<HTMLInputElement>('input[aria-label="Current page"]')
    const description = input.attributes('aria-describedby')

    expect(wrapper.get('[title="24"]').text()).toBe('24')
    expect(wrapper.get(`[id="${description}"]`).text()).toBe('PDF page label: 24')
    expect(input.element.value).toBe('5')

    await input.setValue('3')
    expect(wrapper.emitted('goToPage')).toEqual([[3]])
  })

  it('exposes responsive tools without duplicating sidebar destinations', async () => {
    const wrapper = mountToolbar()

    expect(wrapper.find('button[aria-label="More PDF tools"]').exists()).toBe(true)
    // Search and Highlights are rail/sheet destinations now, so the toolbar must not offer them.
    expect(wrapper.find('button[aria-label="Search document"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="Highlights"]').exists()).toBe(false)

    const buttons = wrapper.findAll('button')
    expect(buttons.some((button) => button.text().trim() === 'Search')).toBe(false)

    await buttons.find((button) => button.text().trim() === 'Select text')!.trigger('click')
    await buttons.find((button) => button.text().trim() === 'Pan')!.trigger('click')

    expect(wrapper.emitted('selectTool')).toHaveLength(1)
    expect(wrapper.emitted('togglePan')).toHaveLength(1)
  })

  it('only offers the navigation toggle where there is no rail', async () => {
    const withRail = mountToolbar({ showSidebarToggle: false })
    expect(withRail.find('button[aria-label="Document navigation"]').exists()).toBe(false)

    const sheet = mountToolbar({ showSidebarToggle: true })
    const toggle = sheet.get('button[aria-label="Document navigation"]')
    expect(toggle.attributes('aria-expanded')).toBe('false')

    await toggle.trigger('click')
    expect(sheet.emitted('toggleSidebar')).toHaveLength(1)
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
