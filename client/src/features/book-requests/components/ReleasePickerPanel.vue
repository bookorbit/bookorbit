<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleX,
  Ellipsis,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  Magnet,
  Newspaper,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SearchX,
  TriangleAlert,
  X,
  Zap,
} from '@lucide/vue'
import { isBookRequestFulfiller, isGrabbableBookRequestStatus, Permission, releaseInspectionBlocksGrab } from '@bookorbit/types'
import type {
  BookRequestItem,
  BookRequestStatus,
  DownloadDelivery,
  IndexerSearchFailure,
  ReleaseCandidateItem,
  ReleaseFileInspection,
  ReleaseProfileMismatchFailure,
  ReleaseSearchCriteria,
} from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { formatChipStyle } from '@/features/book/lib/format-colors'
import { formatDate, formatLanguageName, formatList, formatNumber } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import GrabReleaseDialog from './GrabReleaseDialog.vue'
import ReleaseFileInspectionPanel from './ReleaseFileInspectionPanel.vue'
import ReleasePairTabs from './ReleasePairTabs.vue'
import type { ReleasePairTab } from './ReleasePairTabs.vue'
import RequestDrawerToolbar from './RequestDrawerToolbar.vue'
import RequestEmptyState from './RequestEmptyState.vue'
import EntityNotFound from '@/components/EntityNotFound.vue'
import { formatKey, formatKeys, languageKey } from '../releaseFacets'
import { REQUEST_DRAWER } from '../requestDrawerContext'
import { requestFailureText } from '../requestOutcome'
import { protocolChipClass, sourceChipClass, sourceDotClass } from '../sourceColors'
import type { FacetGroup } from '../composables/useReleaseFacetGroups'
import { useBookRequestActions } from '../composables/useBookRequests'
import { useBookRequestDetail } from '../composables/useBookRequestDetail'
import { useDownloadClientSummaries } from '../composables/useDownloadClients'
import { useReleaseFacetGroups } from '../composables/useReleaseFacetGroups'
import { useReleaseFilters } from '../composables/useReleaseFilters'
import { useReleaseGrab } from '../composables/useReleaseGrab'
import { peekReleaseSearch, prefetchReleaseSearch, useReleasePicker } from '../composables/useReleasePicker'
import { useReleaseSearchEditor } from '../composables/useReleaseSearchEditor'
import { useAuth } from '@/features/auth/composables/useAuth'
import { usePermissions } from '@/features/auth/composables/usePermissions'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const { hasPermission } = usePermissions()
/** See `RequestDetailPanel`: an accessor, declared before the composables that read it. */
const canManage = () => hasPermission(Permission.ManageBookRequests)

const {
  releases,
  criteria,
  indexers,
  uncoveredIndexerCount,
  enabledIndexerCount,
  configuredIndexerCount,
  profileActive,
  cached,
  loading,
  loadFailed,
  searched,
  attempts,
  inspections,
  inspecting,
  inspectionFailed,
  fetchReleases,
  inspectRelease,
  reset,
} = useReleasePicker(canManage)
const { request, loading: requestLoading, error: requestError, fetchRequest, setRequest } = useBookRequestDetail()
const { user } = useAuth()
const companionDetail = useBookRequestDetail()
/** The other half of a pair, once both ends of the link agree. */
const companion = computed(() => {
  const other = companionDetail.request.value
  return other && request.value && other.id === request.value.companionRequestId && other.companionRequestId === request.value.id ? other : null
})
const { clients, fetchClients } = useDownloadClientSummaries(canManage)
const torrentClients = computed(() => clients.value.filter((client) => client.delivery === 'torrent'))
const actions = useBookRequestActions(canManage)

/** Near-universal for spoken audio, so stating it on every row would be noise, not information. */
const COMMON_SAMPLING_RATE_HZ = 44100
/** How many clean sources are listed one by one before they collapse into their total. */
const MAX_LISTED_SOURCES = 4
/** Seeders from which a swarm reads as healthy rather than thin. */
const HEALTHY_SWARM = 20

/**
 * Every chip on a release box: one height, one shape, the colour carried by the text over a faint
 * tint of itself. The tones are written out because Tailwind only generates literal classes.
 */
const CHIP = 'inline-flex h-5 items-center gap-1 rounded-full border px-[7px] text-xs leading-none font-medium whitespace-nowrap'
const TONE_CHIPS = {
  primary: 'border-primary/40 bg-primary/10 text-primary',
  info: 'border-[var(--pill-info)]/40 bg-[var(--pill-info)]/10 text-[var(--pill-info)]',
  success: 'border-success/40 bg-success/10 text-success',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  destructive: 'border-destructive/40 bg-destructive/10 text-destructive',
} as const

const requestId = computed(() => Number(route.params.id))

/** Mirrors `RequestDetailPanel.canFulfilThis`, for whichever half it is asked about. */
function canDrive(half: BookRequestItem): boolean {
  return canManage() || (hasPermission(Permission.BookRequestSelfFulfill) && isBookRequestFulfiller(half, user.value?.id))
}

function isChoosable(half: BookRequestItem): boolean {
  return canDrive(half) && isGrabbableBookRequestStatus(half.status)
}

/** A half past choosing: its release is on its way or already in the library. */
const SETTLED_STATUSES: readonly BookRequestStatus[] = ['grabbed', 'downloading', 'importing', 'needs_review', 'available']
/** Set by the send that leaves neither half needing a release, and cleared when the picker moves. */
const finished = ref(false)
/**
 * The list the drawer sits on, without what only the first search was opened with. An ISBN picked
 * for one half's search says nothing about the other's, so switching halves searches afresh.
 */
const listQuery = computed(() => Object.fromEntries(Object.entries(route.query).filter(([key]) => key !== 'isbn' && key !== 'search')))
const pairTabs = computed<ReleasePairTab[] | null>(() => {
  const current = request.value
  const partner = companion.value
  if (!current || !partner) return null
  return [current, partner]
    .sort((a, b) => (a.mediaKind === b.mediaKind ? 0 : a.mediaKind === 'ebook' ? -1 : 1))
    .map((half) => {
      if (half.id !== current.id) return { request: half, current: false, choosable: isChoosable(half), ...peekReleaseSearch(canManage(), half.id) }
      const count = searched.value && !loading.value ? releases.value.length : null
      return { request: half, current: true, choosable: isChoosable(half), count, searching: loading.value }
    })
})

const filters = useReleaseFilters(releases)
const { visibleReleases, hasFilter, showFacets, marksBest, tiedWithBest, clearFilters, resetFilters } = filters

const expandedFiles = ref(new Set<string>())
/**
 * Null until the approver says otherwise: a search that found nothing opens the panel on its way
 * out, one that worked leaves it shut. Their choice then holds for the rest of the visit, so a
 * re-search never changes the panel's height under the pointer that started it.
 */
const searchPanelChoice = ref<boolean | null>(null)
const showEachSource = ref(false)

const {
  searchEditing,
  searchTitle,
  searchAuthors,
  searchIsbnOptions,
  selectedSearchIsbn,
  customSearchIsbn,
  searchLanguage,
  searchFormats,
  searchEditError,
  alternativeIsbns,
  titleAuthorAttempt,
  activeKeyText,
  criteriaOverrides,
  canonicalizeTypedIsbn,
  toggleSearchEditor,
  resetSearchEditor,
  selectSearchIsbn,
  selectTitleAuthorSearch,
  addCustomSearchIsbn,
  handleCustomSearchSubmit,
  isbnKeyLabel,
  runAlternativeIsbnSearch,
  runTitleAuthorSearch,
  resetSearchEditorState,
} = useReleaseSearchEditor({ request, criteria, attempts, requestId, fetchReleases, beforeSearch: startFreshSearch })

const {
  manualOpen,
  grabbing,
  holdForReview,
  clientProblem,
  openManual,
  closeManual,
  forgetRefusals,
  handleGrab,
  handleManualGrab,
  retryClient,
  isRefused,
  refusalText,
} = useReleaseGrab({
  request,
  requestId,
  grab: actions.grab,
  setRequest,
  inspectRelease,
  setFilesExpanded,
  deliveryFor,
  afterGrab,
})

/**
 * Every Send is off while one release is on its way, not only the row being inspected. The
 * inspection is a tracker round trip, and until it answers no grab has been called for this
 * request, so `actions` has nothing to be busy about yet.
 */
const busy = computed(() => grabbing.value || actions.isPending(request.value?.id))
const clientProblemTitle = computed(() => {
  const problem = clientProblem.value
  if (!problem) return ''
  const kind = problem.code === 'GRAB_CLIENT_UNAVAILABLE' ? 'unavailable' : 'refused'
  return problem.client
    ? t(`bookRequests.releases.clientProblem.${kind}`, { client: problem.client })
    : t(`bookRequests.releases.clientProblem.${kind}Unnamed`)
})
const clientProblemHint = computed(() => {
  const problem = clientProblem.value
  if (!problem) return ''
  if (problem.code === 'GRAB_CLIENT_UNAVAILABLE') return t('bookRequests.releases.clientProblem.unavailableHint')
  return problem.reason ?? t('bookRequests.releases.clientProblem.refusedHint')
})
/** A retry is the same picker; only the framing changes, so the approver knows why it reopened. */
const isRetry = computed(() => request.value?.status === 'failed')
const failureText = computed(() => (request.value ? requestFailureText(request.value, (key, named) => t(key, named)) : null))
const authorLine = computed(() => request.value?.authors.join(', ') ?? '')
const localOnlyCriteriaFacts = computed(() => (criteria.value ? localOnlyFacts(criteria.value) : []))
/**
 * Adding a source or switching one back on happens under Settings > System > Requests, which is
 * gated on managing settings. Gating this on managing requests pointed some approvers at a page
 * the router would not open for them.
 */
const canFixSources = computed(() => hasPermission(Permission.ManageAppSettings))
/**
 * The requested ISBN is not necessarily what a source ultimately searched. When every source
 * used the same fallback, headline that real query instead of claiming the ISBN produced rows.
 */
