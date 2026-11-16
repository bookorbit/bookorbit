import { computed, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, type RouteLocationNormalizedLoaded, type RouteLocationRaw } from 'vue-router'
import {
  Activity,
  BarChart3,
  BookPlus,
  Highlighter,
  History,
  LayoutDashboard,
  Library,
  PackageOpen,
  Shapes,
  Trophy,
  Users,
  Wrench,
} from '@lucide/vue'
import { JOBS_VIEW_PERMISSIONS, Permission, type BrowseCounts, type SidebarSectionId } from '@bookorbit/types'
import { useAuth } from '@/features/auth/composables/useAuth'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useBookDockSummary } from '@/features/book-dock/composables/useBookDockSummary'
import { useBrowseCounts } from '@/composables/useBrowseCounts'
import { useBookRequestVisibility } from '@/features/book-requests/composables/useBookRequestVisibility'
import { useAppInfo } from '@/features/settings/composables/useAppInfo'
import { useJobsSummary } from '@/features/jobs/composables/useJobsSummary'
import { formatList } from '@/i18n/formatters'

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
  /** The server builds story guides now; until it does, the permission to build them shows no jobs. */
  storyGuidesBuilding?: boolean
  /** The viewer's own jobs, phrased for the Jobs entry; null until the summary has loaded. */
  jobs?: JobsNavState | null
}

export interface JobsNavState {
  needsYou: number
  needsYouLabel: string
  signal: SidebarNavSignal | null
}

/** Live state beside an entry's icon: the Jobs entry's glow, tint and failure mark. */
export interface SidebarNavSignal {
  /** `running` glows; `waiting` holds a still tint. Null leaves the icon as it is. */
  activity: 'running' | 'waiting' | null
  /** Failures the viewer has not dismissed: a small red mark on the icon. */
  failed: boolean
  /** Work waiting on the viewer. The count shows as the badge; the collapsed sidebar, with no room for it, shows a dot. */
  attention: boolean
  /** Tooltip lines under the label. */
  details: string[]
  /** The same lines as one sentence, for screen readers. */
  description: string
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
  signal?: (context: NavContext) => SidebarNavSignal | null
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
  signal: SidebarNavSignal | null
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

/** Tags share the Genres row: the index switches between the two. */
const GENRE_ROUTE_NAMES = new Set(['genres', 'genre-detail', 'tags', 'tag-detail'])

/** Building story guides shows jobs only while the server builds them; every other Jobs permission always does. */
function canSeeJobs(context: NavContext): boolean {
  if (context.storyGuidesBuilding === true) return true
  return JOBS_VIEW_PERMISSIONS.some((name) => name !== Permission.LibraryGenerateStoryGuide && context.hasPermission(name))
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
        : context.hasPermission('library_delete_books') || context.hasPermission('library_merge_books')
          ? 'tools-duplicate-books'
          : 'tools-chapter-health',
    }),
    isActive: (route) => routeNameStartsWith(route, 'tools-'),
    permission: ['manage_libraries', 'library_delete_books', 'library_merge_books', 'library_edit_metadata'],
  },
  {
    id: 'jobs',
    labelKey: 'jobsArea.title',
    icon: Activity,
    zone: 'primary',
    to: { name: 'jobs-activity' },
    isActive: (route) => routeNameStartsWith(route, 'jobs-'),
    permission: [...JOBS_VIEW_PERMISSIONS],
    visible: canSeeJobs,
    badge: (context) =>
      context.jobs && context.jobs.needsYou > 0 ? { value: context.jobs.needsYou, label: context.jobs.needsYouLabel, tone: 'accent' } : null,
    signal: (context) => context.jobs?.signal ?? null,
    returnsWithWork: true,
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
    id: 'genres',
    labelKey: 'components.sidebar.genres',
    icon: Shapes,
    zone: 'browse',
    to: { name: 'genres' },
    isActive: (route) => GENRE_ROUTE_NAMES.has(route.name as string),
    badge: browseBadge('genres'),
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
    signal: entry.signal ? entry.signal(context) : null,
    returnsWithWork: entry.returnsWithWork === true,
    tourId: entry.tourId,
  } satisfies ResolvedSidebarNavEntry
}

export function useSidebarNav(getOutstandingRequestTotal: () => number = () => 0) {
  const { t, te } = useI18n()
  const route = useRoute()
  const { hasPermission } = usePermissions()
  const { user } = useAuth()
  const { summary: bookDockSummary } = useBookDockSummary()
  const { counts: browseCounts } = useBrowseCounts()
  const { showBookRequests } = useBookRequestVisibility()
  const { storyGuides } = useAppInfo()
  const { summary: jobsSummary } = useJobsSummary()

  /** A type this build does not know yet still reads as a job. */
  function jobTypeLabel(type: string): string {
    const key = `jobsArea.types.${type}.label`
    return te(key) ? t(key) : t('jobsArea.unknownType')
  }

  const jobs = computed<JobsNavState | null>(() => {
    const summary = jobsSummary.value
    if (!summary) return null
    const details: string[] = []
    if (summary.running > 0) details.push(t('components.sidebar.jobs.running', { count: summary.running }))
    if (summary.waiting > 0) details.push(t('components.sidebar.jobs.waiting', { count: summary.waiting }))
    const needsYouLabel = t('components.sidebar.jobs.needsYou', { count: summary.needsYou })
    if (summary.needsYou > 0) details.push(needsYouLabel)
    if (summary.failed > 0) details.push(t('components.sidebar.jobs.failed', { count: summary.failed }))
    if (summary.background.length > 0) {
      const types = formatList(summary.background.map(jobTypeLabel))
      details.push(t('components.sidebar.jobs.background', { types }))
    }
    const activity = summary.running > 0 ? 'running' : summary.waiting > 0 ? 'waiting' : null
    const signal: SidebarNavSignal | null =
      details.length > 0 ? { activity, failed: summary.failed > 0, attention: summary.needsYou > 0, details, description: formatList(details) } : null
    return { needsYou: summary.needsYou, needsYouLabel, signal }
  })

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
      storyGuidesBuilding: storyGuides.value?.building === true,
      jobs: jobs.value,
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

  /** Whether this viewer has the Jobs entry at all, hidden by their layout or not; its summary is followed only then. */
  const jobsAllowed = computed(() => {
    const entry = SIDEBAR_NAV_REGISTRY.find((candidate) => candidate.id === 'jobs')
    return entry ? isNavEntryAllowed(entry, context.value) : false
  })

  return { zones, jobsAllowed }
}
