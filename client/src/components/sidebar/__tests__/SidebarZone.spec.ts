import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import type { SidebarCap, SidebarSectionId } from '@bookorbit/types'
import SidebarZone from '../SidebarZone.vue'

const sections = reactive<Record<SidebarSectionId, { open: boolean; cap?: SidebarCap }>>({
  browse: { open: true },
  libraries: { open: true, cap: 8 },
  podcasts: { open: true, cap: 8 },
  smartScopes: { open: true, cap: 8 },
  collections: { open: true, cap: 8 },
  podcastScopes: { open: true, cap: 8 },
  podcastCollections: { open: true, cap: 8 },
})

vi.mock('@/composables/useSidebarPrefs', () => ({
  useSidebarPrefs: () => ({
    sections,
    toggleSection: (id: SidebarSectionId) => {
      sections[id].open = !sections[id].open
    },
  }),
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarGroup: { name: 'SidebarGroup', template: '<section><slot /></section>' },
  SidebarGroupContent: { name: 'SidebarGroupContent', template: '<div><slot /></div>' },
  SidebarMenu: { name: 'SidebarMenu', template: '<ul><slot /></ul>' },
}))

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => ({ radius: 'default' }),
}))

type ZoneProps = { label?: string | null; sectionId?: SidebarSectionId; alwaysOpen?: boolean }

function mountZone(overrides: ZoneProps = {}) {
  return mount(SidebarZone, {
    props: { label: 'Browse', sectionId: 'browse' as SidebarSectionId, ...overrides },
    slots: { default: '<li>Authors</li>' },
    global: {
      stubs: {
        Transition: { name: 'Transition', template: '<slot />' },
      },
    },
  })
}

describe('SidebarZone', () => {
  beforeEach(() => {
    sections.browse.open = true
  })

  it('toggles a persisted section from its header', async () => {
    const wrapper = mountZone()
    const toggle = wrapper.get('button[aria-expanded]')

    expect(toggle.attributes('aria-expanded')).toBe('true')
    const contentId = toggle.attributes('aria-controls')
    expect(wrapper.find(`#${contentId}`).exists()).toBe(true)

    await toggle.trigger('click')
    await nextTick()

    expect(sections.browse.open).toBe(false)
    expect(wrapper.get('button[aria-expanded]').attributes('aria-expanded')).toBe('false')
    expect(wrapper.text()).not.toContain('Authors')
  })

  it('stays open in the icon rail regardless of the persisted state', () => {
    sections.browse.open = false

    const wrapper = mountZone({ alwaysOpen: true })

    expect(wrapper.text()).toContain('Authors')
    expect(wrapper.find('button[aria-expanded]').exists()).toBe(false)
  })

  it('renders a plain label and no toggle for a zone with no persisted state', () => {
    sections.browse.open = false

    const wrapper = mountZone({ sectionId: undefined })

    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.get('p').text()).toBe('Browse')
    expect(wrapper.text()).toContain('Authors')
  })
})