const searchHeadline = computed<{ isbn: boolean; value: string }>(() => {
  const queries = indexers.value.flatMap((indexer) => (indexer.query ? [indexer.query] : []))
  const first = queries[0]
  if (first && queries.length === indexers.value.length && queries.every((query) => query.kind === first.kind && query.value === first.value)) {
    return { isbn: first.kind === 'isbn', value: first.value }
  }
  return { isbn: Boolean(criteria.value?.activeIsbn), value: activeKeyText.value }
})
/**
 * One line per searched source, saying what it was asked and what it gave back. The query alone
 * was the old panel: it repeated the ISBN already stated above it, and stayed silent about the
 * count, the rows the hard filters dropped, and the session that had expired.
 */
const sourceRows = computed<SourceRow[]>(() =>
  indexers.value.map((indexer) => ({
    id: indexer.indexerId,
    name: indexer.indexerName,
    query: indexer.query?.value ?? null,
    echoesKey: indexer.query
      ? indexer.query.value === searchHeadline.value.value && (indexer.query.kind === 'isbn') === searchHeadline.value.isbn
      : false,
    isbnQuery: indexer.query?.kind === 'isbn',
    dotClass: sourceDotClass(indexer.color),
    ok: indexer.ok,
    count: indexer.count,
    filtered: indexer.filtered,
    failure: indexer.failure ?? null,
  })),
)
const failedSourceRows = computed(() => sourceRows.value.filter((row) => !row.ok))
const cleanSourceRows = computed(() => sourceRows.value.filter((row) => row.ok))
/**
 * Past a handful of sources the transcript is what pushes the releases off the screen, so the ones
 * with nothing to explain collapse into their total. Failures never collapse: they are the reason
 * the list is worth reading at all.
 */
const sourcesCondensed = computed(() => !showEachSource.value && cleanSourceRows.value.length > MAX_LISTED_SOURCES)
const listedSourceRows = computed(() => (sourcesCondensed.value ? failedSourceRows.value : sourceRows.value))
const condensedReleaseCount = computed(() => cleanSourceRows.value.reduce((total, row) => total + row.count, 0))
/** Nothing was searched at all, because nothing configured carries this medium. */
const nothingCoversMedium = computed(() => indexers.value.length === 0 && uncoveredIndexerCount.value > 0)
/**
 * Nothing was searched because nothing is switched on. This is not a result about the book, and
 * the panel used to report it as one: "Nothing found for 9781932382082" says the ISBN was tried
 * and came back empty, when no request was ever made and the ISBN had nothing to do with it.
 */
const noSourcesEnabled = computed(() => searched.value && enabledIndexerCount.value === 0)
/** Whether the fix is adding a source or switching one back on. Kept apart: one is a toggle. */
const noSourcesConfigured = computed(() => noSourcesEnabled.value && configuredIndexerCount.value === 0)
const noSourcesTitle = computed(() =>
  t(noSourcesConfigured.value ? 'bookRequests.releases.noSourcesConfigured' : 'bookRequests.releases.noSourcesEnabled'),
)
const noSourcesHint = computed(() => {
  if (!canFixSources.value) return t('bookRequests.releases.noSourcesAskAdmin')
  return t(noSourcesConfigured.value ? 'bookRequests.releases.noSourcesConfiguredHint' : 'bookRequests.releases.noSourcesEnabledHint')
})
/**
 * A profile is configured for this medium and not one release fell into any of its tiers. Worth
 * saying outright, because the list looks completely normal: the rows are all still here, nothing
 * is marked, and the only visible symptom is that the automation quietly grabs none of them.
 */
const nothingMatchedProfile = computed(
  () => profileActive.value && releases.value.length > 0 && releases.value.every((release) => release.tier === null),
)
const profileSettingsLink = computed(() => ({
  name: 'settings-admin-requests',
  query: { tab: 'automation' },
  hash: `#release-profile-${criteria.value?.mediaKind ?? 'ebook'}`,
}))
/**
 * A search that ran and found nothing is stated by the panel itself, which is also where the next
 * key to try lives. Repeating it below the list only put the explanation further from the fix.
 */
const searchFoundNothing = computed(
  () => searched.value && !loading.value && releases.value.length === 0 && !nothingCoversMedium.value && !noSourcesEnabled.value,
)
const searchPanelOpen = computed(() => searchPanelChoice.value ?? searchFoundNothing.value)

type CriteriaFact = { key: string; label: string; value: string }
type SourceRow = {
  id: number
  name: string
  /** The exact string sent, or null where no installed adapter matched this source. */
  query: string | null
  /** Whether it was handed the key stated above the list, so the row can say so in words. */
  echoesKey: boolean
  isbnQuery: boolean
  dotClass: string
  ok: boolean
  count: number
  filtered: number
  failure: IndexerSearchFailure | null
}

function localOnlyFacts(value: ReleaseSearchCriteria): CriteriaFact[] {
  return [
    {
      key: 'mediaKind',
      label: t('bookRequests.releases.criteria.mediaKind'),
      value: t(`bookRequests.mediaKind.${value.mediaKind}`),
    },
    ...(value.language ? [{ key: 'language', label: t('bookRequests.releases.criteria.language'), value: formatLanguageName(value.language) }] : []),
    ...(value.authors.length > 1
      ? [{ key: 'additionalAuthors', label: t('bookRequests.releases.criteria.additionalAuthors'), value: value.authors.slice(1).join(', ') }]
      : []),
    ...(value.preferredFormats.length
      ? [
          {
            key: 'formats',
            label: t('bookRequests.releases.criteria.formats'),
            value: value.preferredFormats.map((format) => format.toUpperCase()).join(', '),
          },
        ]
      : []),
  ]
}

/**
 * A value every release shares tells the approver nothing about which one to pick, so it is
 * stated once above the list and dropped from the rows. Searching Project Gutenberg for one book
 * returns eight EPUBs, all freeleech, all from the same indexer: four of the old nine columns
 * were constant, and the two that actually differed were the two being crushed for space.
 */
function sharedValue<T>(read: (release: ReleaseCandidateItem) => T | null): T | null {
  const [head] = releases.value
  if (!head) return null
  const first = read(head)
  if (first === null) return null
  return releases.value.every((release) => read(release) === first) ? first : null
}

/** Keyed by source because the assigned colour belongs to the configured source, not a release. */
const colorByIndexer = computed(() => new Map(indexers.value.map((indexer) => [indexer.indexerId, indexer.color])))
const sharedLanguage = computed(() => sharedValue((release) => languageKey(release.language)))
/**
 * Only where every release is that one format and nothing else. A release carrying three formats
 * has no single one to be summarised by, and hoisting its first into "all EPUB" would state
 * something about the other two that is not true.
 */
const sharedFormat = computed(() => sharedValue((release) => (release.formats.length === 1 ? formatKey(release.format) : null)))
const sharedIndexerId = computed(() => sharedValue((release) => release.indexerId))
const sharedIndexer = computed(() => sharedValue((release) => release.indexerName))
const sharedIndexerDot = computed(() => (sharedIndexerId.value === null ? '' : sourceDotClass(colorByIndexer.value.get(sharedIndexerId.value))))
const allFreeleech = computed(() => releases.value.length > 0 && releases.value.every((release) => release.freeleech))

const summaryFacts = computed(() => {
  const facts: string[] = []
  if (allFreeleech.value) facts.push(t('bookRequests.releases.allFreeleech'))
  if (sharedLanguage.value) facts.push(t('bookRequests.releases.allLanguage', { language: sharedLanguage.value }))
  if (sharedFormat.value) facts.push(t('bookRequests.releases.allFormat', { format: sharedFormat.value }))
  // A single source already implies its protocol; several that share one would otherwise never say it.
  if (sharedDelivery.value && !sharedIndexer.value) facts.push(t(`bookRequests.releases.allProtocol.${sharedDelivery.value}`))
  return facts
})

/**
 * Whether each searched source joins a swarm at all, which is a property of the adapter and not
 * of any one release. Without it the panel could only guess from the list, and a single tracker
 * reporting seeders made every Library Genesis row read "seeders unknown" - which was not the
 * source omitting a count, but a plain HTTP library that has no swarm to count.
 */
const swarmByIndexer = computed(() => new Map(indexers.value.map((indexer) => [indexer.indexerId, indexer.seedsBack])))
const deliveryByIndexer = computed(() => new Map(indexers.value.map((indexer) => [indexer.indexerId, indexer.delivery])))
const sharedDelivery = computed(() => sharedValue((release) => deliveryFor(release)))

const { facetGroups } = useReleaseFacetGroups(filters, colorByIndexer, allFreeleech)

/** Sort leads the bar; the facets that narrow the list sit behind it, the two toggles last. */
const sortGroup = computed(() => facetGroups.value.find((group) => group.key === 'sort') ?? null)
const FACET_ORDER = ['format', 'language', 'files', 'audio', 'source'] as const
const facetMenus = computed(() => FACET_ORDER.flatMap((key) => facetGroups.value.filter((group) => group.key === key)))
const flagToggles = computed(() => facetGroups.value.find((group) => group.key === 'flags')?.options ?? [])
/** Which filter's menu is open, so choosing an option can close it. */
const openFacet = ref<string | null>(null)

function activeLabel(group: FacetGroup): string | null {
  const active = group.options.filter((option) => option.active).map((option) => option.label)
  return active.length ? formatList(active) : null
}

function setFacetOpen(key: string, open: boolean): void {
  openFacet.value = open ? key : openFacet.value === key ? null : openFacet.value
}

function chooseFacet(option: FacetGroup['options'][number]): void {
  option.select()
  openFacet.value = null
}

/** Every choice in the group goes, which for Audio can be a channel count and a bitrate floor. */
function clearFacet(group: FacetGroup): void {
  for (const option of group.options) if (option.active) option.select()
}

function toggleFlag(option: FacetGroup['options'][number]): void {
  option.select()
}

