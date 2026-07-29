import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive, nextTick } from 'vue'
import type { SidebarCap, SidebarSectionId } from '@bookorbit/types'
import SidebarEntitySection from '../SidebarEntitySection.vue'

const sections = reactive<Record<SidebarSectionId, { open: boolean; cap: SidebarCap }>>({
  libraries: { open: true, cap: 8 },
  smartScopes: { open: true, cap: 8 },
  collections: { open: true, cap: 8 },
})

vi.mock('@/composables/useSidebarPrefs', () => ({
  useSidebarPrefs: () => ({
    sections,
    toggleSection: (id: SidebarSectionId) => {
      sections[id].open = !sections[id].open
    },
    setSectionCap: (id: SidebarSectionId, cap: SidebarCap) => {
      sections[id].cap = cap
    },
  }),
}))

vi.mock('vue-draggable-plus', () => ({
  VueDraggable: {
    name: 'VueDraggable',
    props: ['modelValue', 'disabled', 'tag'],
    template: '<div :data-drag-disabled="String(disabled)"><slot /></div>',
  },
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarGroup: { name: 'SidebarGroup', template: '<div><slot /></div>' },
  SidebarGroupContent: { name: 'SidebarGroupContent', template: '<div><slot /></div>' },
  SidebarMenu: { name: 'SidebarMenu', template: '<ul><slot /></ul>' },
  SidebarMenuItem: { name: 'SidebarMenuItem', template: '<li class="group/menu-item"><slot /></li>' },
  SidebarMenuButton: { name: 'SidebarMenuButton', template: '<div><slot /></div>' },
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: { name: 'DropdownMenu', template: '<div><slot /></div>' },
  DropdownMenuContent: { name: 'DropdownMenuContent', template: '<div><slot /></div>' },
  DropdownMenuItem: { name: 'DropdownMenuItem', template: '<button type="button"><slot /></button>' },
  DropdownMenuLabel: { name: 'DropdownMenuLabel', template: '<div><slot /></div>' },
  DropdownMenuSeparator: { name: 'DropdownMenuSeparator', template: '<div />' },
  DropdownMenuTrigger: { name: 'DropdownMenuTrigger', template: '<button type="button"><slot /></button>' },
}))

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => ({ radius: 'default' }),
}))

function makeItems(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    displayOrder: index,
    name: `Collection ${index + 1}`,
    icon: null,
    bookCount: index + 1,
  }))
}

function mountSection(itemCount: number, overrides: Record<string, unknown> = {}) {
  return mount(SidebarEntitySection, {
    props: {
      sectionId: 'collections' as SidebarSectionId,
      label: 'Collections',
      items: makeItems(itemCount),
      routeName: 'collection',
      indexRouteName: 'collections',
      activeId: null,
      fallbackIcon: 'FolderOpen',
      emptyText: 'No collections yet',
      filterLabel: 'Filter collections',
      filterPlaceholder: 'Filter collections...',
      seeAllLabel: `See all collections (${itemCount})`,
      canReorder: true,
      persistOrder: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      ...overrides,
    },
    global: {
      stubs: {
        RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
        Transition: { name: 'Transition', template: '<slot />' },
      },
    },
  })
}

function rowNames(wrapper: ReturnType<typeof mountSection>): string[] {
  return wrapper.findAll('li').map((row) => row.text())
}

