import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SidebarSectionHeader from '../SidebarSectionHeader.vue'
import { useSidebarCustomizeMode } from '@/composables/useSidebarCustomizeMode'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: { count?: string }) => (params?.count ? `${key}:${params.count}` : key) }),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: { name: 'DropdownMenu', template: '<div><slot /></div>' },
  DropdownMenuContent: { name: 'DropdownMenuContent', template: '<div><slot /></div>' },
  DropdownMenuItem: { name: 'DropdownMenuItem', emits: ['click'], template: '<button type="button" @click="$emit(\'click\')"><slot /></button>' },
  DropdownMenuLabel: { name: 'DropdownMenuLabel', template: '<div><slot /></div>' },
  DropdownMenuSeparator: { name: 'DropdownMenuSeparator', template: '<hr />' },
  DropdownMenuTrigger: { name: 'DropdownMenuTrigger', template: '<button type="button"><slot /></button>' },
}))

vi.mock('@/stores/theme', () => ({ useThemeStore: () => ({ radius: 'rounded' }) }))

function items(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAllComponents({ name: 'DropdownMenuItem' })
}

describe('SidebarSectionHeader', () => {
  beforeEach(() => {
    useSidebarCustomizeMode().stopCustomizing()
  })

  it('gives a nav group header a menu holding only Customize sidebar', async () => {
    const wrapper = mount(SidebarSectionHeader, { props: { label: 'Browse', isOpen: true, contentId: 'browse' } })

    expect(items(wrapper).map((item) => item.text())).toEqual(['components.sidebar.customize.open'])
    expect(wrapper.findAllComponents({ name: 'DropdownMenuSeparator' })).toHaveLength(0)

    await items(wrapper)[0]!.trigger('click')
    expect(useSidebarCustomizeMode().isCustomizing.value).toBe(true)
  })

  it('adds Customize sidebar after the section options, behind a separator', () => {
    const wrapper = mount(SidebarSectionHeader, {
      props: { label: 'Libraries', isOpen: true, contentId: 'libraries', cap: 8, canChangeCap: true, canReorder: true },
    })

    const labels = items(wrapper).map((item) => item.text())
    expect(labels.at(-2)).toBe('components.sidebar.sectionHeader.reorder')
    expect(labels.at(-1)).toBe('components.sidebar.customize.open')
    expect(wrapper.findAllComponents({ name: 'DropdownMenuSeparator' })).toHaveLength(2)
  })

  it('reserves the same 16px for an unchecked option as the menu gives the check icon', () => {
    const wrapper = mount(SidebarSectionHeader, { props: { label: 'Libraries', isOpen: true, contentId: 'libraries', cap: 8, canChangeCap: true } })

    const unchecked = items(wrapper).find((item) => item.text() === 'components.sidebar.sectionHeader.showCount:5')
    expect(unchecked?.find('span').classes()).toContain('w-4')
  })

  it('can leave the menu out entirely', () => {
    const wrapper = mount(SidebarSectionHeader, { props: { label: 'Browse', isOpen: true, contentId: 'browse', canCustomize: false } })

    expect(wrapper.findComponent({ name: 'DropdownMenu' }).exists()).toBe(false)
  })
})
