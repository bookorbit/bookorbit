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
  DropdownMenuItem: {
    name: 'DropdownMenuItem',
    emits: ['click', 'select'],
    template: '<button type="button" @click="$emit(\'click\'); $emit(\'select\')"><slot /></button>',
  },
  DropdownMenuLabel: { name: 'DropdownMenuLabel', template: '<div><slot /></div>' },
  DropdownMenuSeparator: { name: 'DropdownMenuSeparator', template: '<hr />' },
  DropdownMenuTrigger: {
    name: 'DropdownMenuTrigger',
    props: { asChild: Boolean },
    template: '<slot v-if="asChild" /><button v-else type="button"><slot /></button>',
  },
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

  it('offers New and Import from the add menu even when Smart Scopes is collapsed and empty', async () => {
    const wrapper = mount(SidebarSectionHeader, {
      props: {
        label: 'Smart Scopes',
        isOpen: false,
        contentId: 'scopes',
        count: 0,
        canAdd: true,
        addLabel: 'New smart scope',
        importLabel: 'Import smart scope',
        canCustomize: false,
      },
    })

    const trigger = wrapper.get('button[aria-label="components.sidebar.sectionHeader.addToSection"]')
    const [create, importScope] = items(wrapper)
    expect([create?.text(), importScope?.text()]).toEqual(['New smart scope', 'Import smart scope'])
    await importScope!.trigger('click')
    expect(wrapper.emitted('import')).toEqual([[trigger.element]])
    expect(wrapper.emitted('add')).toBeUndefined()
    await create!.trigger('click')
    expect(wrapper.emitted('add')).toHaveLength(1)
  })

  it('opens creation directly when a section has no import action', async () => {
    const wrapper = mount(SidebarSectionHeader, {
      props: { label: 'Collections', isOpen: true, contentId: 'collections', canAdd: true, addLabel: 'New collection', canCustomize: false },
    })

    await wrapper.get('button[aria-label="New collection"]').trigger('click')
    expect(wrapper.emitted('add')).toHaveLength(1)
    expect(items(wrapper)).toHaveLength(0)
  })
})