/**
 * Rows by profile tier, best first, then everything no tier took. A list with no profile, or one
 * where no release reached any tier, has nothing to group by and is one run.
 */
interface ReleaseGroup {
  key: string
  title: string | null
  outside: boolean
  rows: { release: ReleaseCandidateItem; index: number }[]
}

const grouped = computed(() => releases.value.some((release) => release.tier !== null))

const releaseGroups = computed<ReleaseGroup[]>(() => {
  const rows = visibleReleases.value.map((release, index) => ({ release, index }))
  if (!grouped.value) return [{ key: 'all', title: null, outside: false, rows }]
  const out: ReleaseGroup[] = []
  for (const row of rows) {
    const key = row.release.tier === null ? 'outside' : `tier-${row.release.tier}`
    let group = out.at(-1)
    if (!group || group.key !== key) {
      const outside = row.release.tier === null
      group = { key, title: outside ? t('bookRequests.releases.group.outside') : (row.release.tierName ?? ''), outside, rows: [] }
      out.push(group)
    }
    group.rows.push(row)
  }
  return out
})

const mediumLabel = computed(() => t(`bookRequests.mediaKind.${criteria.value?.mediaKind ?? 'ebook'}`))

/** Only what separates this release from the others; the rest is already in the summary line. */
const expandedScores = ref(new Set<string>())

/** One fact on a box's line of facts, after the format pills that lead it. */
interface RowFact {
  key: string
  text: string
  /** Aligns digits between boxes, for the facts that are numbers rather than names. */
  numeric?: boolean
  /** Where the fact's colour says something of its own, such as how healthy the swarm is. */
  tone?: string
  /** Left to the score details on a phone, where the line has no room for it. */
  wideOnly?: boolean
}

onMounted(async () => {
  await Promise.all([fetchRequest(requestId.value), fetchClients()])
  if (Number.isInteger(requestId.value)) void fetchInitialReleases(requestId.value)
})

watch(
  () => request.value?.companionRequestId ?? null,
  (companionId) => {
    if (companionId === null) {
      companionDetail.request.value = null
      return
    }
    void companionDetail.fetchRequest(companionId, { background: companionDetail.request.value?.id === companionId })
  },
)

// Both halves are searched once the picker is open on either, so the second never makes anyone wait.
watch(
  () => (companion.value && isChoosable(companion.value) ? companion.value.id : null),
  (companionId) => {
    if (companionId !== null) prefetchReleaseSearch(canManage(), companionId)
  },
)

watch(requestId, (id) => {
  if (!Number.isInteger(id)) return
  reset()
  resetSearchEditorState()
  searchPanelChoice.value = null
  showEachSource.value = false
  expandedFiles.value = new Set()
  resetFilters()
  finished.value = false
  // Switching between the halves of a pair: both are already loaded, so they trade places at once.
  const partner = companion.value
  const previous = request.value
  if (partner && previous && partner.id === id) {
    setRequest(partner)
    companionDetail.setRequest(previous)
    void fetchRequest(id, { background: true })
  } else {
    void fetchRequest(id)
  }
  void fetchInitialReleases(id)
})

/**
 * Where a sent release leaves a pair: on the other half while it still needs one, on a closing
 * state once neither does, and otherwise back on the request as for any single release.
 */
function afterGrab(item: BookRequestItem): void {
  const partner = companion.value
  if (partner && isChoosable(partner)) {
    void router.push({ name: 'book-request-releases', params: { id: partner.id }, query: listQuery.value })
    return
  }
  // Picking releases for a selection: this request is done, so the run moves on to the next one.
  if (pickRunActive.value && drawer?.pickRun?.advance()) return
  if (partner && SETTLED_STATUSES.includes(partner.status)) {
    finished.value = true
    return
  }
  void router.push({ name: 'book-request-detail', params: { id: item.id }, query: route.query })
}

function closeDrawer(): void {
  void router.push({ name: 'book-requests', query: listQuery.value })
}

const drawer = inject(REQUEST_DRAWER, null)
const pickRunActive = computed(() => (drawer?.pickRun?.position.value ?? 0) > 0)

function skipInRun(): void {
  drawer?.pickRun?.skip()
}

function releaseKey(release: ReleaseCandidateItem): string {
  return `${release.indexerId}:${release.guid}`
}

/** The band has to read before the number does, so the score square is tinted in it. */
function scoreClass(score: number): string {
  if (score >= 70) {
    return 'border-[color-mix(in_oklab,var(--success)_45%,transparent)] bg-[color-mix(in_oklab,var(--success)_10%,transparent)] text-success'
  }
  if (score >= 55) return 'border-[color-mix(in_oklab,var(--info)_45%,transparent)] bg-[color-mix(in_oklab,var(--info)_10%,transparent)] text-info'
  if (score >= 40) {
    return 'border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] text-warning'
  }
  return 'border-[color-mix(in_oklab,var(--muted-foreground)_45%,transparent)] bg-[color-mix(in_oklab,var(--muted-foreground)_10%,transparent)] text-muted-foreground'
}

function isBest(index: number): boolean {
  return marksBest.value && index === 0
}

function isExpanded(release: ReleaseCandidateItem): boolean {
  return expandedScores.value.has(releaseKey(release))
}

function filesAreExpanded(release: ReleaseCandidateItem): boolean {
  return expandedFiles.value.has(releaseKey(release))
}

function inspectionFor(release: ReleaseCandidateItem): ReleaseFileInspection | null {
  return inspections.value.get(releaseKey(release)) ?? null
}

function isInspecting(release: ReleaseCandidateItem): boolean {
  return inspecting.value.has(releaseKey(release))
}

function inspectionHasFailed(release: ReleaseCandidateItem): boolean {
  return inspectionFailed.value.has(releaseKey(release))
}

/** What the tracker said, where it said anything. Null falls back to the generic copy. */
function inspectionFailureReason(release: ReleaseCandidateItem): string | null {
  return inspectionFailed.value.get(releaseKey(release)) ?? null
}

function inspectionBlocksSend(release: ReleaseCandidateItem): boolean {
  return releaseInspectionBlocksGrab(inspectionFor(release)?.status)
}

function setFilesExpanded(release: ReleaseCandidateItem, expanded: boolean): void {
  const key = releaseKey(release)
  const next = new Set(expandedFiles.value)
  if (expanded) next.add(key)
  else next.delete(key)
  expandedFiles.value = next
}

async function toggleFiles(release: ReleaseCandidateItem): Promise<void> {
  if (filesAreExpanded(release)) {
    setFilesExpanded(release, false)
    return
  }

  setFilesExpanded(release, true)
  await inspectRelease(requestId.value, release)
}

function toggleWhy(release: ReleaseCandidateItem) {
  const key = releaseKey(release)
  const next = new Set(expandedScores.value)
  if (!next.delete(key)) next.add(key)
  expandedScores.value = next
}

/**
 * A swarm source always states its position, "unknown" included: on a tracker that really is the
 * release omitting a count, and worth the approver's attention. A source that serves the file
 * itself says nothing, because there is nothing there to be unknown about.
 */
function showsSeeders(release: ReleaseCandidateItem): boolean {
  return seedsBack(release)
}

/** Falls back to the release's own evidence only if the status list somehow omits its indexer. */
function seedsBack(release: ReleaseCandidateItem): boolean {
  return swarmByIndexer.value.get(release.indexerId) ?? release.seeders !== null
}

function deliveryFor(release: ReleaseCandidateItem): DownloadDelivery {
  return deliveryByIndexer.value.get(release.indexerId) ?? (seedsBack(release) ? 'torrent' : 'file')
}

function protocolText(release: ReleaseCandidateItem): string {
  return t(`bookRequests.releases.protocol.${deliveryFor(release) === 'file' ? 'directPill' : deliveryFor(release)}`)
}

/** The eye button is an icon, so its name says what it opens and for which release. */
function fileToggleLabel(release: ReleaseCandidateItem): string {
  const open = filesAreExpanded(release)
  if (deliveryFor(release) === 'usenet') {
    return t(open ? 'bookRequests.releases.hideDetailsOf' : 'bookRequests.releases.viewDetailsOf', { title: release.title })
  }
  return t(open ? 'bookRequests.releases.hideFilesOf' : 'bookRequests.releases.viewFilesOf', { title: release.title })
}

function indexerChipClass(release: ReleaseCandidateItem): string {
  return sourceChipClass(colorByIndexer.value.get(release.indexerId))
}

/** The full reason the profile skipped a release, with the tier it came closest to. */
function skipText(release: ReleaseCandidateItem): string | null {
  const mismatch = release.profileMismatch
  if (!mismatch) return null
  return t('bookRequests.releases.profileMismatch.closest', {
    tier: mismatch.tierName,
    reasons: mismatch.failures.map((failure) => profileFailureText(release, failure)).join(' '),
  })
}

/**
 * The same reason cut to what fits beside the row's facts: the first condition it failed, and how
 * many more. The heading above already says the profile skipped it; the full text is the tooltip.
 */
function skipShortText(release: ReleaseCandidateItem): string | null {
  const failures = release.profileMismatch?.failures ?? []
  const first = failures[0]
  if (!first) return null
  const reason = shortFailureText(first)
  return failures.length > 1 ? t('bookRequests.releases.profileMismatch.short.more', { reason, count: failures.length - 1 }) : reason
}

