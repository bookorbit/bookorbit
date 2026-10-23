import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { AuthorSummary } from '@bookorbit/types'
import { i18n } from '@/i18n'
import AuthorTile from '../AuthorTile.vue'

function author(overrides: Partial<AuthorSummary> = {}): AuthorSummary {
  return { id: 1, name: 'Blake Crouch', sortName: null, bookCount: 3, lastAddedAt: null, coverBookId: null, ...overrides }
}

function mountTile(props: Record<string, unknown> = {}) {
  return mount(AuthorTile, {
    props: { author: author(), ...props },
    global: {
      mocks: { $t: (key: string) => key },
      stubs: {
        DropdownMenu: { template: '<div><slot /></div>' },
        DropdownMenuTrigger: { template: '<div><slot /></div>' },
        DropdownMenuContent: { template: '<div><slot /></div>' },
        DropdownMenuItem: { template: '<div><slot /></div>' },
        AuthorPortrait: { template: '<span class="portrait-stub" />' },
      },
    },
  })
}

describe('AuthorTile', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('insets and centers circular hover metadata inside the unclipped area', () => {
    const wrapper = mountTile({ shape: 'circle', author: author({ lastAddedAt: '2026-09-28T12:00:00Z' }) })
    const metadata = wrapper.get('span.bg-linear-to-t')

    // The inscribed square needs at least 14.65% padding on each edge to clear the circle.
    expect(metadata.classes()).toContain('p-[16%]')
    expect(metadata.classes()).toContain('text-center')
    expect(metadata.classes()).not.toContain('p-2')
    expect(metadata.element.children).toHaveLength(2)
  })

  it('preserves the square hover metadata layout', () => {
    const wrapper = mountTile({ shape: 'square' })
    const metadata = wrapper.get('span.bg-linear-to-t')

    expect(metadata.classes()).toContain('p-2')
    expect(metadata.classes()).not.toContain('p-[16%]')
    expect(metadata.classes()).not.toContain('text-center')
  })

  it('updates the metadata inset when the cover shape changes', async () => {
    const wrapper = mountTile({ shape: 'square' })
    const metadata = wrapper.get('span.bg-linear-to-t')

    await wrapper.setProps({ shape: 'circle' })
    expect(metadata.classes()).toContain('p-[16%]')
    expect(metadata.classes()).not.toContain('p-2')

    await wrapper.setProps({ shape: 'square' })
    expect(metadata.classes()).toContain('p-2')
    expect(metadata.classes()).not.toContain('p-[16%]')
  })

  it.each(['circle', 'square'])('reveals both metadata lines on hover or keyboard focus for %s covers', (shape) => {
    const wrapper = mountTile({ shape, author: author({ lastAddedAt: '2026-09-28T12:00:00Z' }) })
    const metadata = wrapper.get('span.bg-linear-to-t')

    expect(metadata.text()).toContain('3 books')
    expect(metadata.text()).toContain('2 weeks ago')
    expect(metadata.classes()).toEqual(
      expect.arrayContaining(['pointer-events-none', 'group-hover/tile:opacity-100', 'group-focus-within/tile:opacity-100', '@[4.5rem]:flex']),
    )
    expect(metadata.get('span.hidden').classes()).toContain('@[5.5rem]:block')
  })

  it('omits the date line when no book addition date is available', () => {
    const wrapper = mountTile({ shape: 'circle', author: author({ bookCount: 1, lastAddedAt: null }) })
    const metadata = wrapper.get('span.bg-linear-to-t')

    expect(metadata.text()).toBe('1 book')
    expect(metadata.element.children).toHaveLength(1)
  })

  it('hides hover metadata in selection mode', () => {
    const wrapper = mountTile({ shape: 'circle', selectionMode: true })

    expect(wrapper.find('span.bg-linear-to-t').exists()).toBe(false)
  })

  it('stretches the activate button over the whole tile, not just the artwork', () => {
    const wrapper = mountTile()
    const root = wrapper.element as HTMLElement
    const activate = wrapper.get('button.inset-0')

    // Sizing the target to the artwork leaves every corner of a circular tile dead
    // and never lets anyone click the name.
    expect(activate.element.parentElement).toBe(root)
    expect(activate.classes()).toContain('inset-0')
  })

  it('keeps the actions menu out of the clipped artwork so the hover transform cannot bury it', () => {
    const wrapper = mountTile()
    const root = wrapper.element as HTMLElement
    const menuButton = wrapper.get('button[aria-label^="Actions for"]')

    // The artwork lifts on hover, and a transform makes that element a stacking
    // context; a menu nested inside it renders beneath the tile's activate button.
    const clipped = root.querySelector('.overflow-hidden')
    expect(clipped).not.toBeNull()
    expect(clipped!.contains(menuButton.element)).toBe(false)
  })

  it('keeps the badges out of the clipped artwork, which a circle would crop away', () => {
    const wrapper = mountTile({ selectionMode: true, selected: true, shape: 'circle' })
    const clipped = wrapper.element.querySelector('.overflow-hidden')!
    const checkbox = [...wrapper.element.querySelectorAll('span')].find((s) => s.querySelector('svg') && /rounded-md/.test(s.className))

    expect(checkbox).toBeDefined()
    expect(clipped.contains(checkbox!)).toBe(false)
  })

  it('anchors the badges to the artwork box, not to the tile below the name', () => {
    const wrapper = mountTile({ shape: 'circle' })
    const frame = wrapper.element.querySelector('.aspect-square')!
    const badge = [...frame.querySelectorAll('span')].find((s) => /tabular-nums/.test(s.className))

    // Hanging them on the tile measures from under the name, which parks the count
    // badge beside the author's name instead of on their portrait.
    expect(badge).toBeDefined()
    expect(frame.contains(badge!)).toBe(true)
  })

  it('never lets anything stacked above the activate button swallow a click', () => {
    const wrapper = mountTile({ selectionMode: true, selected: true })
    const above = [...wrapper.element.querySelectorAll('.absolute')].filter((el) => {
      if (el.tagName === 'BUTTON' || el.querySelector('button')) return false
      return /z-(2|3|4)0/.test(el.className)
    })

    expect(above.length).toBeGreaterThan(0)
    for (const el of above) expect(el.className).toContain('pointer-events-none')
  })

  it('shows a busy overlay while refreshing without needing a hover', () => {
    const wrapper = mountTile({ refreshing: true })
    const status = wrapper.get('[role="status"]')

    expect(status.find('.animate-spin').exists()).toBe(true)
    // A spinner tucked inside the hover-revealed menu button is invisible in practice.
    expect(status.element.className).not.toContain('group-hover')
  })

  it('emits select rather than open while in selection mode', async () => {
    const wrapper = mountTile({ selectionMode: true })
    await wrapper.get('button.inset-0').trigger('click')

    expect(wrapper.emitted('select')).toHaveLength(1)
    expect(wrapper.emitted('open')).toBeUndefined()
  })

  it('opens the author on a plain click', async () => {
    const wrapper = mountTile()
    await wrapper.get('button.inset-0').trigger('click')

    expect(wrapper.emitted('open')?.[0]).toEqual([1])
  })
})
