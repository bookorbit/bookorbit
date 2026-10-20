import { computed } from 'vue'
import type { SidebarLayout } from '@bookorbit/types'
import { arrangeIds, mergeSubsetOrder } from '@/components/sidebar/sidebar-layout'
import { SIDEBAR_NAV_REGISTRY, type ResolvedSidebarNavEntry } from '@/composables/useSidebarNav'
import { SIDEBAR_SECTIONS } from '@/composables/useSidebarSections'
import { defaultSidebarLayout, useSidebarPrefs } from '@/composables/useSidebarPrefs'

/** Search is the only way into ⌘K on touch devices and Dashboard is home, so neither hides or moves. */
export const SIDEBAR_LOCKED_IDS: ReadonlySet<string> = new Set(['search', 'dashboard'])

/** The top group is pinned first; these follow it, in today's order until the user moves them. */
export const SIDEBAR_DEFAULT_GROUP_ORDER: readonly string[] = ['browse', ...SIDEBAR_SECTIONS.map((section) => section.id), 'reading']

function defaultRowIds(zoneId: string): string[] {
  return SIDEBAR_NAV_REGISTRY.filter((entry) => entry.zone === zoneId).map((entry) => entry.id)
}

function copyLayout(layout: SidebarLayout): SidebarLayout {
  return {
    hidden: [...layout.hidden],
    groupOrder: [...layout.groupOrder],
    rowOrder: Object.fromEntries(Object.entries(layout.rowOrder).map(([id, ids]) => [id, [...ids]])),
  }
}

export function useSidebarLayout() {
  const { layout } = useSidebarPrefs()

  const hidden = computed(() => new Set(layout.hidden))

  function isHidden(id: string): boolean {
    return hidden.value.has(id)
  }

  function setHidden(id: string, value: boolean) {
    if (SIDEBAR_LOCKED_IDS.has(id)) return
    const next = layout.hidden.filter((entry) => entry !== id)
    if (value) next.push(id)
    layout.hidden = next
  }

  function toggleHidden(id: string) {
    setHidden(id, !isHidden(id))
  }

  /** A zone's rows in the user's order, locked rows first. Hidden rows are kept; callers decide. */
  function arrangeRows<T extends { id: string }>(zoneId: string, entries: readonly T[]): T[] {
    const order = arrangeIds(defaultRowIds(zoneId), layout.rowOrder[zoneId])
    const rank = (entry: T) => {
      const index = order.indexOf(entry.id)
      return index === -1 ? order.length : index
    }
    const arranged = [...entries].sort((a, b) => rank(a) - rank(b))
    return [...arranged.filter((entry) => SIDEBAR_LOCKED_IDS.has(entry.id)), ...arranged.filter((entry) => !SIDEBAR_LOCKED_IDS.has(entry.id))]
  }

  /** What the sidebar shows outside edit mode: hidden rows drop out unless they count work waiting. */
  function visibleRows(zoneId: string, entries: readonly ResolvedSidebarNavEntry[]): ResolvedSidebarNavEntry[] {
    return arrangeRows(zoneId, entries).filter(
      (entry) => !isHidden(entry.id) || (entry.returnsWithWork && entry.badge?.tone === 'accent' && entry.badge.value > 0),
    )
  }

  function arrangeGroups<T extends { id: string }>(groups: readonly T[]): T[] {
    const order = arrangeIds(SIDEBAR_DEFAULT_GROUP_ORDER, layout.groupOrder)
    const rank = (group: T) => {
      const index = order.indexOf(group.id)
      return index === -1 ? order.length : index
    }
    return [...groups].sort((a, b) => rank(a) - rank(b))
  }

  /** Stores the new order of the rows on screen; rows another mode or permission hides keep their slots. */
  function moveRows(zoneId: string, ordered: readonly string[]) {
    const full = arrangeIds(defaultRowIds(zoneId), layout.rowOrder[zoneId])
    layout.rowOrder = {
      ...layout.rowOrder,
      [zoneId]: mergeSubsetOrder(
        full,
        ordered.filter((id) => full.includes(id)),
      ),
    }
  }

  function moveGroups(ordered: readonly string[]) {
    const full = arrangeIds(SIDEBAR_DEFAULT_GROUP_ORDER, layout.groupOrder)
    layout.groupOrder = mergeSubsetOrder(
      full,
      ordered.filter((id) => full.includes(id)),
    )
  }

  /** Restores the stock layout and hands back the one it replaced, for Undo. */
  function resetLayout(): SidebarLayout {
    const previous = copyLayout(layout)
    Object.assign(layout, defaultSidebarLayout())
    return previous
  }

  function restoreLayout(previous: SidebarLayout) {
    Object.assign(layout, copyLayout(previous))
  }

  return { layout, isHidden, toggleHidden, arrangeRows, visibleRows, arrangeGroups, moveRows, moveGroups, resetLayout, restoreLayout }
}