describe('SidebarEntitySection', () => {
  beforeEach(() => {
    sections.collections.open = true
    sections.collections.cap = 8
  })

  describe('cap', () => {
    it('renders every row when the total sits on the cap boundary', () => {
      const wrapper = mountSection(8)

      expect(wrapper.findAll('li')).toHaveLength(8)
    })

    it('renders only the capped rows once the total exceeds the cap', () => {
      const wrapper = mountSection(9)

      expect(wrapper.findAll('li')).toHaveLength(8)
    })

    it('renders every row when the cap is set to all', async () => {
      sections.collections.cap = 'all'
      const wrapper = mountSection(20)
      await nextTick()

      expect(wrapper.findAll('li')).toHaveLength(20)
    })
  })

  describe('see-all link', () => {
    it('stays hidden while the total fits inside the cap', () => {
      const wrapper = mountSection(8)

      expect(wrapper.text()).not.toContain('See all collections')
    })

    it('appears once the total exceeds the cap', () => {
      const wrapper = mountSection(9)

      expect(wrapper.text()).toContain('See all collections (9)')
    })
  })

  describe('filter', () => {
    it('is not rendered while the total fits inside the cap', () => {
      expect(mountSection(8).find('input').exists()).toBe(false)
    })

    it('is rendered once the total exceeds the cap', () => {
      expect(mountSection(9).find('input').exists()).toBe(true)
    })

    it('matches case-insensitively on the name and reports the shown count', async () => {
      const wrapper = mountSection(12)

      await wrapper.find('input').setValue('collection 1')

      // Collection 1, 10, 11 and 12 match.
      expect(rowNames(wrapper)).toHaveLength(4)
      expect(wrapper.text()).toContain('4 of 12 shown')
    })

    it('hides the see-all link while a filter is active', async () => {
      const wrapper = mountSection(12)

      await wrapper.find('input').setValue('collection 3')

      expect(wrapper.text()).not.toContain('See all collections')
    })

    it('clears on Escape', async () => {
      const wrapper = mountSection(12)
      const input = wrapper.find('input')

      await input.setValue('collection 3')
      expect(rowNames(wrapper)).toHaveLength(1)

      await input.trigger('keydown', { key: 'Escape' })

      expect((input.element as HTMLInputElement).value).toBe('')
      expect(rowNames(wrapper)).toHaveLength(8)
    })
  })

  describe('reordering', () => {
    function reorderItem(wrapper: ReturnType<typeof mountSection>) {
      return wrapper.findAllComponents({ name: 'DropdownMenuItem' }).find((item) => item.text().trim() === 'Reorder')
    }

    function dragDisabled(wrapper: ReturnType<typeof mountSection>) {
      return wrapper.get('[data-drag-disabled]').attributes('data-drag-disabled')
    }

    it('stays off until the user enters reorder mode from the section menu', () => {
      const wrapper = mountSection(9)

      expect(dragDisabled(wrapper)).toBe('true')
      expect(wrapper.find('.drag-handle').exists()).toBe(false)
      expect(reorderItem(wrapper)).toBeDefined()
    })

    it('shows the grips and enables dragging once reorder mode is on', async () => {
      const wrapper = mountSection(9)
      const enterReorder = reorderItem(wrapper)
      if (!enterReorder) throw new Error('Expected a reorder menu item')

      await enterReorder.trigger('click')

      expect(dragDisabled(wrapper)).toBe('false')
      expect(wrapper.findAll('.drag-handle')).toHaveLength(8)
      expect(wrapper.findAllComponents({ name: 'DropdownMenuItem' }).some((item) => item.text().trim() === 'Done reordering')).toBe(true)
    })

    it('leaves reorder mode when a filter is applied, because the visible order is not the real order', async () => {
      const wrapper = mountSection(12)
      const enterReorder = reorderItem(wrapper)
      if (!enterReorder) throw new Error('Expected a reorder menu item')
      await enterReorder.trigger('click')
      expect(dragDisabled(wrapper)).toBe('false')

      await wrapper.find('input').setValue('collection 3')

      expect(dragDisabled(wrapper)).toBe('true')
      expect(wrapper.find('.drag-handle').exists()).toBe(false)
      expect(wrapper.text()).toContain('Clear the filter to reorder')
    })

    it('offers no reorder entry when the caller does not allow reordering', () => {
      const wrapper = mountSection(9, { canReorder: false })

      expect(reorderItem(wrapper)).toBeUndefined()
      expect(dragDisabled(wrapper)).toBe('true')
    })

    it('offers no reorder entry for a single-item section', () => {
      expect(reorderItem(mountSection(1))).toBeUndefined()
    })
  })

  describe('section state', () => {
    it('exposes the collapsed state through aria-expanded and aria-controls', async () => {
      const wrapper = mountSection(3)
      const toggle = wrapper.get('button[aria-expanded]')

      expect(toggle.attributes('aria-expanded')).toBe('true')
      const contentId = toggle.attributes('aria-controls')
      expect(contentId).toBeTruthy()
      expect(wrapper.find(`#${contentId}`).exists()).toBe(true)

      await toggle.trigger('click')

      expect(wrapper.get('button[aria-expanded]').attributes('aria-expanded')).toBe('false')
      expect(wrapper.find(`#${contentId}`).exists()).toBe(false)
    })

    it('shows the empty state when the section has no items', () => {
      expect(mountSection(0).text()).toContain('No collections yet')
    })

    it('renders the body regardless of stored state when alwaysOpen is set', async () => {
      sections.collections.open = false
      const wrapper = mountSection(3, { alwaysOpen: true })
      await nextTick()

      expect(wrapper.findAll('li')).toHaveLength(3)
      expect(wrapper.find('button[aria-expanded]').exists()).toBe(false)
    })
  })
})