function shortFailureText(failure: ReleaseProfileMismatchFailure): string {
  const key = 'bookRequests.releases.profileMismatch.short'
  const formats = (values: string[]) => formatList(values.map((format) => format.toUpperCase()))
  switch (failure.code) {
    case 'formatUnknown':
      return t(`${key}.formatUnknown`, { expected: formats(failure.expected) })
    case 'format':
      return t(`${key}.format`, { actual: formats(failure.actual), expected: formats(failure.expected) })
    case 'fileLayoutUnknown':
      return t(`${key}.${failure.expected === 'single' ? 'fileLayoutUnknownSingle' : 'fileLayoutUnknownMulti'}`)
    case 'fileLayout':
      return t(`${key}.${failure.expected === 'single' ? 'fileLayoutSingle' : 'fileLayoutMulti'}`)
    case 'bitrate':
      return t(`${key}.bitrate`, { actual: failure.actual, expected: failure.expected })
    case 'channels':
      return t(`${key}.${failure.expected === 1 ? 'channelsMono' : 'channelsStereo'}`)
    case 'languageUnknown':
      return t(`${key}.languageUnknown`, { expected: formatList(failure.expected.map(formatLanguageName)) })
    case 'language':
      return t(`${key}.language`, { actual: formatLanguageName(failure.actual), expected: formatList(failure.expected.map(formatLanguageName)) })
    case 'seeders':
      return t(`${key}.seeders`, { actual: failure.actual, expected: failure.expected })
    case 'sizeUnknown':
      return t(`${key}.sizeUnknown`, { expected: formatBytes(failure.expected) })
    case 'size':
      return t(`${key}.size`, { actual: formatBytes(failure.actual), expected: formatBytes(failure.expected) })
    case 'source':
    case 'freeleech':
    case 'vipOnly':
      return t(`${key}.${failure.code}`)
  }
}

function hasBreakdown(release: ReleaseCandidateItem): boolean {
  return release.reasons.length > 0 || release.profileMismatch !== null
}

/** Whether the score square has anything to open: how it scored, when it was added, its ties. */
function hasDetails(release: ReleaseCandidateItem, index: number): boolean {
  return hasBreakdown(release) || release.publishedAt !== null || (isBest(index) && tiedWithBest.value > 0)
}

function addedDate(release: ReleaseCandidateItem): string | null {
  return release.publishedAt ? formatDate(new Date(release.publishedAt), { dateStyle: 'medium' }) : null
}

/** A swarm's health in its colour: enough seeders to rely on, a thin swarm, or none at all. */
function seederTone(release: ReleaseCandidateItem): string | undefined {
  if (release.seeders === null) return undefined
  if (release.seeders >= HEALTHY_SWARM) return 'font-medium text-success'
  return release.seeders > 0 ? 'font-medium text-warning' : 'font-medium text-destructive'
}

/**
 * The audio line, built only from what the indexer actually stated. Sampling rate joins it only
 * when it departs from the usual 44.1 kHz, which is the only time it tells the reader anything.
 */
function audioParts(release: ReleaseCandidateItem): string[] {
  const audio = release.audio
  if (!audio) return []

  const parts: string[] = []
  if (audio.bitrateKbps !== null) {
    parts.push(audio.bitrateMode ? `${audio.bitrateKbps}k ${audio.bitrateMode}` : `${audio.bitrateKbps}k`)
  }
  if (audio.channels !== null) parts.push(t(`bookRequests.releases.channels.${audio.channels === 1 ? 'mono' : 'stereo'}`))
  if (audio.samplingRateHz !== null && audio.samplingRateHz !== COMMON_SAMPLING_RATE_HZ) {
    parts.push(`${Math.round(audio.samplingRateHz / 100) / 10} kHz`)
  }
  if (audio.durationSeconds !== null) parts.push(formatDuration(audio.durationSeconds))
  if (audio.chapterCount !== null) parts.push(t('bookRequests.releases.chapterCountPlural', { count: audio.chapterCount }))
  return parts
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return hours > 0 ? t('bookRequests.releases.durationHm', { hours, minutes }) : t('bookRequests.releases.durationM', { minutes })
}

/**
 * What actually separates one release from another. A signal every release shares, such as the
 * same title match, costs a line of attention and settles nothing, so only penalties stay inline.
 */
function penalties(release: ReleaseCandidateItem): ReleaseCandidateItem['reasons'] {
  return release.reasons.filter((reason) => reason.points < 0)
}

function credits(release: ReleaseCandidateItem): ReleaseCandidateItem['reasons'] {
  return release.reasons.filter((reason) => reason.points > 0)
}

function reasonText(reason: ReleaseCandidateItem['reasons'][number]): string {
  return t(`bookRequests.releases.reasons.${reason.code}`, { detail: reason.detail ?? '' })
}

function reasonPoints(points: number): string {
  return points > 0 ? `+${points}` : String(points)
}

function profileFailureText(release: ReleaseCandidateItem, failure: ReleaseProfileMismatchFailure): string {
  const key = `bookRequests.releases.profileMismatch.failures.${failure.code}`
  switch (failure.code) {
    case 'formatUnknown':
      return t(key, { source: release.indexerName, expected: formatList(failure.expected.map((format) => format.toUpperCase())) })
    case 'format':
      return t(key, {
        actual: formatList(failure.actual.map((format) => format.toUpperCase())),
        expected: formatList(failure.expected.map((format) => format.toUpperCase())),
      })
    case 'fileLayoutUnknown':
      return t(key, { source: release.indexerName, expected: t(`bookRequests.releases.fileLayout.${failure.expected}`) })
    case 'fileLayout':
      return t(key, {
        actual: t(`bookRequests.releases.fileLayout.${failure.actual}`),
        expected: t(`bookRequests.releases.fileLayout.${failure.expected}`),
      })
    case 'channels':
      return t(key, {
        actual: t(`bookRequests.releases.channels.${failure.actual === 1 ? 'mono' : 'stereo'}`),
        expected: t(`bookRequests.releases.channels.${failure.expected === 1 ? 'mono' : 'stereo'}`),
      })
    case 'bitrate':
    case 'seeders':
      return t(key, { actual: failure.actual, expected: failure.expected })
    case 'languageUnknown':
      return t(key, { source: release.indexerName, expected: formatList(failure.expected.map(formatLanguageName)) })
    case 'language':
      return t(key, { actual: formatLanguageName(failure.actual), expected: formatList(failure.expected.map(formatLanguageName)) })
    case 'sizeUnknown':
      return t(key, { source: release.indexerName, expected: formatBytes(failure.expected) })
    case 'size':
      return t(key, { actual: formatBytes(failure.actual), expected: formatBytes(failure.expected) })
    case 'source':
    case 'freeleech':
    case 'vipOnly':
      return t(key)
  }
}

/**
 * A box's facts as one ordered run, so the template can separate them instead of relying on a gap
 * between spans of identical text to say where one fact ends and the next begins. Where the
 * release comes from is not here: the protocol and source chips above the line say it in colour.
 *
 * Facts already stated once above the list are dropped here rather than repeated per box.
 */
function rowFacts(release: ReleaseCandidateItem): RowFact[] {
  const facts: RowFact[] = []
  if (release.language && !sharedLanguage.value) {
    facts.push({ key: 'language', text: formatLanguageName(release.language), tone: 'text-foreground' })
  }
  if (release.fileCount !== null) {
    facts.push({ key: 'files', numeric: true, text: t('bookRequests.releases.fileCount', { count: release.fileCount }), tone: 'text-foreground' })
  }
  if (release.sizeBytes) facts.push({ key: 'size', numeric: true, text: formatBytes(release.sizeBytes), tone: 'text-foreground' })
  if (showsSeeders(release)) facts.push({ key: 'seeders', numeric: true, text: seederText(release), tone: seederTone(release) })
  const audio = audioParts(release)
  if (audio.length) facts.push({ key: 'audio', numeric: true, text: audio.join(' · ') })
  const added = addedDate(release)
  if (added) facts.push({ key: 'added', numeric: true, wideOnly: true, text: added })
  return facts
}

function seederText(release: ReleaseCandidateItem): string {
  return release.seeders === null
    ? t('bookRequests.releases.seederCountUnknown')
    : t('bookRequests.releases.seederCountPlural', { count: release.seeders })
}

/** Back is one level, not the whole drawer: the request this picker was opened for is behind it. */
function goBack() {
  void router.push({ name: 'book-request-detail', params: { id: requestId.value }, query: route.query })
}

/** What a new list invalidates: the rows opened against the old one, and what it was refused. */
function startFreshSearch(): void {
  expandedFiles.value = new Set()
  forgetRefusals()
}

function handleRetryClient() {
  void retryClient()
}

function handleRefresh() {
  startFreshSearch()
  if (!Number.isInteger(requestId.value)) return
  if (criteria.value) void fetchReleases(requestId.value, { overrides: criteriaOverrides(criteria.value) })
  else void fetchReleases(requestId.value, { refresh: true })
}

function fetchInitialReleases(id: number): void {
  const routeIsbn = typeof route.query.isbn === 'string' ? canonicalizeTypedIsbn(route.query.isbn) : null
  if (routeIsbn) {
    void fetchReleases(id, { overrides: { isbn: routeIsbn } })
    return
  }
  if (route.query.search === 'title-author') {
    void fetchReleases(id, { overrides: { isbn: null } })
    return
  }
  void fetchReleases(id)
}

function toggleSearchPanel(): void {
  searchPanelChoice.value = !searchPanelOpen.value
}

function showEverySource(): void {
  showEachSource.value = true
}
</script>

