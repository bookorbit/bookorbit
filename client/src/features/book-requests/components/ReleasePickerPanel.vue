<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleMinus,
  Download,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  Magnet,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SearchX,
  TriangleAlert,
  Zap,
} from '@lucide/vue'
import { Permission, releaseInspectionBlocksGrab } from '@bookorbit/types'
import type { IndexerSearchFailure, ReleaseCandidateItem, ReleaseFileInspection, ReleaseSearchCriteria } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { formatColorVar } from '@/features/book/lib/format-colors'
import { formatDate, formatLanguageName } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import GrabReleaseDialog from './GrabReleaseDialog.vue'
import ReleaseFileInspectionPanel from './ReleaseFileInspectionPanel.vue'
import RequestCover from './RequestCover.vue'
import RequestDrawerToolbar from './RequestDrawerToolbar.vue'
import RequestEmptyState from './RequestEmptyState.vue'
import EntityNotFound from '@/components/EntityNotFound.vue'
import { formatKey, formatKeys, languageKey } from '../releaseFacets'
import { requestFailureText } from '../requestOutcome'
import { protocolChipClass, sourceChipClass } from '../sourceColors'
import { useBookRequestActions } from '../composables/useBookRequests'
import { useBookRequestDetail } from '../composables/useBookRequestDetail'
import { useDownloadClientSummaries } from '../composables/useDownloadClients'
import { useReleaseFacetGroups } from '../composables/useReleaseFacetGroups'
import { useReleaseFilters } from '../composables/useReleaseFilters'
import { useReleaseGrab } from '../composables/useReleaseGrab'
import { useReleasePicker } from '../composables/useReleasePicker'
import { useReleaseSearchEditor } from '../composables/useReleaseSearchEditor'
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
const { clients, fetchClients } = useDownloadClientSummaries(canManage)
const actions = useBookRequestActions(canManage)

/** Near-universal for spoken audio, so stating it on every row would be noise, not information. */
const COMMON_SAMPLING_RATE_HZ = 44100
/** How many clean sources are listed one by one before they collapse into their total. */
const MAX_LISTED_SOURCES = 4

const requestId = computed(() => Number(route.params.id))

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

const { manualOpen, grabbing, openManual, closeManual, forgetRefusals, handleGrab, handleManualGrab, isRefused, refusalText } = useReleaseGrab({
  request,
  requestId,
  grab: actions.grab,
  setRequest,
  inspectRelease,
  setFilesExpanded,
  seedsBack,
})

/**
 * Every Send is off while one release is on its way, not only the row being inspected. The
 * inspection is a tracker round trip, and until it answers no grab has been called for this
 * request, so `actions` has nothing to be busy about yet.
 */
const busy = computed(() => grabbing.value || actions.isPending(request.value?.id))
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
      ? indexer.query.kind === 'isbn'
        ? indexer.query.value === criteria.value?.activeIsbn
        : !criteria.value?.activeIsbn
      : false,
    isbnQuery: indexer.query?.kind === 'isbn',
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
const sharedIndexerClass = computed(() => sourceChipClass(colorByIndexer.value.get(sharedIndexerId.value ?? -1)))
const allFreeleech = computed(() => releases.value.length > 0 && releases.value.every((release) => release.freeleech))

const summaryFacts = computed(() => {
  const facts: string[] = []
  if (allFreeleech.value) facts.push(t('bookRequests.releases.allFreeleech'))
  if (sharedLanguage.value) facts.push(t('bookRequests.releases.allLanguage', { language: sharedLanguage.value }))
  if (sharedFormat.value) facts.push(t('bookRequests.releases.allFormat', { format: sharedFormat.value }))
  return facts
})

/**
 * Whether each searched source joins a swarm at all, which is a property of the adapter and not
 * of any one release. Without it the panel could only guess from the list, and a single tracker
 * reporting seeders made every Library Genesis row read "seeders unknown" - which was not the
 * source omitting a count, but a plain HTTP library that has no swarm to count.
 */
const swarmByIndexer = computed(() => new Map(indexers.value.map((indexer) => [indexer.indexerId, indexer.seedsBack])))

const { facetGroups } = useReleaseFacetGroups(filters, colorByIndexer, allFreeleech)

/** Only what separates this release from the others; the rest is already in the summary line. */
const expandedScores = ref(new Set<string>())

