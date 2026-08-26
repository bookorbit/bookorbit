import { computed, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, type RouteLocationNormalizedLoaded, type RouteLocationRaw } from 'vue-router'
import { BookPlus, Highlighter, LayoutDashboard, Library, PackageOpen, Users, Wrench } from '@lucide/vue'
import { Permission, type BrowseCounts, type SidebarSectionId } from '@bookorbit/types'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useBookDockSummary } from '@/features/book-dock/composables/useBookDockSummary'
import { useBrowseCounts } from '@/composables/useBrowseCounts'

export const SIDEBAR_ZONE_IDS = ['primary', 'browse'] as const
export type SidebarZoneId = (typeof SIDEBAR_ZONE_IDS)[number]

interface NavContext {
  hasPermission: (name: string) => boolean
  bookDockTotal: number
  outstandingRequestTotal: number
  outstandingRequestLabel: string
  browseCounts: BrowseCounts | null
}

export interface SidebarNavBadge {
  value: number
  label?: string
  /** `accent` colours the chip: the number is work waiting on the user, not a library total. */
  tone?: 'default' | 'accent'
}

export interface SidebarNavEntry {
  id: string
  labelKey: string
  icon: Component
  zone: SidebarZoneId
  to: RouteLocationRaw | ((context: NavContext) => RouteLocationRaw)
  isActive: (route: RouteLocationNormalizedLoaded) => boolean
  /** Any-of: the entry is shown when the user holds at least one of these permissions. */
  permission?: string | string[]
  visible?: (context: NavContext) => boolean
  badge?: (context: NavContext) => SidebarNavBadge | null
  tourId?: string
}

export interface ResolvedSidebarNavEntry {
  id: string
  label: string
  icon: Component
  to: RouteLocationRaw
  isActive: boolean
  badge: SidebarNavBadge | null
  tourId?: string
}

export interface SidebarNavZone {
  id: SidebarZoneId
  labelKey: string | null
  sectionId: SidebarSectionId | null
  entries: ResolvedSidebarNavEntry[]
}

const ZONE_LABEL_KEYS: Record<SidebarZoneId, string | null> = {
  primary: null,
  browse: 'components.sidebar.zones.browse',
}

/** Zones with a section id remember whether the user collapsed them; the rest always render. */
const ZONE_SECTION_IDS: Record<SidebarZoneId, SidebarSectionId | null> = {
  primary: null,
  browse: 'browse',
}

function routeNameStartsWith(route: RouteLocationNormalizedLoaded, prefix: string): boolean {
  return typeof route.name === 'string' && route.name.startsWith(prefix)
}

/** Browse badges stay out of the row until the counts have loaded and there is something to count. */
function browseBadge(key: keyof BrowseCounts): (context: NavContext) => SidebarNavBadge | null {
  return (context) => {
    const total = context.browseCounts?.[key] ?? 0
    return total > 0 ? { value: total } : null
  }
}