<template>
  <div class="@container flex h-full min-h-0 flex-col text-sm leading-[1.45] text-foreground">
    <RequestDrawerToolbar leading="back" @back="goBack">
      <template #title>
        <div class="min-w-0 px-1">
          <p class="text-sm leading-[1.3] font-medium [overflow-wrap:anywhere] text-foreground">
            {{ isRetry ? t('bookRequests.releases.retryTitle') : pairTabs ? t('bookRequests.releases.pairTitle') : t('bookRequests.releases.title') }}
          </p>
          <p v-if="pickRunActive && drawer?.pickRun" class="text-xs leading-[1.3] text-muted-foreground tabular-nums">
            {{ t('bookRequests.pickRun.progress', { position: drawer.pickRun.position.value, total: drawer.pickRun.total.value }) }}
          </p>
          <p v-else-if="request" class="text-xs leading-[1.3] [overflow-wrap:anywhere] text-muted-foreground">
            {{ request.title }}
            <template v-if="authorLine">
              <span aria-hidden="true"> · </span>
              {{ authorLine }}
            </template>
          </p>
        </div>
      </template>
      <template v-if="!finished" #actions>
        <Button v-if="pickRunActive" variant="outline" size="sm" @click="skipInRun">{{ t('bookRequests.pickRun.skip') }}</Button>
        <Button variant="ghost" size="sm" :disabled="loading" :aria-label="t('bookRequests.releases.refresh')" @click="handleRefresh">
          <RefreshCw :size="14" aria-hidden="true" />
          <span class="hidden @min-[30rem]:inline">{{ t('bookRequests.releases.refresh') }}</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon-sm" :aria-label="t('bookRequests.releases.moreOptions')">
              <Ellipsis :size="16" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="min-w-[220px]">
            <DropdownMenuItem @click="openManual">{{ t('bookRequests.releases.manualTorrent') }}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </template>
    </RequestDrawerToolbar>

    <!--
      What was searched and what each source gave back, in one band under the toolbar. Hidden while
      no source is enabled: every part of it describes a search, and none ran.
    -->
    <div
      v-if="request && criteria && !noSourcesEnabled && !finished"
      class="flex min-h-[42px] shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-[color-mix(in_oklab,var(--muted)_55%,var(--background))] py-1.5 ps-3 pe-2 text-[13px] @min-[35rem]:ps-4"
      role="group"
      :aria-label="t('bookRequests.releases.criteria.label')"
    >
      <i18n-t
        v-if="searchFoundNothing"
        keypath="bookRequests.releases.criteria.nothingFound"
        tag="p"
        scope="global"
        class="min-w-0 flex-1 font-medium text-foreground @min-[35rem]:flex-initial"
      >
        <template #key>
          <span class="[overflow-wrap:anywhere] text-foreground tabular-nums">{{ searchHeadline.value }}</span>
        </template>
      </i18n-t>
      <p v-else-if="searchHeadline.isbn" class="min-w-0 flex-1 text-muted-foreground @min-[35rem]:flex-initial">
        <Search :size="14" class="me-1.5 inline-block align-[-2px]" aria-hidden="true" />
        <i18n-t keypath="bookRequests.releases.criteria.searchedIsbn" scope="global">
          <template #isbn>
            <b class="font-medium [overflow-wrap:anywhere] text-foreground tabular-nums">{{ searchHeadline.value }}</b>
          </template>
        </i18n-t>
      </p>
      <p v-else class="min-w-0 flex-1 text-muted-foreground @min-[35rem]:flex-initial">
        <Search :size="14" class="me-1.5 inline-block align-[-2px]" aria-hidden="true" />
        {{ t('bookRequests.releases.criteria.searchedTitleAuthor') }}
        <b class="font-medium [overflow-wrap:anywhere] text-foreground">{{ searchHeadline.value }}</b>
      </p>

      <!--
        Kept visible rather than folded away: this is the only place that separates a source that
        found nothing from one whose session expired, and those need opposite fixes.
      -->
      <ul v-if="sourceRows.length" class="contents" :aria-label="t('bookRequests.releases.criteria.sources')">
        <li
          v-if="sourcesCondensed"
          class="order-2 inline-flex flex-wrap items-center gap-1.5 @min-[35rem]:order-none @min-[35rem]:border-s @min-[35rem]:border-border @min-[35rem]:ps-3"
        >
          <CircleCheck :size="13" class="flex-none text-success" aria-hidden="true" />
          <span class="text-foreground">{{ t('bookRequests.releases.criteria.sourcesSearched', { count: cleanSourceRows.length }) }}</span>
          <span class="font-semibold text-foreground tabular-nums">
            {{ t('bookRequests.releases.criteria.sourceReleases', { count: condensedReleaseCount }) }}
          </span>
          <button
            type="button"
            class="rounded-xs text-foreground underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            @click="showEverySource"
          >
            {{ t('bookRequests.releases.criteria.showEachSource') }}
          </button>
        </li>

        <li
          v-for="row in listedSourceRows"
          :key="row.id"
          class="order-2 inline-flex min-w-0 flex-wrap items-center gap-1.5 @min-[35rem]:order-none @min-[35rem]:border-s @min-[35rem]:border-border @min-[35rem]:ps-3"
        >
          <Loader2 v-if="loading" class="size-3 flex-none animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />
          <TriangleAlert v-else-if="!row.ok" :size="13" class="flex-none text-warning" aria-hidden="true" />
          <span v-else class="size-2 flex-none rounded-full" :class="row.dotClass" aria-hidden="true" />
          <span class="text-foreground">{{ row.name }}</span>
          <!--
            Silent where it was handed the key stated above. A source that could not take the ISBN
            says it searched the title and author, with the exact string it was sent on hover.
          -->
          <span v-if="row.query && searchHeadline.isbn && !row.isbnQuery" class="order-last text-muted-foreground" :title="row.query">
            {{ t('bookRequests.releases.criteria.byTitleAuthor') }}
          </span>
          <code v-else-if="row.query && !row.echoesKey" class="max-w-[16rem] truncate font-mono text-xs text-muted-foreground" :title="row.query">
            {{ row.query }}
          </code>
          <span v-else-if="!row.query" class="text-muted-foreground">{{ t('bookRequests.releases.criteria.sourceNoAdapter') }}</span>
          <template v-if="loading" />
          <template v-else-if="!row.ok">
            <span class="text-warning">{{ t(`bookRequests.releases.failures.${row.failure ?? 'error'}`) }}</span>
            <!-- The one failure with a specific fix, rather than a re-run of the same search. -->
            <RouterLink
              v-if="row.failure === 'unauthorized' && canFixSources"
              :to="{ name: 'settings-admin-requests' }"
              class="inline-flex items-center gap-0.5 rounded-xs text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {{ t('bookRequests.releases.criteria.fixSource') }}
              <ArrowUpRight :size="12" aria-hidden="true" />
            </RouterLink>
          </template>
          <template v-else>
            <template v-if="row.count > 0">
              <b class="font-semibold text-foreground tabular-nums" aria-hidden="true">{{ formatNumber(row.count) }}</b>
              <span class="sr-only">{{ t('bookRequests.releases.criteria.sourceReleases', { count: row.count }) }}</span>
            </template>
            <span v-else class="text-muted-foreground">{{ t('bookRequests.releases.criteria.sourceNone') }}</span>
            <span v-if="row.filtered" class="text-muted-foreground">{{
              t('bookRequests.releases.criteria.sourceFiltered', { count: row.filtered })
            }}</span>
          </template>
        </li>

        <li
          v-if="uncoveredIndexerCount"
          class="order-2 text-muted-foreground @min-[35rem]:order-none @min-[35rem]:border-s @min-[35rem]:border-border @min-[35rem]:ps-3"
        >
          {{ t('bookRequests.releases.criteria.uncovered', { count: uncoveredIndexerCount }) }}
        </li>
      </ul>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="order-1 ms-auto h-7 gap-1 px-2 text-[13px] @min-[35rem]:order-none"
        :aria-expanded="searchPanelOpen"
        aria-controls="release-search-options"
        @click="toggleSearchPanel"
      >
        {{ searchPanelOpen ? t('bookRequests.releases.criteria.closeSearch') : t('bookRequests.releases.criteria.changeSearch') }}
        <ChevronUp v-if="searchPanelOpen" :size="14" aria-hidden="true" />
        <ChevronDown v-else :size="14" aria-hidden="true" />
      </Button>
      <!-- A phone keeps the search and its Change button on one line, with the sources under it. -->
      <span class="order-1 h-0 basis-full @min-[35rem]:hidden" aria-hidden="true" />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-5">
      <div v-if="requestLoading" role="status" class="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {{ t('bookRequests.detail.loading') }}
      </div>

      <EntityNotFound v-else-if="requestError === 'notFound' || requestError === 'forbidden'" :entity="t('bookRequests.detail.entityName')" />

      <p v-else-if="requestError" role="alert" class="text-sm text-destructive">{{ t(`bookRequests.detail.errors.${requestError}`) }}</p>

      <template v-else-if="request">
        <ReleasePairTabs v-if="pairTabs" :tabs="pairTabs" :query="listQuery" class="mb-3.5" />

        <section
          v-if="criteria && !noSourcesEnabled && !finished && searchPanelOpen"
          id="release-search-options"
          class="mb-3.5 rounded-sm border border-border bg-card p-3"
          :aria-label="t('bookRequests.releases.criteria.changeSearch')"
        >
          <div class="flex items-center justify-between gap-3">
            <h4 id="release-search-alternatives" class="text-xs font-medium text-muted-foreground">
              {{ t('bookRequests.releases.criteria.searchInstead') }}
            </h4>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="h-7 shrink-0 px-2 text-xs"
              :aria-expanded="searchEditing"
              @click="toggleSearchEditor"
            >
              <Pencil :size="13" aria-hidden="true" />
              {{ searchEditing ? t('bookRequests.releases.criteria.closeEditor') : t('bookRequests.releases.criteria.editFields') }}
            </Button>
          </div>

          <!--
            One axis, not two lists: the key the search ran under is stated above, and these are
            the other keys it could run under. A key already spent this visit says what it
            returned, because four alternates from one provider are otherwise indistinguishable.
          -->
          <div class="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-labelledby="release-search-alternatives">
            <Button
              v-for="isbn in alternativeIsbns"
              :key="isbn"
              type="button"
              variant="outline"
              size="sm"
              class="h-auto min-w-0 flex-col items-start gap-0 px-2.5 py-1.5"
              :disabled="loading"
              @click="runAlternativeIsbnSearch(isbn)"
            >
              <span class="font-mono text-xs tabular-nums">{{ isbn }}</span>
              <span class="max-w-48 truncate text-[10px] font-normal text-muted-foreground">{{ isbnKeyLabel(isbn) }}</span>
            </Button>
            <Button
              v-if="criteria.activeIsbn"
              type="button"
              variant="outline"
              size="sm"
              class="h-auto flex-col items-start gap-0 px-2.5 py-1.5"
              :disabled="loading"
              @click="runTitleAuthorSearch"
            >
              <span class="text-xs">{{ t('bookRequests.releases.criteria.searchWithoutIsbn') }}</span>
              <span v-if="titleAuthorAttempt" class="text-[10px] font-normal text-muted-foreground">{{ titleAuthorAttempt }}</span>
            </Button>
          </div>

          <!-- Never sent to a source, so changing one of these cannot surface a new release. -->
          <div
            v-if="localOnlyCriteriaFacts.length"
            class="mt-2.5 flex flex-wrap items-center gap-1.5"
            role="group"
            aria-labelledby="release-search-local-criteria"
          >
            <h4 id="release-search-local-criteria" class="me-0.5 text-xs font-medium text-muted-foreground">
              {{ t('bookRequests.releases.criteria.filteredLocally') }}
            </h4>
            <dl class="flex flex-wrap gap-1.5 text-xs">
              <div
                v-for="fact in localOnlyCriteriaFacts"
                :key="fact.key"
                class="inline-flex min-w-0 rounded-full border border-border bg-background px-2 py-1"
              >
                <dt class="font-medium text-muted-foreground">{{ fact.label }}:</dt>
                <dd class="ms-1 max-w-72 truncate text-foreground" :title="fact.value">{{ fact.value }}</dd>
              </div>
            </dl>
          </div>

          <form v-if="searchEditing" class="mt-3 space-y-3 border-t border-border pt-3" @submit="handleCustomSearchSubmit">
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="space-y-1.5">
                <label for="release-search-title" class="text-xs font-medium text-foreground">
                  {{ t('bookRequests.releases.criteria.title') }}
                </label>
                <input
                  id="release-search-title"
                  v-model="searchTitle"
                  type="text"
                  maxlength="500"
                  class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                />
              </div>

              <div class="space-y-1.5">
                <label for="release-search-language" class="text-xs font-medium text-foreground">
                  {{ t('bookRequests.releases.criteria.language') }}
                </label>
                <input
                  id="release-search-language"
                  v-model="searchLanguage"
                  type="text"
                  maxlength="20"
                  class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                  :placeholder="t('bookRequests.releases.criteria.languagePlaceholder')"
                />
              </div>

              <div class="space-y-1.5">
                <label for="release-search-authors" class="text-xs font-medium text-foreground">
                  {{ t('bookRequests.releases.criteria.authorsEditor') }}
                </label>
                <textarea
                  id="release-search-authors"
                  v-model="searchAuthors"
                  rows="3"
                  maxlength="13000"
                  class="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                  :placeholder="t('bookRequests.releases.criteria.authorsPlaceholder')"
                ></textarea>
              </div>

              <div class="space-y-1.5">
                <label for="release-search-formats" class="text-xs font-medium text-foreground">
                  {{ t('bookRequests.releases.criteria.formats') }}
                </label>
                <input
                  id="release-search-formats"
                  v-model="searchFormats"
                  type="text"
                  maxlength="419"
                  class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                  :placeholder="t('bookRequests.releases.criteria.formatsPlaceholder')"
                />
              </div>
            </div>

            <fieldset class="space-y-2">
              <legend class="text-xs font-medium text-foreground">{{ t('bookRequests.releases.criteria.isbnSelection') }}</legend>
              <p class="text-xs text-muted-foreground">{{ t('bookRequests.releases.criteria.isbnSelectionHint') }}</p>
              <div v-if="searchIsbnOptions.length" class="flex flex-wrap gap-2">
                <label
                  v-for="(isbn, index) in searchIsbnOptions"
                  :key="isbn"
                  :for="`release-search-isbn-${index}`"
                  class="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40"
                >
                  <input
                    :id="`release-search-isbn-${index}`"
                    type="radio"
                    name="release-search-isbn"
                    class="size-3.5 accent-primary"
                    :checked="selectedSearchIsbn === isbn"
                    @change="selectSearchIsbn(isbn)"
                  />
                  <span class="font-mono">{{ isbn }}</span>
                </label>
              </div>
              <label
                for="release-search-without-isbn"
                class="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40"
              >
                <input
                  id="release-search-without-isbn"
                  type="radio"
                  name="release-search-isbn"
                  class="size-3.5 accent-primary"
                  :checked="selectedSearchIsbn === null"
                  @change="selectTitleAuthorSearch"
                />
                <span>{{ t('bookRequests.releases.criteria.noIsbnSelected') }}</span>
              </label>
              <div class="flex flex-col gap-2 sm:flex-row">
                <label for="release-search-custom-isbn" class="sr-only">{{ t('bookRequests.releases.criteria.customIsbn') }}</label>
                <input
                  id="release-search-custom-isbn"
                  v-model="customSearchIsbn"
                  type="text"
                  maxlength="20"
                  class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                  :placeholder="t('bookRequests.releases.criteria.customIsbnPlaceholder')"
                />
                <Button type="button" variant="outline" size="sm" @click="addCustomSearchIsbn">
                  <Plus :size="14" aria-hidden="true" />
                  {{ t('bookRequests.releases.criteria.addIsbn') }}
                </Button>
              </div>
            </fieldset>

            <p class="text-xs text-muted-foreground">
              {{ t('bookRequests.releases.criteria.fixedMedia', { media: t(`bookRequests.mediaKind.${criteria.mediaKind}`) }) }}
            </p>
            <p v-if="searchEditError" role="alert" class="text-xs text-destructive">{{ searchEditError }}</p>

            <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" size="sm" @click="resetSearchEditor">
                {{ t('bookRequests.releases.criteria.useRequestFields') }}
              </Button>
              <Button type="submit" size="sm" :disabled="loading">
                <Loader2 v-if="loading" class="animate-spin" aria-hidden="true" />
                {{ t('bookRequests.releases.criteria.runSearch') }}
              </Button>
            </div>
          </form>
        </section>

        <p
          v-if="isRetry && failureText && !finished"
          class="mb-3.5 flex items-start gap-2 rounded-sm border border-[color-mix(in_oklab,var(--destructive)_35%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_7%,var(--card))] px-2.5 py-2 text-[13px] text-foreground"
        >
          <CircleX :size="14" class="mt-0.5 flex-none text-destructive" aria-hidden="true" />
          <span>{{ t('bookRequests.releases.previousFailure', { reason: failureText }) }}</span>
        </p>

        <!-- Not while nothing was searched: "showing the last search" is the same claim again. -->
        <p v-if="cached && !loading && !noSourcesEnabled && !finished" class="mb-3 text-xs text-muted-foreground">
          {{ t('bookRequests.releases.cached') }}
        </p>

        <!--
          One notice for the client rather than a chip on every row it disables: the client is not a
          property of any release, and the way out is the same whichever row was sent.
        -->
        <div
          v-if="clientProblem && !finished"
          role="alert"
          class="mb-3.5 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-sm border border-[color-mix(in_oklab,var(--destructive)_35%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_7%,var(--card))] p-3 text-sm"
        >
          <CircleAlert :size="16" class="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
          <div class="min-w-0 flex-1 basis-56">
            <p class="font-medium text-foreground">{{ clientProblemTitle }}</p>
            <p class="mt-0.5 text-xs break-words text-muted-foreground">{{ clientProblemHint }}</p>
          </div>
          <Button variant="outline" size="sm" :disabled="busy" @click="handleRetryClient">
            <RefreshCw :size="14" aria-hidden="true" />
            {{ t('bookRequests.releases.clientProblem.retry') }}
          </Button>
        </div>

        <!-- Where a pair ends once neither half needs a release: said here, not left to a passing toast. -->
        <div v-if="finished" role="status" class="mt-10 flex flex-col items-center gap-3 text-center">
          <span class="grid size-11 place-items-center rounded-full bg-success/15 text-success">
            <Check :size="22" aria-hidden="true" />
          </span>
          <p class="text-base font-semibold text-foreground">{{ t('bookRequests.releases.pair.finishedTitle') }}</p>
          <p class="max-w-sm text-sm text-muted-foreground">{{ t('bookRequests.releases.pair.finishedHint') }}</p>
          <div class="mt-2 flex flex-wrap justify-center gap-2">
            <Button variant="outline" size="sm" @click="goBack">{{ t('bookRequests.releases.pair.backToRequest') }}</Button>
            <Button size="sm" @click="closeDrawer">{{ t('bookRequests.releases.pair.done') }}</Button>
          </div>
        </div>

        <p v-else-if="loading" role="status" class="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {{ t('bookRequests.releases.searching') }}
        </p>

        <!-- Otherwise a search that failed once leaves closing and reopening the picker as the fix. -->
        <div v-else-if="loadFailed" role="alert" class="flex flex-wrap items-center gap-3">
          <p class="text-sm text-destructive">{{ t('bookRequests.releases.errors.loadFailed') }}</p>
          <Button variant="outline" size="sm" @click="handleRefresh">{{ t('common.retry') }}</Button>
        </div>

        <template v-else>
          <!--
            Nothing was asked anything, so this is not a fact about the book. The fix is one of two
            things and they are not interchangeable: an instance with three sources switched off
            does not need a fourth.
          -->
          <RequestEmptyState v-if="noSourcesEnabled" :icon="SearchX" :title="noSourcesTitle" :message="noSourcesHint">
            <Button v-if="canFixSources" variant="outline" size="sm" as-child>
              <RouterLink :to="{ name: 'settings-admin-requests' }" class="inline-flex items-center justify-center gap-1.5">
                {{ noSourcesConfigured ? t('bookRequests.releases.addSource') : t('bookRequests.releases.reviewSources') }}
                <ArrowUpRight :size="14" aria-hidden="true" />
              </RouterLink>
            </Button>
            <Button variant="ghost" size="sm" @click="openManual">{{ t('bookRequests.releases.manualTorrent') }}</Button>
          </RequestEmptyState>

          <!--
            A medium nothing carries is the one empty state the band above cannot explain: no source
            was searched, so the fix is a source that covers this kind of book, not another key.
          -->
          <RequestEmptyState
            v-else-if="releases.length === 0 && searched && nothingCoversMedium"
            :icon="SearchX"
            :title="t('bookRequests.releases.mediumUncovered')"
            :message="t('bookRequests.releases.mediumUncoveredHint')"
          >
            <Button variant="outline" size="sm" :disabled="loading" @click="handleRefresh">
              <RefreshCw :size="14" aria-hidden="true" />
              {{ t('bookRequests.releases.refresh') }}
            </Button>
            <Button variant="ghost" size="sm" @click="openManual">{{ t('bookRequests.releases.manualTorrent') }}</Button>
          </RequestEmptyState>

          <template v-else-if="releases.length > 0">
            <!-- Sort first, then whatever narrows the list; a group appears only where it can change it. -->
            <div v-if="showFacets" class="flex flex-wrap items-center gap-1.5" role="group" :aria-label="t('bookRequests.releases.filtersLabel')">
              <Popover v-if="sortGroup" :open="openFacet === 'sort'" @update:open="(open: boolean) => setFacetOpen('sort', open)">
                <PopoverTrigger as-child>
                  <button
                    type="button"
                    class="inline-flex h-[30px] items-center gap-1.5 rounded-sm border border-input bg-background px-2.5 text-xs whitespace-nowrap text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <span class="text-muted-foreground">{{ sortGroup.label }}</span>
                    <span>{{ activeLabel(sortGroup) }}</span>
                    <ChevronDown :size="12" class="text-muted-foreground" aria-hidden="true" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" class="w-52 p-1" :aria-label="sortGroup.label">
                  <button
                    v-for="option in sortGroup.options"
                    :key="option.id"
                    type="button"
                    class="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-start text-[13px] text-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    :aria-pressed="option.active"
                    @click="chooseFacet(option)"
                  >
                    <Check :size="14" class="flex-none text-primary" :class="option.active ? 'visible' : 'invisible'" aria-hidden="true" />
                    {{ option.label }}
                  </button>
                </PopoverContent>
              </Popover>

              <span v-if="sortGroup && (facetMenus.length || flagToggles.length)" class="mx-0.5 h-[18px] w-px bg-border" aria-hidden="true" />

              <template v-for="group in facetMenus" :key="group.key">
                <span
                  class="inline-flex h-[30px] items-stretch rounded-sm border text-xs whitespace-nowrap text-foreground"
                  :class="
                    activeLabel(group)
                      ? 'border-[color-mix(in_oklab,var(--primary)_55%,var(--border))] bg-[color-mix(in_oklab,var(--primary)_12%,var(--background))]'
                      : 'border-input bg-background'
                  "
                >
                  <Popover :open="openFacet === group.key" @update:open="(open: boolean) => setFacetOpen(group.key, open)">
                    <PopoverTrigger as-child>
                      <button
                        type="button"
                        class="inline-flex items-center gap-1.5 rounded-sm px-2.5 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        :class="activeLabel(group) ? 'pe-1' : ''"
                      >
                        <span :class="activeLabel(group) ? 'text-muted-foreground' : undefined">{{ group.label }}</span>
                        <span v-if="activeLabel(group)">{{ activeLabel(group) }}</span>
                        <ChevronDown v-if="!activeLabel(group)" :size="12" class="text-muted-foreground" aria-hidden="true" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" class="w-60 p-1" :aria-label="group.label">
                      <button
                        v-for="option in group.options"
                        :key="option.id"
                        type="button"
                        class="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-start text-[13px] text-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                        :aria-pressed="option.active"
                        @click="chooseFacet(option)"
                      >
                        <Check :size="14" class="flex-none text-primary" :class="option.active ? 'visible' : 'invisible'" aria-hidden="true" />
                        <span v-if="option.dotClass" class="size-2 flex-none rounded-full" :class="option.dotClass" aria-hidden="true" />
                        <span class="min-w-0 flex-1 [overflow-wrap:anywhere]">{{ option.label }}</span>
                        <span v-if="option.count !== null" class="text-xs text-muted-foreground tabular-nums">{{ option.count }}</span>
                      </button>
                    </PopoverContent>
                  </Popover>
                  <button
                    v-if="activeLabel(group)"
                    type="button"
                    class="inline-flex items-center rounded-sm px-1.5 text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    :aria-label="t('bookRequests.releases.clearFilter', { filter: group.label })"
                    @click="clearFacet(group)"
                  >
                    <X :size="12" aria-hidden="true" />
                  </button>
                </span>
              </template>

              <button
                v-for="option in flagToggles"
                :key="option.id"
                type="button"
                class="inline-flex h-[30px] items-center gap-1.5 rounded-sm border px-2.5 text-xs whitespace-nowrap text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                :class="
                  option.active
                    ? 'border-[color-mix(in_oklab,var(--primary)_55%,var(--border))] bg-[color-mix(in_oklab,var(--primary)_12%,var(--background))]'
                    : 'border-input bg-background'
                "
                :aria-pressed="option.active"
                @click="toggleFlag(option)"
              >
                {{ option.label }}
                <span v-if="option.count !== null" class="text-muted-foreground tabular-nums">{{ option.count }}</span>
              </button>
            </div>

            <!-- Everything true of every release, said once, so the rows carry only what differs. -->
            <p class="mt-3 mb-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
              <b class="font-semibold text-foreground tabular-nums">
                {{
                  hasFilter
                    ? t('bookRequests.releases.summaryFiltered', { shown: visibleReleases.length, count: releases.length })
                    : t('bookRequests.releases.summaryCount', { count: releases.length })
                }}
              </b>
              <template v-for="fact in summaryFacts" :key="fact">
                <span aria-hidden="true">·</span>
                <span>{{ fact }}</span>
              </template>
              <template v-if="sharedIndexer">
                <span aria-hidden="true">·</span>
                <span class="inline-flex items-center gap-1.5">
                  <span class="size-2 flex-none rounded-full" :class="sharedIndexerDot" aria-hidden="true" />
                  {{ t('bookRequests.releases.allIndexer', { name: sharedIndexer }) }}
                </span>
              </template>
              <button
                v-if="hasFilter"
                type="button"
                class="ms-auto rounded-xs text-xs text-foreground underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                @click="clearFilters"
              >
                {{ t('bookRequests.releases.clearFilters') }}
              </button>
            </p>

            <div
              v-if="nothingMatchedProfile"
              role="status"
              class="mt-3 flex items-start gap-2 rounded-sm border border-[color-mix(in_oklab,var(--warning)_40%,var(--border))] bg-[color-mix(in_oklab,var(--warning)_8%,var(--card))] px-2.5 py-2 text-xs text-foreground"
            >
              <TriangleAlert :size="14" class="mt-px shrink-0 text-warning" aria-hidden="true" />
              <div class="min-w-0 flex-1">
                <p>{{ t('bookRequests.releases.profileMismatch.summary', { count: releases.length, medium: mediumLabel }) }}</p>
                <RouterLink
                  v-if="canFixSources"
                  :to="profileSettingsLink"
                  class="mt-1 inline-flex items-center gap-[3px] font-medium text-foreground underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {{ t('bookRequests.releases.profileMismatch.review', { medium: mediumLabel }) }}
                  <ArrowUpRight :size="12" aria-hidden="true" />
                </RouterLink>
              </div>
            </div>

            <p
              v-if="visibleReleases.length === 0"
              role="status"
              class="mt-4 rounded-sm border border-border bg-card p-4 text-sm text-muted-foreground"
            >
              {{ t('bookRequests.releases.filteredEmpty') }}
            </p>

            <!--
              One box per release, grouped by the profile tier that would take it. Every box has the
              same lines in the same places, so a scan down the list reads one kind of fact at a
              time: the title, then chips for where the release comes from and what sets it apart,
              then its facts. A phone has no room for every chip on one line, so its box has four:
              the title beside Send, the source, the facts, then the chips that set it apart.
            -->
            <div v-else class="mt-2 grid gap-2">
              <template v-for="group in releaseGroups" :key="group.key">
                <div
                  v-if="group.title !== null"
                  data-release-group
                  class="mt-1.5 flex min-h-9 items-start gap-2 pt-1 @min-[35rem]:items-center @min-[35rem]:pt-0"
                >
                  <CircleCheck v-if="!group.outside" :size="15" class="mt-0.5 flex-none text-success @min-[35rem]:mt-0" aria-hidden="true" />
                  <TriangleAlert v-else :size="15" class="mt-0.5 flex-none text-warning @min-[35rem]:mt-0" aria-hidden="true" />
                  <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-[13px]">
                    <h3 class="font-semibold text-foreground">{{ group.title }}</h3>
                    <span class="text-muted-foreground tabular-nums">{{ group.rows.length }}</span>
                    <span class="order-3 basis-full text-muted-foreground @min-[35rem]:order-none @min-[35rem]:basis-auto">
                      {{ group.outside ? t('bookRequests.releases.group.outsideHint') : t('bookRequests.releases.group.inTierHint') }}
                    </span>
                    <RouterLink
                      v-if="group.outside && canFixSources"
                      :to="profileSettingsLink"
                      class="ms-auto inline-flex items-center gap-1 rounded-xs text-foreground hover:underline hover:underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {{ t('bookRequests.releases.profileMismatch.review', { medium: mediumLabel }) }}
                      <ArrowUpRight :size="13" aria-hidden="true" />
                    </RouterLink>
                  </div>
                </div>

                <ul class="grid gap-2" :aria-label="group.title ?? t('bookRequests.releases.tableCaption')">
                  <li
                    v-for="{ release, index } in group.rows"
                    :key="releaseKey(release)"
                    data-release
                    class="grid grid-cols-[44px_minmax(0,1fr)_auto] content-center items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-card px-3 @min-[35rem]:gap-x-3.5 @min-[35rem]:px-3.5"
                    :class="isExpanded(release) || filesAreExpanded(release) ? 'py-3' : 'h-[122px] @min-[35rem]:h-[92px]'"
                  >
                    <div class="row-[1/span_4] self-center @min-[35rem]:row-[1/span_3]">
                      <button
                        v-if="hasDetails(release, index)"
                        type="button"
                        class="grid size-11 place-items-center rounded-[calc(var(--radius)+2px)] border text-[15px] font-semibold tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-expanded:shadow-[0_0_0_2px_var(--background),0_0_0_3px_currentColor]"
                        :class="scoreClass(release.score)"
                        :aria-expanded="isExpanded(release)"
                        :aria-label="`${t('bookRequests.releases.scoreLabel', { score: release.score })}. ${t('bookRequests.releases.whyThisScore')}`"
                        @click="toggleWhy(release)"
                      >
                        {{ release.score }}
                      </button>
                      <span
                        v-else
                        class="grid size-11 place-items-center rounded-[calc(var(--radius)+2px)] border text-[15px] font-semibold tabular-nums"
                        :class="scoreClass(release.score)"
                      >
                        <span aria-hidden="true">{{ release.score }}</span>
                        <span class="sr-only">{{ t('bookRequests.releases.scoreLabel', { score: release.score }) }}</span>
                      </span>
                    </div>

                    <!--
                      The title is the link because it is what the source page describes.
                      `noreferrer` keeps a private tracker from learning this instance's address.
                    -->
                    <p class="col-start-2 row-start-1 min-w-0 truncate text-sm leading-5 font-medium text-foreground" :title="release.title">
                      <a
                        v-if="release.infoUrl"
                        :href="release.infoUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                        :aria-label="t('bookRequests.releases.releasePageLabel', { title: release.title, indexer: release.indexerName })"
                        class="rounded-xs hover:underline hover:underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {{ release.title }}
                      </a>
                      <template v-else>{{ release.title }}</template>
                    </p>

                    <div class="col-start-3 row-start-1 flex items-center gap-1.5 @min-[35rem]:row-[1/span_3]">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        class="size-7"
                        :aria-label="fileToggleLabel(release)"
                        :aria-expanded="filesAreExpanded(release)"
                        @click="toggleFiles(release)"
                      >
                        <EyeOff v-if="filesAreExpanded(release)" :size="16" aria-hidden="true" />
                        <Eye v-else :size="16" aria-hidden="true" />
                      </Button>
                      <Button
                        :variant="isBest(index) ? 'default' : 'outline'"
                        size="sm"
                        class="h-7 min-w-[52px] gap-1 px-2.5 text-[13px]"
                        :disabled="busy || isInspecting(release) || inspectionBlocksSend(release) || isRefused(release)"
                        @click="handleGrab(release)"
                      >
                        <template v-if="isInspecting(release)">
                          <Loader2 class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                          <span class="sr-only">{{ t('bookRequests.releases.inspectingShort') }}</span>
                        </template>
                        <template v-else>{{ t('bookRequests.releases.send') }}</template>
                      </Button>
                    </div>

                    <!--
                      One line of chips on a wide box, Best match first. On a phone the line comes
                      apart: where the release comes from takes the second line and what sets it
                      apart the fourth, each a fixed height whether or not it has anything to say.
                    -->
                    <div
                      class="contents @min-[35rem]:col-start-2 @min-[35rem]:row-start-2 @min-[35rem]:flex @min-[35rem]:h-5 @min-[35rem]:min-w-0 @min-[35rem]:items-center @min-[35rem]:gap-1.5 @min-[35rem]:overflow-hidden"
                    >
                      <div class="col-[2/-1] row-start-2 flex h-5 min-w-0 items-center gap-1.5 overflow-hidden @min-[35rem]:contents">
                        <span :class="[CHIP, protocolChipClass(deliveryFor(release))]">
                          <Magnet v-if="deliveryFor(release) === 'torrent'" :size="12" class="flex-none" aria-hidden="true" />
                          <Newspaper v-else-if="deliveryFor(release) === 'usenet'" :size="12" class="flex-none" aria-hidden="true" />
                          <Globe v-else :size="12" class="flex-none" aria-hidden="true" />
                          <span class="sr-only @min-[35rem]:not-sr-only">{{ protocolText(release) }}</span>
                        </span>
                        <span v-if="!sharedIndexer" :class="[CHIP, indexerChipClass(release)]">{{ release.indexerName }}</span>
                      </div>
                      <div class="col-[2/-1] row-start-4 flex h-5 min-w-0 items-center gap-1.5 overflow-hidden @min-[35rem]:contents">
                        <span v-if="isBest(index)" :class="[CHIP, TONE_CHIPS.primary, '@min-[35rem]:order-first']">
                          <Zap :size="12" class="flex-none" aria-hidden="true" />
                          {{ t('bookRequests.releases.bestMatch') }}
                        </span>
                        <span v-if="release.alreadyGrabbed" :class="[CHIP, TONE_CHIPS.info]">{{ t('bookRequests.releases.alreadyGrabbed') }}</span>
                        <span v-if="release.vipOnly" :class="[CHIP, TONE_CHIPS.warning]">{{ t('bookRequests.releases.vipOnly') }}</span>
                        <span v-if="release.freeleech && !allFreeleech" :class="[CHIP, TONE_CHIPS.success]">{{
                          t('bookRequests.releases.freeleech')
                        }}</span>
                        <span v-if="refusalText(release)" :class="[CHIP, TONE_CHIPS.destructive]">{{ refusalText(release) }}</span>
                        <span v-if="skipShortText(release)" :class="[CHIP, TONE_CHIPS.warning, 'min-w-0']" :title="skipText(release) ?? undefined">
                          <TriangleAlert :size="12" class="flex-none" aria-hidden="true" />
                          <span class="truncate">{{ skipShortText(release) }}</span>
                        </span>
                      </div>
                    </div>

                    <p class="col-[2/-1] row-start-3 h-5 truncate text-[12.5px] leading-5 text-muted-foreground @min-[35rem]:col-[2/3]">
                      <span v-if="release.formats.length" class="inline-flex gap-1 align-[1px]">
                        <span
                          v-for="format in formatKeys(release)"
                          :key="format"
                          data-format
                          class="rounded-[4px] border px-1.5 text-[11.5px] leading-[17px] font-semibold tracking-[0.02em]"
                          :style="formatChipStyle(format)"
                        >
                          {{ format }}
                        </span>
                      </span>
                      <span
                        v-for="(fact, factIndex) in rowFacts(release)"
                        :key="fact.key"
                        :class="[fact.wideOnly && 'hidden @min-[35rem]:inline', fact.numeric && 'tabular-nums']"
                      >
                        <span v-if="factIndex > 0 || release.formats.length" class="mx-1.5" aria-hidden="true">·</span>
                        <span :class="fact.tone">{{ fact.text }}</span>
                      </span>
                    </p>

                    <div
                      v-if="isExpanded(release) || filesAreExpanded(release)"
                      class="col-[1/-1] row-start-5 grid gap-3 pt-1.5 @min-[35rem]:col-[2/-1] @min-[35rem]:row-start-4"
                    >
                      <div v-if="isExpanded(release)" class="grid gap-1.5 text-[12.5px] text-muted-foreground">
                        <p v-if="skipText(release)" class="max-w-[70ch]">{{ skipText(release) }}</p>
                        <template v-if="release.reasons.length">
                          <p class="text-[13px] font-medium text-foreground">{{ t('bookRequests.releases.scoreBreakdown') }}</p>
                          <ul class="flex flex-wrap gap-1.5" :aria-label="t('bookRequests.releases.scoreBreakdown')">
                            <li
                              v-for="reason in credits(release)"
                              :key="reason.code"
                              class="inline-flex items-baseline gap-1.5 rounded-full border border-border px-2 py-px text-xs text-foreground"
                            >
                              {{ reasonText(reason) }}
                              <b class="font-semibold text-success tabular-nums">{{ reasonPoints(reason.points) }}</b>
                            </li>
                            <li
                              v-for="reason in penalties(release)"
                              :key="reason.code"
                              class="inline-flex items-baseline gap-1.5 rounded-full border border-border px-2 py-px text-xs text-foreground"
                            >
                              {{ reasonText(reason) }}
                              <b class="font-semibold text-destructive tabular-nums">{{ reasonPoints(reason.points) }}</b>
                            </li>
                          </ul>
                        </template>
                        <p v-if="addedDate(release) || (isBest(index) && tiedWithBest > 0)" class="flex flex-wrap gap-x-1.5">
                          <span v-if="addedDate(release)">{{ t('bookRequests.releases.addedOn', { date: addedDate(release) }) }}</span>
                          <span v-if="addedDate(release) && isBest(index) && tiedWithBest > 0" aria-hidden="true">·</span>
                          <span v-if="isBest(index) && tiedWithBest > 0">{{ t('bookRequests.releases.tiedWithBest', { count: tiedWithBest }) }}</span>
                        </p>
                      </div>
                      <ReleaseFileInspectionPanel
                        v-if="filesAreExpanded(release)"
                        :inspection="inspectionFor(release)"
                        :delivery="deliveryFor(release)"
                        :loading="isInspecting(release)"
                        :failed="inspectionHasFailed(release)"
                        :failure-reason="inspectionFailureReason(release)"
                      />
                    </div>
                  </li>
                </ul>
              </template>
            </div>
            <p class="mt-3.5 max-w-[70ch] text-xs text-muted-foreground">{{ t('bookRequests.releases.singleFileNote') }}</p>
          </template>
        </template>

        <GrabReleaseDialog
          :request="manualOpen ? request : null"
          :clients="torrentClients"
          :busy="busy"
          @close="closeManual"
          @grab="handleManualGrab"
        />
      </template>
    </div>

    <!--
      Beside the list it governs rather than on each row: it answers a doubt about the request, and
      applies to a magnet pasted by hand as much as to a ranked release.
    -->
    <footer v-if="request && !finished" class="flex shrink-0 items-center gap-2 border-t border-border bg-background px-4 py-2.5">
      <label class="inline-flex cursor-pointer items-center gap-2 text-[13px] text-foreground">
        <ToggleSwitch v-model="holdForReview" />
        {{ t('bookRequests.releases.holdForReview') }}
      </label>
    </footer>
  </div>
</template>