/**
 * One fact in a row's metadata run. `parts` because a format fact is several values at once and
 * the requested one among them is emphasised, while every other fact is a single string.
 */
interface MetaFact {
  key: string
  parts: Array<{ text: string; emphasis: boolean }>
  /** Aligns digits between rows, for the facts that are numbers rather than names. */
  numeric?: boolean
}

onMounted(async () => {
  await Promise.all([fetchRequest(requestId.value), fetchClients()])
  if (Number.isInteger(requestId.value)) void fetchInitialReleases(requestId.value)
})

watch(requestId, (id) => {
  if (!Number.isInteger(id)) return
  reset()
  resetSearchEditorState()
  searchPanelChoice.value = null
  showEachSource.value = false
  expandedFiles.value = new Set()
  resetFilters()
  void fetchRequest(id)
  void fetchInitialReleases(id)
})

function releaseKey(release: ReleaseCandidateItem): string {
  return `${release.indexerId}:${release.guid}`
}

/** Rank has to be legible before the number is read, so the score carries a band. */
function scoreClass(score: number): string {
  if (score >= 70) return 'text-success'
  if (score >= 55) return 'text-info'
  if (score >= 40) return 'text-warning'
  return 'text-muted-foreground'
}

/** The band has to read before the number does, so the score carries a tinted surface too. */
function scoreSurfaceClass(score: number): string {
  if (score >= 70) return 'border-success/45 bg-success/10'
  if (score >= 55) return 'border-info/45 bg-info/10'
  if (score >= 40) return 'border-warning/45 bg-warning/10'
  return 'border-border bg-muted'
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

function indexerChipClass(release: ReleaseCandidateItem): string {
  return sourceChipClass(colorByIndexer.value.get(release.indexerId))
}

/**
 * The chip's own colour, from a per-theme token rather than a fixed hex: the palette this replaced
 * was one set of values for both themes, and the brightest of them was around 1.9:1 on a light
 * surface. The tint and the border are mixed toward transparent, which is alpha on a fill and a
 * border rather than on the text.
 */
function formatFacetStyle(value: string, active: boolean): Record<string, string> {
  const color = formatColorVar(value)
  return {
    color,
    borderColor: active ? color : `color-mix(in oklch, ${color} 40%, transparent)`,
    backgroundColor: `color-mix(in oklch, ${color} ${active ? '20%' : '10%'}, transparent)`,
  }
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

/**
 * The row's facts as one ordered run, so the template can separate them instead of relying on a
 * gap between six spans of identical muted text to say where one fact ends and the next begins.
 *
 * Facts already stated once above the list are dropped here rather than repeated per row.
 */
function metaFacts(release: ReleaseCandidateItem): MetaFact[] {
  const facts: MetaFact[] = []
  if (release.language && !sharedLanguage.value) {
    facts.push({ key: 'language', parts: [{ text: formatLanguageName(release.language), emphasis: true }] })
  }
  if (release.formats.length > 0 && !sharedFormat.value) {
    facts.push({ key: 'format', parts: formatKeys(release).map((value) => ({ text: value, emphasis: isPreferredFormat(value) })) })
  }
  if (release.sizeBytes) facts.push({ key: 'size', numeric: true, parts: [{ text: formatBytes(release.sizeBytes), emphasis: false }] })
  if (release.fileCount !== null) {
    facts.push({
      key: 'files',
      numeric: true,
      // A single file is the shape an approver hunting an audiobook is usually after, so it carries
      // the emphasis rather than being one more grey number in the run.
      parts: [{ text: t('bookRequests.releases.fileCount', { count: release.fileCount }), emphasis: release.fileCount === 1 }],
    })
  }
  if (showsSeeders(release)) facts.push({ key: 'seeders', numeric: true, parts: [{ text: seederText(release), emphasis: false }] })
  if (release.publishedAt) {
    facts.push({ key: 'added', numeric: true, parts: [{ text: formatDate(new Date(release.publishedAt)), emphasis: false }] })
  }
  return facts
}

/**
 * A release carrying three formats is labelled with all three, so the one the request asked for
 * has to be findable among them. It leads the list already; this is what says why it leads.
 */
function isPreferredFormat(value: string): boolean {
  return (criteria.value?.preferredFormats ?? []).some((preferred) => preferred.toUpperCase() === value)
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
  <div class="@container flex h-full min-h-0 flex-col">
    <RequestDrawerToolbar leading="back" @back="goBack">
      <template #title>
        <p class="truncate text-sm font-medium text-foreground">
          {{ isRetry ? t('bookRequests.releases.retryTitle') : t('bookRequests.releases.title') }}
        </p>
      </template>
      <template #actions>
        <Button variant="ghost" size="sm" :disabled="loading" @click="handleRefresh">
          <RefreshCw :size="14" aria-hidden="true" />
          {{ t('bookRequests.releases.refresh') }}
        </Button>
        <Button variant="ghost" size="sm" @click="openManual">{{ t('bookRequests.releases.manual') }}</Button>
      </template>
    </RequestDrawerToolbar>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div v-if="requestLoading" role="status" class="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 class="size-4 animate-spin" aria-hidden="true" />
        {{ t('bookRequests.detail.loading') }}
      </div>

      <EntityNotFound v-else-if="requestError === 'notFound' || requestError === 'forbidden'" :entity="t('bookRequests.detail.entityName')" />

      <p v-else-if="requestError" role="alert" class="text-sm text-destructive">{{ t(`bookRequests.detail.errors.${requestError}`) }}</p>

      <template v-else-if="request">
        <!-- The stage is named in the toolbar, so what is left here is the book being grabbed for. -->
        <header class="flex items-center gap-3.5">
          <RequestCover :src="request.coverUrl" :media-kind="request.mediaKind" class="h-[72px] w-12 shadow-sm" :icon-size="20" />

          <div class="min-w-0 flex-1">
            <h2 class="truncate text-base font-semibold tracking-tight text-foreground">{{ request.title }}</h2>
            <p class="mt-0.5 truncate text-sm text-muted-foreground">
              {{ authorLine || t('bookRequests.detail.unknownAuthor') }}
              <template v-if="request.publishedYear">
                &middot; <span class="tabular-nums">{{ request.publishedYear }}</span>
              </template>
            </p>
          </div>
        </header>

        <p v-if="isRetry && failureText" class="mt-3 text-sm text-muted-foreground">
          {{ t('bookRequests.releases.previousFailure', { reason: failureText }) }}
        </p>

        <!--
          Hidden entirely while no source is enabled, rather than headed with a different sentence.
          Every part of it - the key, the local filters, the alternate keys to try next - describes
          a search, and offering to change the terms of one that will not run is the same lie in a
          quieter voice. The empty state below says what actually happened.
        -->
        <section
          v-if="criteria && !noSourcesEnabled"
          class="mt-3 rounded-lg border border-border bg-muted/40 p-3"
          :aria-label="t('bookRequests.releases.criteria.label')"
        >
          <div class="flex items-start justify-between gap-3">
            <!--
              One key, stated once. The old panel said it three times: in the hint sentence, in a
              chip, and again in every per-indexer card underneath.
            -->
            <i18n-t
              v-if="searchFoundNothing"
              keypath="bookRequests.releases.criteria.nothingFound"
              tag="p"
              scope="global"
              class="min-w-0 text-sm font-medium text-foreground"
            >
              <template #key>
                <span :class="criteria.activeIsbn && 'font-mono tabular-nums'">{{ activeKeyText }}</span>
              </template>
            </i18n-t>
            <p v-else class="flex min-w-0 items-center gap-2 text-sm">
              <Search :size="14" class="shrink-0 text-muted-foreground" aria-hidden="true" />
              <span class="shrink-0 text-muted-foreground">
                {{ t(criteria.activeIsbn ? 'bookRequests.releases.criteria.searched' : 'bookRequests.releases.criteria.searchedTitleAuthor') }}
              </span>
              <span class="truncate text-foreground" :class="criteria.activeIsbn && 'font-mono tabular-nums'" :title="activeKeyText">
                {{ activeKeyText }}
              </span>
            </p>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="h-7 shrink-0 px-2 text-xs"
              :aria-expanded="searchPanelOpen"
              aria-controls="release-search-options"
              @click="toggleSearchPanel"
            >
              {{ searchPanelOpen ? t('bookRequests.releases.criteria.closeSearch') : t('bookRequests.releases.criteria.changeSearch') }}
              <ChevronUp v-if="searchPanelOpen" :size="13" aria-hidden="true" />
              <ChevronDown v-else :size="13" aria-hidden="true" />
            </Button>
          </div>

          <!--
            Kept visible rather than folded away: this is the only place that separates a source
            that found nothing from one whose session expired, and those need opposite fixes.
          -->
          <ul v-if="sourceRows.length" class="mt-2.5 space-y-1" :aria-label="t('bookRequests.releases.criteria.sources')">
            <li v-if="sourcesCondensed" class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <CircleCheck :size="13" class="shrink-0 text-success" aria-hidden="true" />
              <span class="font-medium text-foreground">
                {{ t('bookRequests.releases.criteria.sourcesSearched', { count: cleanSourceRows.length }) }}
              </span>
              <Button type="button" variant="ghost" size="sm" class="h-5 px-1.5 text-xs" @click="showEverySource">
                {{ t('bookRequests.releases.criteria.showEachSource') }}
              </Button>
              <span class="ms-auto tabular-nums text-foreground">
                {{ t('bookRequests.releases.criteria.sourceReleases', { count: condensedReleaseCount }) }}
              </span>
            </li>

            <li v-for="row in listedSourceRows" :key="row.id" class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <TriangleAlert v-if="!row.ok" :size="13" class="shrink-0 text-warning" aria-hidden="true" />
              <CircleCheck v-else-if="row.count > 0" :size="13" class="shrink-0 text-success" aria-hidden="true" />
              <CircleMinus v-else :size="13" class="shrink-0 text-muted-foreground" aria-hidden="true" />

              <span class="shrink-0 font-medium text-foreground">{{ row.name }}</span>
              <span v-if="row.echoesKey" class="text-muted-foreground">
                {{
                  t(row.isbnQuery ? 'bookRequests.releases.criteria.sourceSearchedIsbn' : 'bookRequests.releases.criteria.sourceSearchedTitleAuthor')
                }}
              </span>
              <span v-else-if="row.query" class="min-w-0 truncate font-mono text-muted-foreground" :title="row.query">{{ row.query }}</span>
              <span v-else class="text-muted-foreground">{{ t('bookRequests.releases.criteria.sourceNoAdapter') }}</span>

              <span class="ms-auto flex shrink-0 items-center gap-2">
                <Loader2 v-if="loading" class="size-3 animate-spin text-muted-foreground" aria-hidden="true" />
                <template v-else-if="!row.ok">
                  <span class="text-warning">{{ t(`bookRequests.releases.failures.${row.failure ?? 'error'}`) }}</span>
                  <!-- The one failure with a specific fix, rather than a re-run of the same search. -->
                  <RouterLink
                    v-if="row.failure === 'unauthorized' && canFixSources"
                    :to="{ name: 'settings-admin-requests' }"
                    class="inline-flex items-center gap-0.5 text-foreground underline-offset-2 hover:underline"
                  >
                    {{ t('bookRequests.releases.criteria.fixSource') }}
                    <ArrowUpRight :size="12" aria-hidden="true" />
                  </RouterLink>
                </template>
                <template v-else>
                  <span v-if="row.filtered" class="text-muted-foreground">
                    {{ t('bookRequests.releases.criteria.sourceFiltered', { count: row.filtered }) }}
                  </span>
                  <span v-if="row.count > 0" class="tabular-nums text-foreground">
                    {{ t('bookRequests.releases.criteria.sourceReleases', { count: row.count }) }}
                  </span>
                  <span v-else class="text-muted-foreground">{{ t('bookRequests.releases.criteria.sourceNone') }}</span>
                </template>
              </span>
            </li>

            <li v-if="uncoveredIndexerCount" class="ps-5 text-xs text-muted-foreground">
              {{ t('bookRequests.releases.criteria.uncovered', { count: uncoveredIndexerCount }) }}
            </li>
          </ul>

          <div v-if="searchPanelOpen" id="release-search-options" class="mt-2.5 border-t border-border pt-2.5">
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
          </div>
        </section>

        <!-- Not while nothing was searched: "showing the last search" is the same claim again. -->
        <p v-if="cached && !loading && !noSourcesEnabled" class="mt-3 text-xs text-muted-foreground">
          {{ t('bookRequests.releases.cached') }}
        </p>

        <p v-if="loading" role="status" class="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 class="size-4 animate-spin" aria-hidden="true" />
          {{ t('bookRequests.releases.searching') }}
        </p>

        <!-- Otherwise a search that failed once leaves closing and reopening the picker as the fix. -->
        <div v-else-if="loadFailed" role="alert" class="mt-5 flex flex-wrap items-center gap-3">
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
            <Button variant="ghost" size="sm" @click="openManual">{{ t('bookRequests.releases.manual') }}</Button>
          </RequestEmptyState>

          <!--
            A medium nothing carries is the one empty state the panel above cannot explain: no
            source was searched, so its list is empty too, and the fix is to add a source that
            covers this kind of book rather than to try another key.
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
            <Button variant="ghost" size="sm" @click="openManual">{{ t('bookRequests.releases.manual') }}</Button>
          </RequestEmptyState>

          <template v-else-if="releases.length > 0">
            <!--
              Everything true of every release, said once. Four of the old nine columns were
              constant on a single-indexer search, and dropping them gives the two that actually
              differ the width the release title was being squeezed out of.
            -->
            <p class="mt-3.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span class="font-medium text-foreground">{{ t('bookRequests.releases.summaryCount', { count: releases.length }) }}</span>
              <template v-for="fact in summaryFacts" :key="fact">
                <span aria-hidden="true" class="opacity-50">&middot;</span>
                <span>{{ fact }}</span>
              </template>
              <template v-if="sharedIndexer">
                <span aria-hidden="true" class="opacity-50">&middot;</span>
                <span class="rounded-full border px-1.5 py-px font-medium" :class="sharedIndexerClass">
                  {{ t('bookRequests.releases.allIndexer', { name: sharedIndexer }) }}
                </span>
              </template>
            </p>

            <p
              v-if="nothingMatchedProfile"
              role="status"
              class="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-foreground"
            >
              <TriangleAlert :size="14" class="mt-px shrink-0 text-warning" aria-hidden="true" />
              <span class="settings-prose">{{ t('bookRequests.releases.noneMatchedProfile') }}</span>
            </p>

            <!--
              Sort is one choice among a few, so it reads as a segmented control; the facets are
              independent toggles, so they read as chips. Rendered flat rather than as the old
              left rail, because the cards below need no column budget defended.
            -->
            <div v-if="showFacets" class="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2.5">
              <div v-for="group in facetGroups" :key="group.key" role="group" :aria-label="group.label" class="flex flex-wrap items-center gap-1.5">
                <span class="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{{ group.label }}</span>

                <div v-if="group.key === 'sort'" class="flex rounded-lg bg-muted p-0.5">
                  <button
                    v-for="option in group.options"
                    :key="option.id"
                    type="button"
                    class="rounded-md px-2.5 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                    :class="option.active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
                    :aria-pressed="option.active"
                    @click="option.select"
                  >
                    {{ option.label }}
                  </button>
                </div>

                <template v-else>
                  <button
                    v-for="option in group.options"
                    :key="option.id"
                    type="button"
                    class="flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                    :class="[
                      option.className ??
                        (option.active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-muted-foreground hover:border-ring hover:text-foreground'),
                      option.className && option.active && 'ring-2 ring-current ring-offset-1 ring-offset-background',
                      group.key === 'format' && 'uppercase',
                    ]"
                    :style="group.key === 'format' ? formatFacetStyle(option.label, option.active) : undefined"
                    :aria-pressed="option.active"
                    @click="option.select"
                  >
                    <span class="min-w-0 truncate">{{ option.label }}</span>
                    <span v-if="option.count !== null" class="tabular-nums opacity-75">{{ option.count }}</span>
                  </button>
                </template>
              </div>

              <Button v-if="hasFilter" variant="ghost" size="sm" @click="clearFilters">
                {{ t('bookRequests.releases.clearFilters') }}
              </Button>
            </div>

            <p
              v-if="visibleReleases.length === 0"
              role="status"
              class="mt-4 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground"
            >
              {{ t('bookRequests.releases.filteredEmpty') }}
            </p>

            <!--
              One shape for every release, including the best one. The old layout drew the winner
              as a bordered box and its nearest rival as a bare numeral in a table cell, which
              made two releases tied at the same score impossible to compare at a glance.
            -->
            <ul v-else class="mt-4 space-y-2" :aria-label="t('bookRequests.releases.tableCaption')">
              <li
                v-for="(release, index) in visibleReleases"
                :key="releaseKey(release)"
                class="rounded-xl border p-3 transition-colors motion-reduce:transition-none"
                :class="isBest(index) ? 'border-primary/50 bg-primary/6 hover:bg-primary/10' : 'border-border bg-card hover:bg-accent/50'"
              >
                <div class="flex flex-wrap items-center gap-x-3 gap-y-3">
                  <!--
                    A basis, not just `flex-1`: growing from zero never exceeds the row, so the
                    send button stayed on the line and squeezed the title down to one word per
                    line on a phone. Given a real basis the button wraps under it instead.
                  -->
                  <div class="flex min-w-0 flex-1 basis-72 items-center gap-3">
                    <!--
                      The label is sr-only text rather than `aria-label`: a plain span is not a
                      role that takes a name, so most screen reader and browser pairs ignore one
                      there and announce the bare number with nothing saying what it counts.
                    -->
                    <span
                      class="flex size-11 shrink-0 items-center justify-center rounded-lg border text-[15px] font-semibold tabular-nums"
                      :class="[scoreClass(release.score), scoreSurfaceClass(release.score)]"
                    >
                      <span aria-hidden="true">{{ release.score }}</span>
                      <span class="sr-only">{{ t('bookRequests.releases.scoreLabel', { score: release.score }) }}</span>
                    </span>

                    <div class="min-w-0 flex-1">
                      <p v-if="isBest(index)" class="mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span class="inline-flex items-center gap-1 text-[11px] font-semibold tracking-wide text-primary uppercase">
                          <Zap :size="12" aria-hidden="true" />
                          {{ t('bookRequests.releases.bestMatch') }}
                        </span>
                        <span v-if="tiedWithBest > 0" class="rounded-full border border-border px-2 py-px text-[11px] text-muted-foreground">
                          {{ t('bookRequests.releases.tiedWithBest', { count: tiedWithBest }) }}
                        </span>
                      </p>

                      <p class="line-clamp-2 text-sm font-medium text-foreground">{{ release.title }}</p>

                      <!--
                        Two runs, not one. The chips say where the release comes from and what
                        grabbing it will do, which is categorical and the same on every row from
                        one source; the text run below states this release's own numbers. Run
                        together they were six spans of identical muted text with nothing but a
                        gap to say where one fact ended and the next began.
                      -->
                      <div class="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                        <span
                          class="inline-flex items-center gap-1 rounded-full border px-1.5 py-px font-medium"
                          :class="protocolChipClass(seedsBack(release))"
                        >
                          <Magnet v-if="seedsBack(release)" :size="11" aria-hidden="true" />
                          <Globe v-else :size="11" aria-hidden="true" />
                          {{ seedsBack(release) ? t('bookRequests.releases.protocol.torrent') : t('bookRequests.releases.protocol.directPill') }}
                        </span>
                        <!--
                          Neutral until an operator says otherwise. There is no closed set of
                          indexers to build a palette from, so no hue could be derived that stood
                          for "MyAnonaMouse" in a way a reader could decode; one assigned in
                          settings is decodable precisely because somebody chose it. The name still
                          carries the identity on its own, so an uncoloured source loses nothing.
                        -->
                        <span v-if="!sharedIndexer" class="rounded-full border px-1.5 py-px font-medium" :class="indexerChipClass(release)">
                          {{ release.indexerName }}
                        </span>
                        <!--
                          The operator's own words for why this release ranks where it does. It
                          leads the flags because it is the axis the list is ordered on, and a row
                          whose position the score alone cannot explain needs it said.
                        -->
                        <span
                          v-if="release.tierName"
                          class="rounded-full border border-primary/45 bg-primary/10 px-1.5 py-px font-medium text-primary"
                        >
                          {{ release.tierName }}
                        </span>
                        <span
                          v-if="release.alreadyGrabbed"
                          class="rounded-full border border-border bg-muted px-1.5 py-px font-medium text-muted-foreground"
                        >
                          {{ t('bookRequests.releases.alreadyGrabbed') }}
                        </span>
                        <span
                          v-if="release.vipOnly"
                          class="rounded-full border border-warning/40 bg-warning/10 px-1.5 py-px font-medium text-warning"
                        >
                          {{ t('bookRequests.releases.vipOnly') }}
                        </span>
                        <span
                          v-if="refusalText(release)"
                          class="rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-px font-medium text-destructive"
                        >
                          {{ refusalText(release) }}
                        </span>
                        <span
                          v-if="release.freeleech && !allFreeleech"
                          class="rounded-full border border-success/40 bg-success/10 px-1.5 py-px font-medium text-success"
                        >
                          {{ t('bookRequests.releases.freeleech') }}
                        </span>
                      </div>

                      <div class="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                        <template v-for="(fact, factIndex) in metaFacts(release)" :key="fact.key">
                          <span v-if="factIndex > 0" aria-hidden="true">·</span>
                          <span :class="fact.numeric && 'tabular-nums'">
                            <template v-for="(part, partIndex) in fact.parts" :key="part.text">
                              <span v-if="partIndex > 0" aria-hidden="true"> + </span>
                              <span :class="part.emphasis && 'font-medium text-foreground'">{{ part.text }}</span>
                            </template>
                          </span>
                        </template>

                        <!--
                          The credits are mostly signals every release shares, so shown inline
                          they were the loudest thing on screen and the least decisive. Penalties
                          stay out; the rest is one click away for whoever wants to audit it.
                        -->
                        <button
                          v-if="credits(release).length"
                          type="button"
                          class="ms-1 rounded text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          :aria-expanded="isExpanded(release)"
                          @click="toggleWhy(release)"
                        >
                          {{ t('bookRequests.releases.whyThisScore') }}
                        </button>
                      </div>

                      <p v-if="audioParts(release).length" class="mt-0.5 text-xs text-muted-foreground">
                        <span class="sr-only">{{ t('bookRequests.releases.audio') }}: </span>
                        {{ audioParts(release).join(' · ') }}
                      </p>

                      <span
                        v-for="penalty in penalties(release)"
                        :key="penalty.code"
                        class="mt-0.5 flex items-center gap-1.5 text-xs text-destructive"
                      >
                        <TriangleAlert :size="12" class="shrink-0" aria-hidden="true" />
                        {{ reasonText(penalty) }} <span class="tabular-nums">{{ reasonPoints(penalty.points) }}</span>
                      </span>

                      <ul v-if="isExpanded(release)" class="mt-1.5 flex flex-wrap gap-1" :aria-label="t('bookRequests.releases.scoreBreakdown')">
                        <li
                          v-for="reason in credits(release)"
                          :key="reason.code"
                          class="rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                        >
                          {{ reasonText(reason) }} <span class="tabular-nums text-foreground">{{ reasonPoints(reason.points) }}</span>
                        </li>
                      </ul>
                    </div>
                  </div>

                  <div class="ms-auto flex items-center gap-1.5">
                    <Button variant="ghost" size="sm" :aria-expanded="filesAreExpanded(release)" @click="toggleFiles(release)">
                      <EyeOff v-if="filesAreExpanded(release)" :size="14" aria-hidden="true" />
                      <Eye v-else :size="14" aria-hidden="true" />
                      {{ filesAreExpanded(release) ? t('bookRequests.releases.hideFiles') : t('bookRequests.releases.viewFiles') }}
                    </Button>
                    <Button
                      :variant="isBest(index) ? 'default' : 'outline'"
                      size="sm"
                      :disabled="busy || isInspecting(release) || inspectionBlocksSend(release) || isRefused(release)"
                      @click="handleGrab(release)"
                    >
                      <Loader2 v-if="isInspecting(release)" class="size-3.5 animate-spin" aria-hidden="true" />
                      <Download v-else-if="isBest(index)" :size="14" aria-hidden="true" />
                      {{
                        isInspecting(release)
                          ? t('bookRequests.releases.inspectingShort')
                          : isBest(index)
                            ? t('bookRequests.releases.grab')
                            : t('bookRequests.releases.send')
                      }}
                    </Button>
                  </div>
                </div>

                <ReleaseFileInspectionPanel
                  v-if="filesAreExpanded(release)"
                  :inspection="inspectionFor(release)"
                  :loading="isInspecting(release)"
                  :failed="inspectionHasFailed(release)"
                  :failure-reason="inspectionFailureReason(release)"
                />
              </li>
            </ul>
            <p class="mt-3 text-xs text-muted-foreground">{{ t('bookRequests.releases.singleFileNote') }}</p>
          </template>
        </template>

        <GrabReleaseDialog :request="manualOpen ? request : null" :clients="clients" :busy="busy" @close="closeManual" @grab="handleManualGrab" />
      </template>
    </div>
  </div>
</template>