export const SIDEBAR_NAV_REGISTRY: readonly SidebarNavEntry[] = [
  {
    id: 'dashboard',
    labelKey: 'components.sidebar.dashboard',
    icon: LayoutDashboard,
    zone: 'primary',
    to: { name: 'dashboard' },
    isActive: (route) => route.name === 'dashboard',
  },
  {
    id: 'book-dock',
    labelKey: 'components.appHeader.bookDock',
    icon: PackageOpen,
    zone: 'primary',
    to: { name: 'book-dock' },
    isActive: (route) => route.name === 'book-dock',
    permission: 'book_dock_access',
    badge: (context) => (context.bookDockTotal > 0 ? { value: context.bookDockTotal, tone: 'accent' } : null),
    tourId: 'book-dock-btn',
  },
  {
    id: 'book-requests',
    labelKey: 'bookRequests.title',
    icon: BookPlus,
    zone: 'primary',
    to: { name: 'book-requests' },
    // The drawer routes are children of this one, so the row has to stay lit while one is open.
    isActive: (route) => routeNameStartsWith(route, 'book-request'),
    permission: 'book_request_access',
    badge: (context) =>
      context.outstandingRequestTotal > 0 ? { value: context.outstandingRequestTotal, label: context.outstandingRequestLabel, tone: 'accent' } : null,
  },
  {
    id: 'tools',
    labelKey: 'components.sidebar.tools',
    icon: Wrench,
    zone: 'primary',
    to: (context) => ({ name: context.hasPermission('manage_libraries') ? 'tools-entity-manager' : 'tools-duplicate-books' }),
    isActive: (route) => routeNameStartsWith(route, 'tools-'),
    permission: ['manage_libraries', 'library_delete_books'],
  },
  {
    id: 'authors',
    labelKey: 'components.sidebar.authors',
    icon: Users,
    zone: 'browse',
    to: { name: 'authors' },
    isActive: (route) => route.name === 'authors' || route.name === 'author-detail',
    badge: browseBadge('authors'),
  },
  {
    id: 'series',
    labelKey: 'components.sidebar.series',
    icon: Library,
    zone: 'browse',
    to: { name: 'series' },
    isActive: (route) => route.name === 'series' || route.name === 'series-detail',
    badge: browseBadge('series'),
  },
  {
    id: 'annotations',
    labelKey: 'components.appHeader.annotations',
    icon: Highlighter,
    zone: 'browse',
    to: { name: 'annotations' },
    isActive: (route) => route.name === 'annotations',
    badge: browseBadge('annotations'),
  },
]

export function isNavEntryAllowed(entry: SidebarNavEntry, context: NavContext): boolean {
  if (entry.permission !== undefined) {
    const required = Array.isArray(entry.permission) ? entry.permission : [entry.permission]
    if (!required.some((name) => context.hasPermission(name))) return false
  }
  return entry.visible ? entry.visible(context) : true
}

export function resolveNavEntry(entry: SidebarNavEntry, context: NavContext, route: RouteLocationNormalizedLoaded, label: string) {
  return {
    id: entry.id,
    label,
    icon: entry.icon,
    to: typeof entry.to === 'function' ? entry.to(context) : entry.to,
    isActive: entry.isActive(route),
    badge: entry.badge ? entry.badge(context) : null,
    tourId: entry.tourId,
  } satisfies ResolvedSidebarNavEntry
}

export function useSidebarNav(getOutstandingRequestTotal: () => number = () => 0) {
  const { t } = useI18n()
  const route = useRoute()
  const { hasPermission } = usePermissions()
  const { summary: bookDockSummary } = useBookDockSummary()
  const { counts: browseCounts } = useBrowseCounts()

  const context = computed<NavContext>(() => {
    const outstandingRequestTotal = getOutstandingRequestTotal()
    const outstandingRequestLabelKey = hasPermission(Permission.ManageBookRequests)
      ? 'components.sidebar.requestBadge.allActive'
      : 'components.sidebar.requestBadge.mineActive'

    return {
      hasPermission,
      bookDockTotal: bookDockSummary.value.total,
      outstandingRequestTotal,
      outstandingRequestLabel: t(outstandingRequestLabelKey, { count: outstandingRequestTotal }),
      browseCounts: browseCounts.value,
    }
  })

  const zones = computed<SidebarNavZone[]>(() =>
    SIDEBAR_ZONE_IDS.map((zoneId) => ({
      id: zoneId,
      labelKey: ZONE_LABEL_KEYS[zoneId],
      sectionId: ZONE_SECTION_IDS[zoneId],
      entries: SIDEBAR_NAV_REGISTRY.filter((entry) => entry.zone === zoneId && isNavEntryAllowed(entry, context.value)).map((entry) =>
        resolveNavEntry(entry, context.value, route, t(entry.labelKey)),
      ),
    })).filter((zone) => zone.entries.length > 0),
  )

  return { zones }
}
