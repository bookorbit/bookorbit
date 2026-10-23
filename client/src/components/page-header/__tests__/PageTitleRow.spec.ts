import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import PageTitleRow from '../PageTitleRow.vue'
import { provideSidebarContext } from '@/components/ui/sidebar/utils'

const palette = vi.hoisted(() => ({ open: vi.fn<() => void>() }))

vi.mock('@/features/command-palette/composables/useCommandPalette', () => ({
  useCommandPalette: () => ({ openPalette: palette.open }),
}))

function sidebarContext(setOpenMobile = vi.fn<(value: boolean) => void>()) {
  return {
    state: computed(() => 'expanded' as const),
    open: ref(true),
    setOpen: vi.fn<(value: boolean) => void>(),
    isMobile: ref(true),
    openMobile: ref(false),
    setOpenMobile,
    toggleSidebar: vi.fn<() => void>(),
    widthPx: ref(256),
    setWidth: vi.fn<(value: number) => void>(),
    minWidthPx: 200,
    maxWidthPx: 400,
  }
}

describe('PageTitleRow', () => {
  it('renders the eyebrow, the title as the page heading, facts and actions', () => {
    const wrapper = mount(PageTitleRow, {
      props: { eyebrow: 'Reading', title: 'Statistics' },
      slots: { facts: '<span>490 books</span>', actions: '<button>Configure</button>' },
    })

    expect(wrapper.text()).toContain('Reading')
    expect(wrapper.get('h1').text()).toBe('Statistics')
    expect(wrapper.text()).toContain('490 books')
    expect(wrapper.text()).toContain('Configure')
  })

  it('keeps the title one level down when asked', () => {
    const wrapper = mount(PageTitleRow, { props: { title: 'Theme', headingTag: 'h2', headingTestId: 'settings-page-title' } })

    expect(wrapper.find('h1').exists()).toBe(false)
    expect(wrapper.get('[data-testid="settings-page-title"]').element.tagName).toBe('H2')
  })

  it('leaves the phone menu button out when there is no sidebar to open', () => {
    const wrapper = mount(PageTitleRow, { props: { title: 'Libraries' } })

    expect(wrapper.find('[aria-label="Open sidebar"]').exists()).toBe(false)
  })

  it('opens the phone sidebar sheet and the search palette from its buttons', async () => {
    const setOpenMobile = vi.fn<(value: boolean) => void>()
    const wrapper = mount(
      {
        components: { PageTitleRow },
        setup() {
          provideSidebarContext(sidebarContext(setOpenMobile))
        },
        template: '<PageTitleRow title="Libraries" />',
      },
      {},
    )

    await wrapper.get('[aria-label="Open sidebar"]').trigger('click')
    await wrapper.get('[aria-label="Search"]').trigger('click')

    expect(setOpenMobile).toHaveBeenCalledWith(true)
    expect(palette.open).toHaveBeenCalledOnce()
  })
})
