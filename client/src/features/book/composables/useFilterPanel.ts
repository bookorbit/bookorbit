import { ref, shallowRef } from 'vue'
import type { PopoverAnchorProps } from 'reka-ui'

/** What the filter panel opens on: the field list, one root rule's value panel, or the full builder. */
export type FilterPanelView = { kind: 'fields' } | { kind: 'rule'; index: number } | { kind: 'builder' }

export type FilterPanelAnchor = NonNullable<PopoverAnchorProps['reference']>

/**
 * A token as the panel's anchor. Editing can take the token out of the search field (a rule left
 * without a value is not in the filter), so the panel stays where the token last was rather than
 * jumping to the corner of the page.
 */
function tokenAnchor(element: HTMLElement): FilterPanelAnchor {
  let lastRect = element.getBoundingClientRect()
  return {
    getBoundingClientRect() {
      if (element.isConnected) lastRect = element.getBoundingClientRect()
      return lastRect
    },
    contextElement: element,
  }
}

/**
 * The filter panel's open state for a page. The Filters button opens it on the field list; a token
 * in the search field opens it on that token's rule, anchored to the token itself.
 */
export function useFilterPanel() {
  const open = ref(false)
  const view = shallowRef<FilterPanelView>({ kind: 'fields' })
  const anchor = shallowRef<FilterPanelAnchor | null>(null)

  function show(next: FilterPanelView, element: HTMLElement | null) {
    anchor.value = element ? tokenAnchor(element) : null
    view.value = next
    open.value = true
  }

  /** The Filters button's own toggle, which always opens on the field list under the button. */
  function setOpen(value: boolean) {
    if (value && !open.value) {
      anchor.value = null
      view.value = { kind: 'fields' }
    }
    open.value = value
  }

  function openFields(element: HTMLElement | null = null) {
    show({ kind: 'fields' }, element)
  }

  /** Opens on one root rule, or on the builder when that entry is a group. */
  function openRule(index: number, element: HTMLElement | null = null) {
    show({ kind: 'rule', index }, element)
  }

  function openBuilder(element: HTMLElement | null = null) {
    show({ kind: 'builder' }, element)
  }

  function close() {
    open.value = false
  }

  return { open, view, anchor, setOpen, openFields, openRule, openBuilder, close }
}
