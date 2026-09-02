import type { InjectionKey, Ref } from 'vue'

/**
 * What the list owns and the panels inside the drawer need: where the open request sits in the
 * queue, and how to leave. Provided rather than passed as props because the panels are rendered by
 * a nested `RouterView`, which would have to forward the same props to both of them.
 */
export interface RequestDrawerContext {
  /** 1-based position in the list as shown, or 0 when the open request is not in it. */
  position: Ref<number>
  total: Ref<number>
  hasPrevious: Ref<boolean>
  hasNext: Ref<boolean>
  goPrevious: () => void
  goNext: () => void
  close: () => void
}

export const REQUEST_DRAWER: InjectionKey<RequestDrawerContext> = Symbol('request-drawer')
