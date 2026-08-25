import type { RouteLocationNormalizedLoaded } from 'vue-router'

/**
 * Views are keyed by their matched path, so navigating between two params of the same route reuses
 * the mounted component. Routes marked `remountOnParamChange` opt out: the reader reads its book,
 * file and format once at setup, so moving to another book would otherwise leave it on the old file.
 */
export function resolveRouteViewKey(route: RouteLocationNormalizedLoaded): string {
  if (route.meta.remountOnParamChange === true) return route.path
  return route.matched[0]?.path ?? route.path
}
