import { computed, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, type RouteLocationNormalizedLoaded, type RouteLocationRaw } from 'vue-router'
import { BarChart3, BookPlus, Highlighter, History, LayoutDashboard, Library, PackageOpen, Trophy, Users, Wrench } from '@lucide/vue'
import { Permission, type BrowseCounts, type SidebarSectionId } from '@bookorbit/types'
import { useAuth } from '@/features/auth/composables/useAuth'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useBookDockSummary } from '@/features/book-dock/composables/useBookDockSummary'
import { useBrowseCounts } from '@/composables/useBrowseCounts'
import { useBookRequestVisibility } from '@/features/book-requests/composables/useBookRequestVisibility'

/** `primary` is pinned on top; useSidebarLayout places the others among the list sections in the user's order. */
export const SIDEBAR_ZONE_IDS = ['primary', 'browse', 'reading'] as const
export type SidebarZoneId = (typeof SIDEBAR_ZONE_IDS)[number]

interface NavContext {
  hasPermission: (name: string) => boolean
  showBookRequests?: boolean
  achievementsEnabled?: boolean
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
  /** A hidden row comes back while its accent badge counts work waiting on the user. */
  returnsWithWork?: boolean
  tourId?: string
}

export interface ResolvedSidebarNavEntry {
  id: string
  label: string
  icon: Component
  to: RouteLocationRaw
  isActive: boolean
  badge: SidebarNavBadge | null
  returnsWithWork: boolean
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
  reading: 'components.sidebar.zones.reading',
}

/** Zones with a section id remember whether the user collapsed them; the rest always render. */
const ZONE_SECTION_IDS: Record<SidebarZoneId, SidebarSectionId | null> = {
  primary: null,
  browse: 'browse',
  reading: 'reading',
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
    id: 'statistics',
    labelKey: 'components.appHeader.statistics',
    icon: BarChart3,
    zone: 'reading',
    to: { name: 'statistics' },
    isActive: (route) => route.name === 'statistics',
    tourId: 'statistics-btn',
  },
  {
    id: 'reading-history',
    labelKey: 'components.appHeader.readingHistory',
    icon: History,
    zone: 'reading',
    to: { name: 'reading-history' },
    isActive: (route) => route.name === 'reading-history',
  },
  {
    id: 'achievements',
    labelKey: 'components.appHeader.achievements',
    icon: Trophy,
    zone: 'reading',
    to: { name: 'achievements' },
    isActive: (route) => route.name === 'achievements',
    visible: (context) => context.achievementsEnabled !== false,
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
    returnsWithWork: true,
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
    visible: (context) => context.showBookRequests !== false,
    badge: (context) =>
      context.outstandingRequestTotal > 0 ? { value: context.outstandingRequestTotal, label: context.outstandingRequestLabel, tone: 'accent' } : null,
    returnsWithWork: true,
  },
  {
    id: 'tools',
    labelKey: 'components.sidebar.tools',
    icon: Wrench,
    zone: 'primary',
    to: (context) => ({
      name: context.hasPermission('manage_libraries')
        ? 'tools-entity-manager'
        : context.hasPermission('library_delete_books')
          ? 'tools-duplicate-books'
          : 'tools-chapter-health',
    }),
    isActive: (route) => routeNameStartsWith(route, 'tools-'),
    permission: ['manage_libraries', 'library_delete_books', 'library_edit_metadata'],
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
    zone: 'reading',
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
    returnsWithWork: entry.returnsWithWork === true,
    tourId: entry.tourId,
  } satisfies ResolvedSidebarNavEntry
}

export function useSidebarNav(getOutstandingRequestTotal: () => number = () => 0) {
  const { t } = useI18n()
  const route = useRoute()
  const { hasPermission } = usePermissions()
  const { user } = useAuth()
  const { summary: bookDockSummary } = useBookDockSummary()
  const { counts: browseCounts } = useBrowseCounts()
  const { showBookRequests } = useBookRequestVisibility()

  const context = computed<NavContext>(() => {
    const outstandingRequestTotal = getOutstandingRequestTotal()
    const outstandingRequestLabelKey = hasPermission(Permission.ManageBookRequests)
      ? 'components.sidebar.requestBadge.allActive'
      : 'components.sidebar.requestBadge.mineActive'

    return {
      hasPermission,
      showBookRequests: showBookRequests.value,
      achievementsEnabled: user.value?.settings?.achievementPreferences?.enabled !== false,
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
