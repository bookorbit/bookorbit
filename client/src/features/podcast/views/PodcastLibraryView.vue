<script setup lang="ts">
import { computed, onScopeDispose, provide, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { CheckSquare, FolderX, ListPlus, Play, Plus, SlidersHorizontal, Square, Trash2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type {
  PodcastEpisodeFilter,
  PodcastEpisodeListItem,
  PodcastEpisodeSort,
  PodcastEpisodeSummary,
  PodcastJobStatus,
  PodcastListItem,
  PodcastOpmlImportResult,
  PodcastPlaylistRules,
  PodcastSort,
} from '@bookorbit/types'
import { Permission } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { errorMessage } from '@/lib/api-json'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useViewDisplaySettings } from '@/composables/useViewDisplaySettings'
import { useInfiniteScrollSentinel } from '@/composables/useInfiniteScrollSentinel'
import { PODCAST_EPISODE_ACTIONS, usePodcastEpisodeListActions } from '../composables/usePodcastEpisodeListActions'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import ChipGroup from '@/components/ChipGroup.vue'
import ListEndFooter from '@/components/ListEndFooter.vue'
import ListSkeleton from '@/components/ListSkeleton.vue'
import LoadErrorPanel from '@/components/LoadErrorPanel.vue'
import FilterChip from '@/components/FilterChip.vue'
import PodcastViewHeader from '../components/PodcastViewHeader.vue'
import PodcastAddFeedSheet from '../components/PodcastAddFeedSheet.vue'
import PodcastEpisodeResultsPanel from '../components/PodcastEpisodeResultsPanel.vue'
import PodcastEpisodeEditSheet from '../components/PodcastEpisodeEditSheet.vue'
import PodcastEpisodeQuickView from '../components/PodcastEpisodeQuickView.vue'
import PodcastHealthPanel from '../components/PodcastHealthPanel.vue'
import PodcastImportSheet from '../components/PodcastImportSheet.vue'
import PodcastOpmlImportSheet from '../components/PodcastOpmlImportSheet.vue'
import PodcastPlaylistEditor from '../components/PodcastPlaylistEditor.vue'
import PodcastQueuePanel from '../components/PodcastQueuePanel.vue'
import PodcastShowsPanel from '../components/PodcastShowsPanel.vue'
import { usePodcastPlayer } from '../composables/usePodcastPlayer'
import { usePodcastEvents } from '../composables/usePodcastEvents'
import { usePodcastFailingFeedCount } from '../composables/usePodcastFailingFeedCount'
import { usePodcastImportProgress } from '../composables/usePodcastImportProgress'
import { usePodcastAnnouncer } from '../composables/usePodcastAnnouncer'
import { usePodcastLibraryAccess } from '../composables/usePodcastLibraryAccess'
import { usePodcastLibraryPage, isPodcastLibraryViewId, type PodcastLibraryViewId } from '../composables/usePodcastLibraryPage'
import { usePodcastQueueMaintenance } from '../composables/usePodcastQueueMaintenance'
import { usePodcastShowSelection } from '../composables/usePodcastShowSelection'
import { usePodcastBulkDelete } from '../composables/usePodcastBulkDelete'
import { useEpisodeQuickView } from '../composables/useEpisodeQuickView'
import { BUILT_IN_PLAYLIST_IDS, type PodcastPlaylistOption } from '../composables/usePodcastPlaylists'
import { PODCAST_EPISODE_FILTER_OPTIONS, PODCAST_EPISODE_SORT_OPTIONS } from '../lib/podcast-episode-filters'
import { formatPodcastDuration } from '../lib/podcast-format'

/** Shows are announced one at a time; reloading the list per announcement would be pure churn. */
const SHOW_RELOAD_DEBOUNCE_MS = 1_000
const EMPTY_EPISODE_MESSAGE_KEYS: Record<PodcastEpisodeFilter, string> = {
  latest: 'podcast.library.noEpisodesLatest',
  downloaded: 'podcast.library.noEpisodesDownloaded',
  in_progress: 'podcast.library.noEpisodesInProgress',
  unplayed: 'podcast.library.noEpisodesUnplayed',
  finished: 'podcast.library.noEpisodesFinished',
  pinned: 'podcast.library.noEpisodesPinned',
}
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const libraryId = computed(() => Number(route.params.id))
const { libraries } = useLibraries()
const library = computed(() => libraries.value.find((item) => item.id === libraryId.value))
const { hasPermission, isSuperuser } = usePermissions()
const { coverSize, gridGap } = useViewDisplaySettings('library', libraryId, ref('1/1'))
const page = usePodcastLibraryPage(libraryId)
const podcast = page.podcast
const playlistLibrary = page.playlists
const player = usePodcastPlayer()
const podcastEvents = usePodcastEvents()
const importProgress = usePodcastImportProgress()
const { importBarWidth } = importProgress
const { announce } = usePodcastAnnouncer()
const access = usePodcastLibraryAccess(library)
const queueMaintenance = usePodcastQueueMaintenance(podcast.loadQueue)
const episodeSheets = useEpisodeQuickView()
const showSelection = usePodcastShowSelection()
const bulkDelete = usePodcastBulkDelete(libraryId)

const addOpen = ref(false)
const importJobs = ref<PodcastJobStatus | null>(null)
const selectionMode = ref(false)
const playlistEditorOpen = ref(false)
const playlistDraft = ref<PodcastPlaylistOption | null>(null)
const playlistActionPending = ref<'play' | 'queue' | null>(null)
const savingPlaylist = ref(false)
const importOpen = ref(false)
const localImportOpen = ref(false)

const canManageFeeds = access.canManageFeeds
const canDownload = access.canDownload
const failingFeeds = usePodcastFailingFeedCount(libraryId, canManageFeeds)
/** The queue tab spans libraries, so editing is decided per episode rather than from the viewed library. */
const editableLibraryIds = computed(
  () => new Set(libraries.value.filter((item) => item.accessLevel === 'editor' || item.accessLevel === 'owner').map((item) => item.id)),
)
const canEditQuickViewEpisode = computed(() =>
  Boolean(episodeSheets.quickViewEpisode.value && canEditEpisodeMetadata(episodeSheets.quickViewEpisode.value)),
)
const canOpenLibrarySettings = computed(() => access.canManageRetention.value || access.canExport.value)

const showsGridStyle = computed(() => ({
  gap: `${gridGap.value}px`,
  gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${coverSize.value}px), 1fr))`,
}))
// Filter-specific messages rather than one interpolated noun: lowercasing a translated filter label
// breaks languages where case carries meaning.
const noEpisodesTitle = computed(() => t(EMPTY_EPISODE_MESSAGE_KEYS[page.episodeFilter.value]))
const hasSearchQuery = computed(() => page.searchQuery.value.trim().length > 0)
// The loaded health lane answers instantly once its tab has been opened; the server-side count is
// what makes the badge right everywhere else, since the lane is empty until then.
const hasUnhealthyFeeds = computed(() => failingFeeds.hasFailingFeeds.value || podcast.health.value.some((item) => item.consecutiveFailures > 0))
const hasEpisodeFiltersApplied = computed(() => page.episodeFilter.value !== 'latest' || page.followedOnly.value)
const hasFinishedQueueItems = computed(() => podcast.queue.value.some((item) => item.finished))
const canSelectQueue = computed(() => page.currentView.value === 'queue' && podcast.queue.value.length > 0)
/**
 * The shows tab only offers these once the library can act on them: deleting needs the purge gate,
 * and a Missing filter that could only ever answer with nothing is noise on a healthy library. The
 * filter stays offered while it is on, so the way back is never hidden by its own result.
 */
const hasMissingShows = computed(() => podcast.shows.value.some((show) => show.missingAt))
const canFilterMissing = computed(() => page.currentView.value === 'shows' && (hasMissingShows.value || page.missingOnly.value))
const canSelectShows = computed(() => page.currentView.value === 'shows' && access.canPurge.value && podcast.shows.value.length > 0)
const showContextRow = computed(
  () =>
    page.currentView.value === 'episodes' ||
    page.currentView.value === 'playlists' ||
    canSelectQueue.value ||
    canFilterMissing.value ||
    canSelectShows.value,
)
const searchPlaceholder = computed(() => {
  if (page.currentView.value === 'shows') return t('podcast.library.searchShows')
  if (page.currentView.value === 'health') return t('podcast.library.searchHealth')
  if (page.currentView.value === 'queue') return t('podcast.library.searchQueue')
  if (page.currentView.value === 'playlists') return t('podcast.playlists.search')
  return t('podcast.library.searchEpisodes')
})
const playlistSummary = computed(() =>
  t('podcast.playlists.summary', {
    count: formatNumber(podcast.totalEpisodes.value),
    duration: formatPodcastDuration(podcast.episodeDurationSeconds.value),
  }),
)
const playlistBusy = computed(() => playlistActionPending.value !== null)
const hasPlaylistMatches = computed(() => podcast.episodes.value.length > 0)

const views = computed<Array<{ id: PodcastLibraryViewId; label: string }>>(() => [
  { id: 'shows', label: t('podcast.library.shows') },
  { id: 'episodes', label: t('podcast.library.episodes') },
  { id: 'playlists', label: t('podcast.playlists.title') },
  { id: 'queue', label: t('podcast.views.queue') },
])
const episodeFilters = computed<Array<{ id: PodcastEpisodeFilter; label: string }>>(() =>
  PODCAST_EPISODE_FILTER_OPTIONS.map((option) => ({ id: option.id, label: t(option.labelKey) })),
)
const showSortOptions = computed<Array<{ id: PodcastSort; label: string }>>(() => [
  { id: 'title', label: t('podcast.sort.showTitle') },
  { id: 'recent', label: t('podcast.sort.showRecent') },
  { id: 'unplayed', label: t('podcast.sort.showUnplayed') },
])
const episodeSortOptions = computed<Array<{ id: PodcastEpisodeSort; label: string }>>(() =>
  PODCAST_EPISODE_SORT_OPTIONS.map((option) => ({ id: option.id, label: t(option.labelKey) })),
)
const sortable = computed(() => page.currentView.value === 'shows' || page.currentView.value === 'episodes')
const sortLabel = computed(() => (page.currentView.value === 'shows' ? t('podcast.sort.showLabel') : t('podcast.sort.episodeLabel')))
const sortOptions = computed<Array<{ id: string; label: string; active: boolean }>>(() =>
  page.currentView.value === 'shows'
    ? showSortOptions.value.map((option) => ({ ...option, active: option.id === page.showSort.value }))
    : episodeSortOptions.value.map((option) => ({ ...option, active: option.id === page.episodeSort.value })),
)
const activeSortLabel = computed(() => sortOptions.value.find((option) => option.active)?.label ?? '')
const activeSortId = computed(() => sortOptions.value.find((option) => option.active)?.id)
const isDefaultSort = computed(() => (page.currentView.value === 'shows' ? page.showSort.value === 'title' : page.episodeSort.value === 'newest'))

const { sentinel } = useInfiniteScrollSentinel({ loadMore: page.loadMoreCurrentView, hasMore: page.currentHasMore, loading: page.listBusy })

function handleSelectView(view: string) {
  if (isPodcastLibraryViewId(view)) void selectView(view)
}

async function selectView(view: PodcastLibraryViewId) {
  exitSelectionMode()
  await page.selectView(view)
}

function handleSortUpdate(id: unknown) {
  if (typeof id === 'string') void page.selectSort(id)
}

function resetSort() {
  if (isDefaultSort.value) return
  void page.resetSort()
}

async function selectHealthView() {
  await selectView('health')
}

function openPlaylistCreator() {
  playlistDraft.value = null
  playlistEditorOpen.value = true
}

function openPlaylistEditor() {
  playlistDraft.value = page.activePlaylist.value
  playlistEditorOpen.value = true
}

async function savePlaylist(payload: { id?: string; name: string; rules: PodcastPlaylistRules }) {
  savingPlaylist.value = true
  try {
    const wasActive = page.currentView.value === 'playlists' && page.activePlaylistId.value === payload.id
    const id = await playlistLibrary.savePlaylist(payload)
    playlistEditorOpen.value = false
    toast.success(t('podcast.messages.playlistSaved'))
    await page.selectPlaylist(id)
    // Selecting a different playlist reloads through the route watcher; editing the open one has to reload here.
    if (wasActive) await page.loadCurrentView()
  } catch (reason) {
    toast.error(errorMessage(reason, 'podcast.errors.savePlaylist'))
  } finally {
    savingPlaylist.value = false
  }
}

async function deletePlaylist(id: string) {
  savingPlaylist.value = true
  try {
    await playlistLibrary.deletePlaylist(id)
    playlistEditorOpen.value = false
    toast.success(t('podcast.messages.playlistDeleted'))
    await page.selectPlaylist(BUILT_IN_PLAYLIST_IDS[0])
  } catch (reason) {
    toast.error(errorMessage(reason, 'podcast.errors.deletePlaylist'))
  } finally {
    savingPlaylist.value = false
  }
}

/** Queues the playlist server-side in one bounded call, then optionally starts the first match in place. */
async function runPlaylistQueueAction(action: 'play' | 'queue') {
  const rules = page.activePlaylist.value?.rules
  if (!rules || playlistBusy.value) return
  playlistActionPending.value = action
  try {
    const result = await podcast.queuePlaylistEpisodes(rules)
    if (result.completed > 0) {
      const message = t('podcast.messages.playlistQueued', { completed: formatNumber(result.completed), skipped: formatNumber(result.skipped) })
      toast.success(message)
      void announce(message)
      await podcast.loadEpisodes()
    } else if (!result.firstEpisodeId) {
      toast.error(t('podcast.messages.playlistQueueEmpty'))
      return
    }
    if (action === 'play' && result.firstEpisodeId) await player.playInline(result.firstEpisodeId)
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : t('podcast.errors.queuePlaylist'))
  } finally {
    playlistActionPending.value = null
  }
}

async function playAllPlaylistEpisodes() {
  await runPlaylistQueueAction('play')
}

async function queueAllPlaylistEpisodes() {
  await runPlaylistQueueAction('queue')
}

function handleSearchQueryUpdate(value: string) {
  page.searchInput.value = value
}

async function browseShows() {
  await selectView('shows')
}

async function browseEpisodes() {
  await selectView('episodes')
}

function confirmQueueAction() {
  exitSelectionMode()
  queueMaintenance.confirm()
}

function toggleSelectionMode() {
  selectionMode.value = !selectionMode.value
}

function exitSelectionMode() {
  selectionMode.value = false
}

// A selection describes a list. Changing the tab, the filter or the search replaces that list, so
// carrying the old picks forward would let a later Delete act on shows nobody can see any more.
watch([page.currentView, page.missingOnly, page.searchQuery], () => {
  showSelection.setActive(false)
})

function toggleShowSelected(show: PodcastListItem) {
  showSelection.toggle(show.id)
}

function selectAllLoadedShows() {
  showSelection.selectAll(podcast.shows.value.map((show) => show.id))
}

async function requestBulkDelete() {
  await bulkDelete.prepare(showSelection.ids.value)
}

async function confirmBulkDelete() {
  const result = await bulkDelete.confirm(showSelection.ids.value)
  if (!result) return
  showSelection.setActive(false)
  announce(bulkDelete.resultMessage(result))
  // The purge runs as a job, so the rows go on answering until it lands. Reloading now is what makes
  // the list agree with the count the user was just shown.
  await podcast.loadShows()
}

function openAdd() {
  addOpen.value = true
}

function handleFeedAdded() {
  void podcast.loadShows()
}

function openFeedSheetShow(podcastId: number) {
  void router.push({ name: 'podcast-show', params: { podcastId } })
}

function openImport() {
  importOpen.value = true
}

/** The import answers with a queue count, not a job breakdown, so the banner starts from that. */
function handleOpmlImported(result: PodcastOpmlImportResult) {
  importJobs.value = { queued: result.queued, processing: 0, failed: 0 }
}

function openHealthShow(podcastId: number) {
  void router.push({ name: 'podcast-show', params: { podcastId } })
}

function openSettings() {
  void router.push({ name: 'settings-podcasts', query: { libraryId: String(libraryId.value) } })
}

function openShow(show: PodcastListItem) {
  void router.push({ name: 'podcast-show', params: { podcastId: show.id } })
}

async function playRecommendedEpisode(show: PodcastListItem) {
  const recommendation = show.playbackRecommendation
  if (!recommendation) return
  await player.playInline(recommendation.episodeId)
}

async function followShow(show: PodcastListItem) {
  try {
    await podcast.follow(show, 'off')
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : t('podcast.errors.follow'))
  }
}

async function unfollowShow(show: PodcastListItem) {
  try {
    await podcast.unfollow(show)
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : t('podcast.errors.unfollow'))
  }
}

function canEditEpisodeMetadata(episode: PodcastEpisodeListItem): boolean {
  return hasPermission(Permission.PodcastEditMetadata) && (isSuperuser.value || editableLibraryIds.value.has(episode.libraryId))
}

function handleEpisodeMetadataSaved(updated: PodcastEpisodeSummary) {
  podcast.applyEpisodeMetadata(updated)
}

// The queue lane keeps its own totals and rendered rows, so those two go through the composable
// that owns them rather than straight at the endpoint.
const episodeActions = usePodcastEpisodeListActions({
  onOpenDetails: episodeSheets.openDetails,
  onOpenMetadataEditor: episodeSheets.openMetadataEditor,
  addToQueue: podcast.addToQueue,
  removeFromQueue: podcast.removeFromQueue,
})
provide(PODCAST_EPISODE_ACTIONS, episodeActions)

void playlistLibrary.load()

podcastEvents.onImportProgress((event) => {
  // The local-file import reports on the same channel but has its own readout, so the OPML progress
  // row only counts OPML work.
  if (event.libraryId !== libraryId.value || event.kind !== 'opml') return
  importJobs.value = event
  if (event.queued + event.processing === 0 && page.currentView.value === 'shows') void podcast.loadShows()
})

const localImport = computed(() => (libraryId.value ? importProgress.getImport(libraryId.value) : null))
const isImportingLocal = computed(() => Boolean(libraryId.value) && importProgress.isImporting(libraryId.value))
const localImportLabel = computed(() => {
  const state = localImport.value
  if (!state) return ''
  if (!state.active) return t('podcast.library.localImportDone', { processed: formatNumber(state.processed) })
  return state.total === null
    ? t('podcast.library.localImportCounting')
    : t('podcast.library.localImportProgress', { processed: formatNumber(state.processed), total: formatNumber(state.total) })
})

// A show that has just been read appears straight away rather than after the whole run, so a folder
// of hundreds of files fills the grid while it is still being imported. Reloads are coalesced: the
// announcements arrive per show and a list refresh per show would be far more work than it is worth.
let showReloadTimer: ReturnType<typeof setTimeout> | null = null
importProgress.onShowDiscovered((event) => {
  if (event.libraryId !== libraryId.value || page.currentView.value !== 'shows') return
  if (showReloadTimer) return
  showReloadTimer = setTimeout(() => {
    showReloadTimer = null
    void podcast.loadShows()
  }, SHOW_RELOAD_DEBOUNCE_MS)
})

onScopeDispose(() => {
  if (showReloadTimer) clearTimeout(showReloadTimer)
})

function openLocalImport() {
  localImportOpen.value = true
}

function handleLocalImportChanged() {
  void podcast.loadShows()
}
</script>

<template>
  <div class="flex min-h-full flex-col">
    <PodcastViewHeader
      :title="library?.name || t('titles.podcasts')"
      :icon="library?.icon ?? 'Radio'"
      :total="page.total.value"
      :views="views"
      :current-view="page.currentView.value"
      :views-label="t('podcast.library.views')"
      :search-query="page.searchInput.value"
      :search-placeholder="searchPlaceholder"
      :refreshing="page.isRefreshing.value"
      :sortable="sortable"
      :sort-label="sortLabel"
      :sort-options="sortOptions"
      :active-sort-id="activeSortId"
      :active-sort-label="activeSortLabel"
      :is-default-sort="isDefaultSort"
      :can-manage-feeds="canManageFeeds"
      :can-open-settings="canOpenLibrarySettings"
      :has-unhealthy-feeds="hasUnhealthyFeeds"
      :health-active="page.currentView.value === 'health'"
      :show-display-controls="page.currentView.value === 'shows'"
      v-model:coverSize="coverSize"
      v-model:gridGap="gridGap"
      :show-context="showContextRow"
      @update:search-query="handleSearchQueryUpdate"
      @update:sort="handleSortUpdate"
      @reset-sort="resetSort"
      @select-view="handleSelectView"
      @select-health="selectHealthView"
      @add-feed="openAdd"
      @open-settings="openSettings"
    >
      <template #context>
        <div v-if="page.currentView.value === 'queue'" class="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            class="gap-1.5"
            :class="selectionMode ? 'border-primary bg-primary/10 text-primary' : ''"
            :aria-pressed="selectionMode"
            @click="toggleSelectionMode"
          >
            <CheckSquare v-if="selectionMode" :size="14" />
            <Square v-else :size="14" />
            {{ t('components.viewHeader.select') }}
          </Button>
          <Button
            v-if="hasFinishedQueueItems"
            variant="outline"
            size="sm"
            :disabled="queueMaintenance.clearingFinished.value"
            @click="queueMaintenance.requestClearFinished"
          >
            {{ t('podcast.actions.clearPlayed') }}
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            :disabled="queueMaintenance.clearingAll.value"
            @click="queueMaintenance.requestClearAll"
          >
            <Trash2 :size="14" /> {{ t('podcast.actions.clearQueue') }}
          </Button>
        </div>

        <div v-if="canFilterMissing || canSelectShows" class="flex flex-wrap items-center gap-2">
          <Button
            v-if="canFilterMissing"
            variant="outline"
            size="sm"
            class="gap-1.5"
            :class="page.missingOnly.value ? 'border-destructive bg-destructive/10 text-destructive' : ''"
            :aria-pressed="page.missingOnly.value"
            :title="t('podcast.status.missingDescription')"
            @click="page.toggleMissingOnly"
          >
            <FolderX :size="14" /> {{ t('podcast.status.missing') }}
          </Button>
          <Button
            v-if="canSelectShows"
            variant="outline"
            size="sm"
            class="gap-1.5"
            :class="showSelection.active.value ? 'border-primary bg-primary/10 text-primary' : ''"
            :aria-pressed="showSelection.active.value"
            @click="showSelection.toggleActive"
          >
            <CheckSquare v-if="showSelection.active.value" :size="14" />
            <Square v-else :size="14" />
            {{ t('components.viewHeader.select') }}
          </Button>
          <template v-if="showSelection.active.value">
            <span class="text-sm text-muted-foreground" role="status">
              {{ t('podcast.selection.count', { count: showSelection.count.value }) }}
            </span>
            <Button variant="outline" size="sm" @click="selectAllLoadedShows">{{ t('podcast.selection.selectAll') }}</Button>
            <Button
              variant="outline"
              size="sm"
              class="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              :disabled="!showSelection.hasSelection.value || bulkDelete.preparing.value"
              @click="requestBulkDelete"
            >
              <Trash2 :size="14" /> {{ t('podcast.bulkDelete.action') }}
            </Button>
          </template>
        </div>

        <ChipGroup v-if="page.currentView.value === 'episodes'" :label="t('podcast.library.episodeFilters')">
          <FilterChip
            v-for="filter in episodeFilters"
            :key="filter.id"
            :active="page.episodeFilter.value === filter.id"
            @select="page.selectEpisodeFilter(filter.id)"
          >
            {{ filter.label }}
          </FilterChip>
          <span class="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
          <FilterChip :active="page.followedOnly.value" @select="page.toggleFollowedOnly">
            {{ t('podcast.library.followedOnly') }}
          </FilterChip>
        </ChipGroup>

        <div v-if="page.currentView.value === 'playlists'" class="flex flex-wrap items-center gap-2">
          <ChipGroup :label="t('podcast.playlists.choose')" wrap class="flex-1">
            <FilterChip
              v-for="playlist in playlistLibrary.playlists.value"
              :key="playlist.id"
              :active="page.activePlaylistId.value === playlist.id"
              @select="page.selectPlaylist(playlist.id)"
            >
              {{ playlist.name }}
            </FilterChip>
            <button
              type="button"
              class="flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              :aria-label="t('podcast.playlists.create')"
              @click="openPlaylistCreator"
            >
              <Plus :size="13" />
            </button>
          </ChipGroup>

          <span class="shrink-0 text-xs tabular-nums text-muted-foreground" data-testid="podcast-playlist-summary">{{ playlistSummary }}</span>
          <span v-if="playlistLibrary.error.value" class="shrink-0 text-xs text-destructive" role="alert">{{
            t('podcast.errors.loadPlaylists')
          }}</span>

          <div class="ms-auto flex flex-wrap items-center gap-1.5" :aria-busy="playlistBusy">
            <Button variant="outline" size="sm" class="gap-1.5" :disabled="playlistBusy || !hasPlaylistMatches" @click="playAllPlaylistEpisodes">
              <Play :size="13" /> {{ t('podcast.actions.playAll') }}
            </Button>
            <Button variant="outline" size="sm" class="gap-1.5" :disabled="playlistBusy || !hasPlaylistMatches" @click="queueAllPlaylistEpisodes">
              <ListPlus :size="13" /> {{ t('podcast.actions.queueAll') }}
            </Button>
            <Button variant="ghost" size="sm" class="gap-1.5 text-foreground hover:text-foreground" @click="openPlaylistEditor">
              <SlidersHorizontal :size="13" />
              {{ page.activePlaylist.value && !page.activePlaylist.value.builtIn ? t('podcast.playlists.edit') : t('podcast.playlists.saveAs') }}
            </Button>
          </div>
        </div>
      </template>
    </PodcastViewHeader>

    <main class="flex-1 pb-10">
      <div v-if="localImport" class="mt-3 rounded-xl border border-border bg-card px-4 py-3" role="status" aria-live="polite">
        <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span class="text-sm font-medium text-foreground">
            {{ localImport.active ? t('podcast.library.localImportTitle') : t('podcast.library.localImportDoneTitle') }}
          </span>
          <span class="text-xs tabular-nums text-muted-foreground">{{ localImportLabel }}</span>
        </div>
        <div class="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div class="h-full rounded-full bg-primary transition-[width] duration-300" :style="{ width: importBarWidth(libraryId) }" />
        </div>
        <p v-if="localImport.failed" class="mt-2 text-xs text-destructive">
          {{ t('podcast.library.jobsFailed', { count: localImport.failed }) }}
        </p>
      </div>

      <div
        v-if="importJobs && (importJobs.queued || importJobs.processing || importJobs.failed)"
        class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-card px-4 py-3 text-xs"
        role="status"
        aria-live="polite"
      >
        <span class="font-medium">{{ t('podcast.library.importProgress') }}</span>
        <span class="text-muted-foreground">{{ t('podcast.library.jobsQueued', { count: importJobs.queued }) }}</span>
        <span class="text-info">{{ t('podcast.library.jobsProcessing', { count: importJobs.processing }) }}</span>
        <span v-if="importJobs.failed" class="text-destructive">{{ t('podcast.library.jobsFailed', { count: importJobs.failed }) }}</span>
      </div>

      <p
        v-if="page.showRefreshError.value"
        class="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        role="alert"
      >
        {{ page.error.value }}
      </p>

      <LoadErrorPanel v-if="page.showInitialError.value" :message="page.error.value ?? ''" class="mt-4" @retry="page.retryCurrentView" />

      <div v-else-if="page.showInitialSkeleton.value" data-testid="podcast-initial-loading" class="pt-4">
        <div v-if="page.renderedView.value === 'shows'" class="grid" :style="showsGridStyle" role="status" aria-live="polite">
          <span class="sr-only">{{ t('podcast.library.loading') }}</span>
          <div v-for="index in 12" :key="index" class="overflow-hidden rounded-xl border border-border bg-card">
            <Skeleton class="aspect-square w-full rounded-none" />
            <div class="grid grid-rows-[2rem_1.25rem_1.25rem] gap-y-0.5 p-2.5">
              <Skeleton class="h-3.5 w-full" />
              <Skeleton class="h-3 w-2/3" />
              <Skeleton class="h-3 w-4/5" />
            </div>
          </div>
        </div>
        <ListSkeleton v-else :label="t('podcast.library.loading')" />
      </div>

      <PodcastShowsPanel
        v-else-if="page.renderedView.value === 'shows'"
        :shows="podcast.shows.value"
        :grid-style="showsGridStyle"
        :refreshing="page.isRefreshing.value"
        :importing="isImportingLocal"
        :has-search-query="hasSearchQuery"
        :can-manage-feeds="canManageFeeds"
        :selecting="showSelection.active.value"
        :selected-ids="showSelection.selectedIds.value"
        @open="openShow"
        @play="playRecommendedEpisode"
        @follow="followShow"
        @unfollow="unfollowShow"
        @toggle-select="toggleShowSelected"
        @clear-search="page.clearSearch"
        @add-feed="openAdd"
        @import-opml="openImport"
      />

      <PodcastQueuePanel
        v-else-if="page.renderedView.value === 'queue'"
        v-model:selection-mode="selectionMode"
        :items="podcast.queue.value"
        :total="podcast.totalQueue.value"
        :duration-seconds="podcast.queueDurationSeconds.value"
        :refreshing="page.isRefreshing.value"
        :has-search-query="hasSearchQuery"
        :can-download="canDownload"
        :active-episode-id="player.episode.value?.id ?? null"
        :is-playing="player.isPlaying.value"
        :download-progress="podcast.downloadProgress.value"
        :remove-from-queue="podcast.removeFromQueue"
        :reload="podcast.loadQueue"
        @clear-search="page.clearSearch"
        @browse-episodes="browseEpisodes"
        @browse-shows="browseShows"
      />

      <PodcastHealthPanel
        v-else-if="page.renderedView.value === 'health'"
        :items="podcast.health.value"
        :refreshing="page.isRefreshing.value"
        @open-show="openHealthShow"
      />

      <PodcastEpisodeResultsPanel
        v-else
        :mode="page.renderedView.value === 'playlists' ? 'playlists' : 'episodes'"
        :episodes="podcast.episodes.value"
        :refreshing="page.isRefreshing.value"
        :can-download="canDownload"
        :can-manage-feeds="canManageFeeds"
        :has-search-query="hasSearchQuery"
        :has-filters-applied="hasEpisodeFiltersApplied"
        :current-filter="page.episodeFilter.value"
        :empty-title="noEpisodesTitle"
        :active-episode-id="player.episode.value?.id ?? null"
        :is-playing="player.isPlaying.value"
        :download-progress="podcast.downloadProgress.value"
        :can-edit-metadata="canEditEpisodeMetadata"
        @clear-search="page.clearSearch"
        @edit-playlist="openPlaylistEditor"
        @browse-episodes="browseEpisodes"
        @reset-filters="page.resetEpisodeFilters"
        @browse-shows="browseShows"
        @add-feed="openAdd"
      />

      <div ref="sentinel">
        <ListEndFooter
          :loading-more="page.loadingMore.value"
          :at-end="page.renderedViewInitialized.value && !page.renderedHasMore.value && page.loadedCount.value > 0"
          :total="page.total.value"
        />
      </div>
    </main>

    <PodcastAddFeedSheet
      v-if="canManageFeeds"
      v-model:open="addOpen"
      :library-id="libraryId"
      @added="handleFeedAdded"
      @open-show="openFeedSheetShow"
      @import-opml="openImport"
      @import-local="openLocalImport"
    />

    <PodcastOpmlImportSheet v-if="canManageFeeds" v-model:open="importOpen" :library-id="libraryId" @imported="handleOpmlImported" />

    <PodcastImportSheet
      v-if="canManageFeeds"
      v-model:open="localImportOpen"
      :library-id="libraryId"
      @subscribed="handleLocalImportChanged"
      @applied="handleLocalImportChanged"
    />

    <PodcastPlaylistEditor
      v-model:open="playlistEditorOpen"
      :library-id="libraryId"
      :playlist="playlistDraft"
      :saving="savingPlaylist"
      @save="savePlaylist"
      @delete="deletePlaylist"
    />

    <PodcastEpisodeQuickView
      :open="episodeSheets.quickViewOpen.value"
      :episode="episodeSheets.quickViewEpisode.value"
      :can-download="canDownload"
      :can-edit-metadata="canEditQuickViewEpisode"
      :is-active="player.episode.value?.id === episodeSheets.quickViewEpisode.value?.id"
      :is-playing="player.isPlaying.value && player.episode.value?.id === episodeSheets.quickViewEpisode.value?.id"
      @update:open="episodeSheets.setQuickViewOpen"
    />

    <PodcastEpisodeEditSheet
      v-if="episodeSheets.editEpisodeId.value !== null"
      :open="episodeSheets.editEpisodeOpen.value"
      :episode-id="episodeSheets.editEpisodeId.value"
      @update:open="episodeSheets.setEditOpen"
      @saved="handleEpisodeMetadataSaved"
    />

    <ConfirmDialog
      :open="queueMaintenance.pending.value !== null"
      :title="queueMaintenance.confirmation.value.title"
      :description="queueMaintenance.confirmation.value.description"
      :confirm-label="queueMaintenance.confirmation.value.confirmLabel"
      :busy="queueMaintenance.confirmation.value.busy"
      @confirm="confirmQueueAction"
      @cancel="queueMaintenance.cancel"
    />

    <ConfirmDialog
      :open="bulkDelete.open.value"
      :title="t('podcast.bulkDelete.title')"
      :description="bulkDelete.description.value"
      :confirm-label="t('podcast.bulkDelete.action')"
      :confirmation-phrase="bulkDelete.needsTypedConfirmation.value ? t('podcast.bulkDelete.confirmPhrase') : undefined"
      :busy="bulkDelete.deleting.value"
      destructive
      @confirm="confirmBulkDelete"
      @cancel="bulkDelete.close"
    />
  </div>
</template>
