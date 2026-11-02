import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import type { SidebarLayout } from '@bookorbit/types'
import type { ResolvedSidebarNavEntry, SidebarNavBadge } from '../useSidebarNav'

const layout = reactive<SidebarLayout>({ hidden: [], groupOrder: [], rowOrder: {} })

vi.mock('@/composables/useSidebarPrefs', () => ({
  useSidebarPrefs: () => ({ layout }),
  defaultSidebarLayout: () => ({ hidden: [], groupOrder: [], rowOrder: {} }),
}))

vi.mock('@/composables/useSidebarSections', () => ({
  SIDEBAR_SECTIONS: [{ id: 'libraries' }, { id: 'smartScopes' }, { id: 'collections' }],
}))

vi.mock('@/composables/useSidebarNav', () => ({
  SIDEBAR_NAV_REGISTRY: [
    { id: 'dashboard', zone: 'primary' },
    { id: 'statistics', zone: 'reading' },
    { id: 'achievements', zone: 'reading' },
    { id: 'book-dock', zone: 'primary' },
    { id: 'book-requests', zone: 'primary' },
    { id: 'tools', zone: 'primary' },
    { id: 'authors', zone: 'browse' },
    { id: 'series', zone: 'browse' },
    { id: 'annotations', zone: 'reading' },
  ],
}))

const { SIDEBAR_DEFAULT_GROUP_ORDER, useSidebarLayout } = await import('../useSidebarLayout')

function entry(id: string, options: { badge?: SidebarNavBadge | null; returnsWithWork?: boolean } = {}): ResolvedSidebarNavEntry {
  return {
    id,
    label: id,
    icon: {},
    to: { name: id },
    isActive: false,
    badge: options.badge ?? null,
    returnsWithWork: options.returnsWithWork ?? false,
  }
}

const ids = (entries: { id: string }[]) => entries.map((item) => item.id)

describe('useSidebarLayout', () => {
  beforeEach(() => {
    Object.assign(layout, { hidden: [], groupOrder: [], rowOrder: {} })
  })

  it("keeps today's group order by default: Browse, the list sections, then Reading", () => {
    expect(SIDEBAR_DEFAULT_GROUP_ORDER).toEqual(['browse', 'libraries', 'smartScopes', 'collections', 'reading'])
  })

  describe('hiding', () => {
    it('toggles a row in and out of the hidden list', () => {
      const { isHidden, toggleHidden } = useSidebarLayout()

      toggleHidden('series')
      expect(isHidden('series')).toBe(true)
      expect(layout.hidden).toEqual(['series'])

      toggleHidden('series')
      expect(isHidden('series')).toBe(false)
      expect(layout.hidden).toEqual([])
    })

    it('never hides Search or Dashboard', () => {
      const { isHidden, toggleHidden } = useSidebarLayout()

      toggleHidden('search')
      toggleHidden('dashboard')

      expect(isHidden('search')).toBe(false)
      expect(isHidden('dashboard')).toBe(false)
      expect(layout.hidden).toEqual([])
    })

    it('drops hidden rows from the live sidebar', () => {
      const { toggleHidden, visibleRows } = useSidebarLayout()
      toggleHidden('series')

      expect(ids(visibleRows('browse', [entry('authors'), entry('series')]))).toEqual(['authors'])
    })

    it('brings a hidden row back while its accent badge counts work waiting', () => {
      const { toggleHidden, visibleRows } = useSidebarLayout()
      toggleHidden('book-dock')

      const idle = entry('book-dock', { returnsWithWork: true })
      const waiting = entry('book-dock', { returnsWithWork: true, badge: { value: 3, tone: 'accent' } })

      expect(ids(visibleRows('primary', [entry('dashboard'), idle]))).toEqual(['dashboard'])
      expect(ids(visibleRows('primary', [entry('dashboard'), waiting]))).toEqual(['dashboard', 'book-dock'])
    })

    it('keeps a hidden row hidden when its count is only a total', () => {
      const { toggleHidden, visibleRows } = useSidebarLayout()
      toggleHidden('annotations')

      expect(ids(visibleRows('reading', [entry('annotations', { badge: { value: 1500 } })]))).toEqual([])
    })
  })

  describe('ordering', () => {
    it('arranges rows by the stored order and keeps locked rows first', () => {
      const { arrangeRows } = useSidebarLayout()
      layout.rowOrder = { primary: ['tools', 'dashboard', 'book-dock', 'book-requests'] }

      expect(ids(arrangeRows('primary', [entry('dashboard'), entry('book-dock'), entry('book-requests'), entry('tools')]))).toEqual([
        'dashboard',
        'tools',
        'book-dock',
        'book-requests',
      ])
    })

    it('stores a row move without disturbing rows a permission keeps off screen', () => {
      const { moveRows } = useSidebarLayout()

      moveRows('primary', ['dashboard', 'tools', 'book-dock'])

      expect(layout.rowOrder.primary).toEqual(['dashboard', 'tools', 'book-requests', 'book-dock'])
    })

    it('ignores stored ids of groups and rows that no longer exist', () => {
      const { arrangeGroups, arrangeRows } = useSidebarLayout()
      layout.groupOrder = ['retired-group', 'reading', 'other-retired-group', 'browse']
      layout.rowOrder = { primary: ['retired-row', 'tools', 'dashboard'] }
      const groups = [{ id: 'browse' }, { id: 'libraries' }, { id: 'smartScopes' }, { id: 'collections' }, { id: 'reading' }]

      expect(ids(arrangeGroups(groups))).toEqual(['reading', 'browse', 'libraries', 'smartScopes', 'collections'])
      expect(ids(arrangeRows('primary', [entry('dashboard'), entry('book-dock'), entry('book-requests'), entry('tools')]))).toEqual([
        'dashboard',
        'tools',
        'book-dock',
        'book-requests',
      ])
    })

    it('ignores ids that do not belong to the zone', () => {
      const { moveRows } = useSidebarLayout()

      moveRows('browse', ['series', 'statistics', 'authors'])

      expect(layout.rowOrder.browse).toEqual(['series', 'authors'])
    })

    it('arranges and moves whole groups', () => {
      const { arrangeGroups, moveGroups } = useSidebarLayout()
      const groups = [{ id: 'browse' }, { id: 'libraries' }, { id: 'smartScopes' }, { id: 'collections' }, { id: 'reading' }]

      moveGroups(['reading', 'browse', 'libraries', 'smartScopes', 'collections'])

      expect(ids(arrangeGroups(groups))).toEqual(['reading', 'browse', 'libraries', 'smartScopes', 'collections'])
      expect(layout.groupOrder).toEqual(['reading', 'browse', 'libraries', 'smartScopes', 'collections'])
    })
  })

  it('resets to the stock layout and restores the previous one for Undo', () => {
    const { resetLayout, restoreLayout } = useSidebarLayout()
    Object.assign(layout, { hidden: ['series'], groupOrder: ['reading', 'browse'], rowOrder: { browse: ['series', 'authors'] } })

    const previous = resetLayout()
    expect(layout).toEqual({ hidden: [], groupOrder: [], rowOrder: {} })

    restoreLayout(previous)
    expect(layout).toEqual({ hidden: ['series'], groupOrder: ['reading', 'browse'], rowOrder: { browse: ['series', 'authors'] } })
  })
})
