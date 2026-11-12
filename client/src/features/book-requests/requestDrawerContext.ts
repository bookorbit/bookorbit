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
  /**
   * "Pick releases" over a selection walks the picker from one request to the next. Absent when
   * the drawer was opened any other way.
   */
  pickRun?: PickRunContext
}

export interface PickRunContext {
  /** 1-based position in the run, or 0 when no run is going. */
  position: Ref<number>
  total: Ref<number>
  /** Moves on without picking anything for the request on screen. */
  skip: () => void
  /**
   * Called once a release went out and nothing more is needed on this request. Moves to the next
   * one, or ends the run, and reports whether it took over the navigation.
   */
  advance: () => boolean
}

export const REQUEST_DRAWER: InjectionKey<RequestDrawerContext> = Symbol('request-drawer')
