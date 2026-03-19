import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'
import { formatPageTitle } from '@/lib/page-title'

function firstText(value: unknown): string | null {
  if (Array.isArray(value)) return firstText(value[0])
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function resolveMetaTitle(route: RouteLocationNormalizedLoaded): string | null {
  for (let idx = route.matched.length - 1; idx >= 0; idx -= 1) {
    const record = route.matched[idx]
    if (!record) continue
    const entry = record.meta.title
    if (typeof entry === 'function') {
      let resolved: string | null = null
      try {
        resolved = firstText(entry(route))
      } catch {
        resolved = null
      }
      if (resolved) return resolved
      continue
    }
    if (typeof entry === 'string') {
      const resolved = firstText(entry)
      if (resolved) return resolved
    }
  }
  return null
}

function needsTitleWarning(route: RouteLocationNormalizedLoaded): boolean {
  if (!route.name) return false
  const leaf = route.matched[route.matched.length - 1]
  if (!leaf || leaf.redirect) return false
  return !resolveMetaTitle(route)
}

export function resolveRouteTitle(route: RouteLocationNormalizedLoaded): string {
  return formatPageTitle(resolveMetaTitle(route))
}

export function registerRouteTitleHook(router: Router): void {
  router.afterEach((to) => {
    if (typeof document !== 'undefined') {
      document.title = resolveRouteTitle(to)
    }

    if (import.meta.env.DEV && needsTitleWarning(to)) {
      console.warn(`[router:title] Missing meta.title for route "${String(to.name)}" at "${to.fullPath}"`)
    }
  })
}
