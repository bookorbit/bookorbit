<script setup lang="ts">
import { computed, provide, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  ArrowUpDown,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  HardDrive,
  ListPlus,
  MoreHorizontal,
  Pencil,
  Play,
  Radio,
  RefreshCw,
  Search,
  Settings,
  FolderOpen,
  ShieldAlert,
  Trash2,
  X,
} from '@lucide/vue'
import DOMPurify from 'dompurify'
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { formatDate, formatDateTime, formatLanguageName, formatNumber, formatRelativeTimeFromNow } from '@/i18n/formatters'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import ChipGroup from '@/components/ChipGroup.vue'
import FilterChip from '@/components/FilterChip.vue'
import ListEndFooter from '@/components/ListEndFooter.vue'
import ListSkeleton from '@/components/ListSkeleton.vue'
import LoadErrorPanel from '@/components/LoadErrorPanel.vue'
import PodcastArtwork from '../components/PodcastArtwork.vue'
import PodcastEditDetailsSheet from '../components/PodcastEditDetailsSheet.vue'
import PodcastEpisodeEditSheet from '../components/PodcastEpisodeEditSheet.vue'
import PodcastEpisodeQuickView from '../components/PodcastEpisodeQuickView.vue'
import PodcastEpisodeRow from '../components/PodcastEpisodeRow.vue'
import PodcastShowManageSheet from '../components/PodcastShowManageSheet.vue'
import AddShowToCollectionSheet from '../components/AddShowToCollectionSheet.vue'
import PodcastShowSettingsSheet from '../components/PodcastShowSettingsSheet.vue'
import { PODCAST_EPISODE_FILTER_OPTIONS, PODCAST_EPISODE_SORT_OPTIONS } from '../lib/podcast-episode-filters'
import { usePodcastPlayer } from '../composables/usePodcastPlayer'
import { usePodcastLibraryAccess } from '../composables/usePodcastLibraryAccess'
import { useEpisodeQuickView } from '../composables/useEpisodeQuickView'
import { usePodcastShowPage } from '../composables/usePodcastShowPage'
import { usePodcastShowManagement } from '../composables/usePodcastShowManagement'
import { PODCAST_EPISODE_ACTIONS, usePodcastEpisodeListActions } from '../composables/usePodcastEpisodeListActions'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const podcastId = computed(() => Number(route.params.podcastId))
const { libraries, fetchLibraries } = useLibraries()
const player = usePodcastPlayer()
const page = usePodcastShowPage(podcastId, fetchLibraries)
const {
  show,
  episodes,
  totalEpisodes,
  loading,
  loadingMore,
  loadError,
  refreshResult,
  episodeSearch,
  episodeFilter,
  episodeSort,
  publishedFrom,
  publishedTo,
  hasDateRange,
  hasMoreEpisodes,
  episodeScrollerItems,
  sentinel,
  downloadProgress,
  load,
  applyEpisodeFilters,
  selectEpisodeFilter,
  selectEpisodeSort,
  clearDateRange,
  clearEpisodeSearch,
  applyEpisodeMetadata,
  retryLoad,
} = page
const management = usePodcastShowManagement(podcastId, show, () => load(), goBack)

const addToCollectionOpen = ref(false)

function openAddToCollection() {
  addToCollectionOpen.value = true
}

function setAddToCollectionOpen(open: boolean) {
  addToCollectionOpen.value = open
}
const {
  settingsOpen,
  editDetailsOpen,
  notificationMode,
  bulkAction,
  bulkPending,
  requestPending,
  confirmRemoveDownloads,
  downloadLatestOptions,
  queueAllEpisodes,
  runPrimaryAction,
  markAllEpisodesPlayed,
  downloadLatestEpisodesByCount,
  requestRemoveAllDownloads,
  cancelRemoveAllDownloads,
  removeAllDownloads,
  follow,
  unfollow,
  handleNotificationModeUpdate,
  refresh,
  openSettings,
  openEditDetails,
  handleEditDetailsOpenChange,
  applyMetadataUpdate,
  applyArtworkUpdate,
  openManage,
  saveSettings,
} = management
const descriptionExpanded = ref(false)
const episodeSheets = useEpisodeQuickView()

const showLibrary = computed(() => libraries.value.find((library) => library.id === show.value?.libraryId))
const { canManageFeeds: canManage, canEditMetadata, canDownload, canPurge } = usePodcastLibraryAccess(showLibrary)
/**
 * A local show has no feed behind it, so everything that talks to one is meaningless for it:
 * refreshing, the refresh cadence, feed health, and the acquisition policy. The server refuses all
 * of them too; hiding them here is so the user is never offered an action that cannot work.
 */
const isLocalShow = computed(() => show.value?.origin === 'local')
/** A replacement can keep the same URL, so a load failure is cleared by version rather than by src. */
const artworkVersion = computed(() => `${show.value?.id ?? 0}:${show.value?.artworkUpdatedAt ?? ''}`)
const canManageFeed = computed(() => canManage.value && !isLocalShow.value)
const sanitizedDescription = computed(() => DOMPurify.sanitize(show.value?.description ?? ''))
const websiteUrl = computed(() => {
  if (!show.value?.siteUrl) return null
  try {
    const parsed = new URL(show.value.siteUrl)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? show.value.siteUrl : null
  } catch {
    return null
  }
})
const backLabel = computed(() => (showLibrary.value ? t('podcast.show.backToLibrary', { library: showLibrary.value.name }) : t('podcast.show.back')))
const visibleCategories = computed(() => show.value?.categories.slice(0, 3) ?? [])
const hiddenCategories = computed(() => show.value?.categories.slice(3) ?? [])
const languageLabel = computed(() => show.value?.language?.trim().toUpperCase() ?? '')
const languageTitle = computed(() => {
  const language = show.value?.language?.trim()
  return language ? formatLanguageName(language) : ''
})
const hasShowMetadata = computed(
  () => visibleCategories.value.length > 0 || Boolean(languageLabel.value) || show.value?.podcastType === 'serial' || show.value?.explicit,
)
const freshnessLabel = computed(() => {
  if (!show.value?.lastRefreshSuccessAt || isLocalShow.value) return ''
  return t('podcast.show.updatedAgo', { time: formatRelativeTimeFromNow(show.value.lastRefreshSuccessAt) })
})
const refreshCadenceLabel = computed(() => {
  if (!show.value || isLocalShow.value) return ''
  const minutes = show.value.refreshIntervalMinutes
  const time =
    minutes % 1440 === 0
      ? t('podcast.show.daysShort', { count: formatNumber(minutes / 1440) })
      : minutes % 60 === 0
        ? t('podcast.show.hoursShort', { count: formatNumber(minutes / 60) })
        : t('podcast.show.minutesShort', { count: formatNumber(minutes) })
  return t('podcast.show.checksEvery', { time })
})
const primaryActionLabel = computed(() => {
  const recommendation = show.value?.playbackRecommendation
  if (!recommendation) return t('podcast.actions.playAll')
  return recommendation.kind === 'resume' ? t('podcast.actions.resumeNamed', { title: recommendation.title }) : t('podcast.actions.playLatest')
})
const primaryActionShortLabel = computed(() => {
  const recommendation = show.value?.playbackRecommendation
  if (!recommendation) return t('podcast.actions.playAll')
  return recommendation.kind === 'resume' ? t('podcast.actions.resume') : t('podcast.actions.playLatest')
})
const episodeFilters = computed(() =>
  PODCAST_EPISODE_FILTER_OPTIONS.map((option) => ({
    id: option.id,
    label: t(option.labelKey),
  })),
)
const episodeSortOptions = computed(() => PODCAST_EPISODE_SORT_OPTIONS.map((option) => ({ id: option.id, label: t(option.labelKey) })))
const activeSortLabel = computed(() => episodeSortOptions.value.find((option) => option.id === episodeSort.value)?.label ?? '')
const dateRangeLabel = computed(() => {
  if (!hasDateRange.value) return t('podcast.show.dates')
  const from = publishedFrom.value ? formatShortDate(publishedFrom.value) : t('podcast.show.anyDate')
  const to = publishedTo.value ? formatShortDate(publishedTo.value) : t('podcast.show.anyDate')
  return t('podcast.show.dateRange', { from, to })
})
const feedFailingDetail = computed(() =>
  t('podcast.show.feedFailingDetail', {
    count: show.value?.consecutiveFailures ?? 0,
    lastSuccess: show.value?.lastRefreshSuccessAt ? formatDateTime(new Date(show.value.lastRefreshSuccessAt)) : t('podcast.acquisition.never'),
  }),
)

function formatShortDate(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : formatDate(date, { month: 'short', day: 'numeric' })
}

function goBack() {
  if (show.value) void router.push({ name: 'podcast-library', params: { id: show.value.libraryId } })
  else void router.back()
}

const episodeActions = usePodcastEpisodeListActions({
  onOpenDetails: episodeSheets.openDetails,
  onOpenMetadataEditor: episodeSheets.openMetadataEditor,
})
provide(PODCAST_EPISODE_ACTIONS, episodeActions)

function toggleDescription() {
  descriptionExpanded.value = !descriptionExpanded.value
}
</script>
<template>
  <main class="mx-auto min-h-full w-full max-w-7xl pb-12">
    <div v-if="loading" class="pt-4" role="status" aria-live="polite">
      <span class="sr-only">{{ t('podcast.show.loading') }}</span>
      <div class="grid items-start gap-4 border-b border-border/70 pb-5 sm:grid-cols-[10rem_minmax(0,1fr)] lg:grid-cols-[12rem_minmax(0,1fr)]">
        <Skeleton class="aspect-square w-full max-w-36 rounded-xl max-sm:mx-auto sm:max-w-40 lg:max-w-48" />
        <div class="min-w-0 space-y-3">
          <Skeleton class="h-3 w-28" />
          <Skeleton class="h-7 w-2/3" />
          <Skeleton class="h-3 w-40" />
          <div class="flex flex-wrap gap-1.5 pt-1">
            <Skeleton class="h-9 w-24 rounded-lg" />
            <Skeleton class="h-9 w-32 rounded-lg" />
            <Skeleton class="h-9 w-9 rounded-lg" />
          </div>
          <Skeleton class="h-8 w-full max-w-3xl" />
        </div>
      </div>
      <ListSkeleton class="mt-6" />
    </div>
    <LoadErrorPanel v-else-if="loadError" :message="loadError" class="mt-6" @retry="retryLoad" />
    <template v-else-if="show">
      <header class="pt-4">
        <Button variant="ghost" size="sm" class="-ml-2 gap-1 text-muted-foreground hover:text-foreground" @click="goBack">
          <ArrowLeft :size="14" /> {{ backLabel }}
        </Button>
        <section class="mt-2 border-b border-border/70 pb-5">
          <div class="grid items-start gap-4 sm:grid-cols-[10rem_minmax(0,1fr)] lg:grid-cols-[12rem_minmax(0,1fr)]">
            <div
              class="aspect-square w-full max-w-36 overflow-hidden rounded-xl bg-muted shadow-[var(--elevation-xs)] max-sm:mx-auto sm:max-w-40 lg:max-w-48"
            >
              <PodcastArtwork :src="show.imageUrl" :reset-key="artworkVersion" class="h-full w-full" icon-class="h-8 w-8" />
            </div>
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <p class="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{{ t('titles.podcast') }}</p>
                <Badge variant="outline" class="border-transparent bg-primary/10 text-[10px] tabular-nums text-primary">
                  {{ t('podcast.labels.episodeCount', { count: formatNumber(totalEpisodes) }) }}
                </Badge>
                <Badge v-if="show.unplayedCount > 0" variant="outline" class="border-primary/20 bg-primary/10 text-[10px] tabular-nums text-primary">
                  {{ t('podcast.labels.unplayedShort', { count: formatNumber(show.unplayedCount) }) }}
                </Badge>
                <Badge
                  v-if="isLocalShow"
                  variant="secondary"
                  class="text-[10px]"
                  :title="t('podcast.status.localShowDescription')"
                  data-testid="podcast-local-origin-badge"
                >
                  <HardDrive class="mr-1 size-3" /> {{ t('podcast.status.localShow') }}
                </Badge>
              </div>
              <h1 class="mt-1 text-balance font-serif text-xl font-semibold leading-tight tracking-tight sm:text-2xl">{{ show.title }}</h1>
              <p class="mt-1 text-xs text-muted-foreground">{{ show.author || t('podcast.labels.unknownPublisher') }}</p>
              <div v-if="hasShowMetadata" class="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span v-for="category in visibleCategories" :key="category" class="rounded-full border border-border bg-muted/40 px-2 py-0.5">
                  {{ category }}
                </span>
                <Popover v-if="hiddenCategories.length">
                  <PopoverTrigger as-child>
                    <button
                      class="rounded-full border border-border bg-muted/40 px-2 py-0.5 transition-colors hover:bg-muted outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                      :aria-label="t('podcast.show.moreCategories', { count: hiddenCategories.length })"
                    >
                      {{ t('podcast.show.categoryOverflow', { count: hiddenCategories.length }) }}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" class="w-64 p-3">
                    <p class="text-xs font-medium text-muted-foreground">{{ t('podcast.show.allCategories') }}</p>
                    <div class="mt-2 flex flex-wrap gap-1.5">
                      <span
                        v-for="category in show.categories"
                        :key="category"
                        class="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs"
                      >
                        {{ category }}
                      </span>
                    </div>
                  </PopoverContent>
                </Popover>
                <span v-if="languageLabel" class="rounded-full border border-border bg-muted/40 px-2 py-0.5" :title="languageTitle">
                  {{ languageLabel }}
                </span>
                <span v-if="show.podcastType === 'serial'" class="rounded-full border border-border bg-muted/40 px-2 py-0.5">
                  {{ t('podcast.show.serial') }}
                </span>
                <span
                  v-if="show.explicit"
                  class="rounded-full border border-border bg-muted/40 px-2 py-0.5 font-semibold"
                  :aria-label="t('podcast.labels.explicit')"
                  :title="t('podcast.labels.explicit')"
                >
                  E
                </span>
              </div>
              <div class="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span v-if="freshnessLabel">{{ freshnessLabel }}</span>
                <span v-if="freshnessLabel" aria-hidden="true">·</span>
                <span>{{ refreshCadenceLabel }}</span>
                <Button v-if="websiteUrl" as-child variant="ghost" size="icon-sm" class="text-muted-foreground hover:text-foreground">
                  <a
                    :href="websiteUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    :aria-label="t('podcast.show.visitWebsite')"
                    :title="t('podcast.show.visitWebsite')"
                  >
                    <ExternalLink :size="14" />
                  </a>
                </Button>
              </div>
              <div class="mt-3 flex flex-wrap items-center gap-1.5" :aria-busy="bulkPending || requestPending" data-testid="podcast-hero-actions">
                <Button
                  size="sm"
                  class="min-w-0 max-w-full shadow-none"
                  :title="primaryActionLabel"
                  :disabled="bulkPending || totalEpisodes === 0"
                  @click="runPrimaryAction"
                >
                  <Play class="size-3.5 shrink-0" />
                  <span class="sm:hidden">{{ primaryActionShortLabel }}</span>
                  <span class="hidden max-w-72 truncate sm:inline">{{ primaryActionLabel }}</span>
                </Button>
                <DropdownMenu v-if="show.followed">
                  <DropdownMenuTrigger as-child>
                    <Button
                      variant="outline"
                      size="sm"
                      class="border-success/30 bg-success/10 text-success shadow-none hover:bg-success/15 hover:text-success"
                      :disabled="requestPending"
                    >
                      <Bell class="size-3.5 fill-current" /> {{ t('podcast.status.following') }} <ChevronDown class="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" class="w-56">
                    <DropdownMenuLabel>{{ t('podcast.show.notificationMode') }}</DropdownMenuLabel>
                    <DropdownMenuRadioGroup :model-value="notificationMode" @update:model-value="handleNotificationModeUpdate">
                      <DropdownMenuRadioItem value="off">{{ t('podcast.show.noAlerts') }}</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="immediate">{{ t('podcast.show.immediate') }}</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="daily">{{ t('podcast.show.dailyDigest') }}</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="weekly">{{ t('podcast.show.weeklyDigest') }}</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" @click="unfollow">
                      {{ t('podcast.actions.unfollow') }}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button v-else variant="outline" size="sm" class="shadow-none" :disabled="requestPending" @click="follow">
                  <Bell class="size-3.5" /> {{ t('podcast.actions.follow') }}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  class="shadow-none"
                  :aria-label="t('podcast.actions.queueAll')"
                  :disabled="bulkPending || totalEpisodes === 0"
                  @click="queueAllEpisodes"
                >
                  <ListPlus class="size-3.5" />
                  <span class="hidden sm:inline">{{ t('podcast.actions.queueAll') }}</span>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      class="text-muted-foreground shadow-none hover:text-foreground"
                      :aria-label="t('podcast.show.moreActions')"
                      :title="t('podcast.show.moreActions')"
                    >
                      <MoreHorizontal :size="14" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" class="w-56">
                    <DropdownMenuItem v-if="canManageFeed && !show.archivedAt" :disabled="requestPending" @click="refresh">
                      <RefreshCw :size="14" /> {{ t('podcast.show.refreshFeed') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      data-testid="podcast-mark-all-played"
                      :disabled="bulkPending || totalEpisodes === 0"
                      @click="markAllEpisodesPlayed"
                    >
                      <Check :size="14" /> {{ t('podcast.actions.markAllPlayed') }}
                    </DropdownMenuItem>
                    <DropdownMenuSub v-if="canDownload && !isLocalShow">
                      <DropdownMenuSubTrigger data-testid="podcast-download-latest" :disabled="bulkPending || totalEpisodes === 0">
                        <Download :size="14" /> {{ t('podcast.actions.downloadLatest') }}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem
                          v-for="count in downloadLatestOptions"
                          :key="count"
                          :data-testid="`podcast-download-latest-${count}`"
                          @click="downloadLatestEpisodesByCount(count)"
                        >
                          {{ t('podcast.actions.latestCount', { count }) }}
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuItem
                      v-if="canDownload && !isLocalShow"
                      data-testid="podcast-remove-all-downloads"
                      variant="destructive"
                      :disabled="bulkPending"
                      @click="requestRemoveAllDownloads"
                    >
                      <Trash2 :size="14" /> {{ t('podcast.actions.removeAllDownloads') }}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem data-testid="podcast-add-to-collection" @click="openAddToCollection">
                      <FolderOpen :size="14" /> {{ t('podcast.collections.addAction') }}
                    </DropdownMenuItem>
                    <template v-if="canEditMetadata || canManage">
                      <DropdownMenuSeparator />
                      <DropdownMenuItem v-if="canEditMetadata" data-testid="podcast-open-edit-details" @click="openEditDetails">
                        <Pencil :size="14" /> {{ t('podcast.edit.title') }}
                      </DropdownMenuItem>
                      <DropdownMenuItem v-if="canManage" data-testid="podcast-open-settings" @click="openSettings">
                        <Settings :size="14" /> {{ t('podcast.library.settings') }}
                      </DropdownMenuItem>
                      <DropdownMenuItem v-if="canManage" variant="destructive" @click="openManage">
                        <ShieldAlert :size="14" /> {{ t('podcast.show.manageTitle') }}
                      </DropdownMenuItem>
                    </template>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <p
                v-if="refreshResult"
                class="mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs"
                :class="
                  refreshResult.error ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-success/30 bg-success/5 text-success'
                "
                role="status"
              >
                {{
                  refreshResult.error
                    ? t('podcast.show.refreshFailed', { error: refreshResult.error })
                    : t('podcast.show.refreshCompleted', { count: refreshResult.newEpisodes })
                }}
              </p>
              <div v-if="sanitizedDescription" class="mt-2.5 max-w-5xl">
                <div class="relative">
                  <div
                    id="podcast-show-description"
                    class="prose max-w-none text-muted-foreground [&_p]:my-0 [&_p]:text-sm [&_p]:leading-5 [&_p+p]:mt-1"
                    :class="{
                      'line-clamp-2 [mask-image:linear-gradient(to_bottom,black_55%,transparent_100%)]': !descriptionExpanded,
                    }"
                    v-html="sanitizedDescription"
                  />
                </div>
                <button
                  class="relative -ml-2 mt-0.5 inline-flex h-7 items-center rounded-sm px-2 text-[11px] font-medium text-primary hover:underline outline-none before:absolute before:inset-x-0 before:-inset-y-2 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                  :aria-expanded="descriptionExpanded"
                  aria-controls="podcast-show-description"
                  @click="toggleDescription"
                >
                  {{ descriptionExpanded ? t('podcast.fullPlayer.showLess') : t('podcast.show.readMore') }}
                </button>
              </div>
            </div>
          </div>
        </section>
      </header>

      <div
        v-if="show.archivedAt"
        class="mt-4 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4"
        data-testid="podcast-archived-banner"
      >
        <Archive class="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <div class="min-w-0">
          <p class="text-sm font-semibold text-warning">{{ t('podcast.show.archivedTitle') }}</p>
          <p class="mt-0.5 text-xs leading-5 text-muted-foreground">{{ t('podcast.show.archivedDescription') }}</p>
        </div>
      </div>

      <div
        v-if="show.consecutiveFailures > 0 && !isLocalShow"
        class="mt-4 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
        data-testid="podcast-feed-failure-banner"
      >
        <AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        <div class="min-w-0">
          <p class="text-sm font-semibold text-destructive">{{ t('podcast.show.feedFailingTitle') }}</p>
          <p class="mt-0.5 text-xs leading-5 text-muted-foreground">{{ feedFailingDetail }}</p>
        </div>
      </div>

      <section class="mt-4">
        <div class="mb-3 flex items-center gap-2.5">
          <h2 class="text-lg font-bold tracking-tight">{{ t('podcast.library.episodes') }}</h2>
          <Badge variant="secondary" class="text-[11px] tabular-nums">{{ formatNumber(totalEpisodes) }}</Badge>
        </div>
        <form class="sticky top-0 z-10 -mx-2 mb-4 bg-background/70 px-2 py-2 backdrop-blur-md" role="search" @submit.prevent="applyEpisodeFilters">
          <div class="flex items-center gap-2">
            <div class="relative min-w-0 flex-1 sm:max-w-xl">
              <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                v-model="episodeSearch"
                type="search"
                class="pl-9 pr-10"
                :placeholder="t('podcast.show.searchEpisodes')"
                :aria-label="t('podcast.show.searchEpisodes')"
              />
              <Button
                v-if="episodeSearch"
                type="button"
                variant="ghost"
                size="icon-sm"
                class="absolute right-0.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                :aria-label="t('podcast.show.clearEpisodeSearch')"
                @click="clearEpisodeSearch"
              >
                <X :size="14" />
              </Button>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="outline" size="sm" class="shrink-0 gap-1.5" :aria-label="t('podcast.show.episodeSort')">
                  <ArrowUpDown :size="13" />
                  <span class="hidden sm:inline">{{ activeSortLabel }}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-52">
                <DropdownMenuLabel>{{ t('podcast.show.episodeSort') }}</DropdownMenuLabel>
                <DropdownMenuRadioGroup :model-value="episodeSort" @update:model-value="selectEpisodeSort">
                  <DropdownMenuRadioItem v-for="option in episodeSortOptions" :key="option.id" :value="option.id">
                    {{ option.label }}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Popover>
              <PopoverTrigger as-child>
                <Button
                  variant="outline"
                  size="sm"
                  class="max-w-48 shrink-0 gap-1.5"
                  :class="{ 'border-primary/30 bg-primary/10 text-primary': hasDateRange }"
                  :aria-label="t('podcast.show.dateFilter')"
                >
                  <CalendarDays :size="13" />
                  <span class="max-w-32 truncate">{{ dateRangeLabel }}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" class="w-72 p-3">
                <p class="text-xs font-medium text-muted-foreground">{{ t('podcast.show.dateFilter') }}</p>
                <label class="mt-3 block text-xs font-medium">
                  {{ t('podcast.show.fromDate') }}
                  <input
                    v-model="publishedFrom"
                    type="date"
                    class="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                    @change="applyEpisodeFilters"
                  />
                </label>
                <label class="mt-3 block text-xs font-medium">
                  {{ t('podcast.show.toDate') }}
                  <input
                    v-model="publishedTo"
                    type="date"
                    class="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                    @change="applyEpisodeFilters"
                  />
                </label>
                <Button type="button" variant="ghost" size="sm" class="mt-2" :disabled="!hasDateRange" @click="clearDateRange">
                  {{ t('podcast.show.clearDates') }}
                </Button>
              </PopoverContent>
            </Popover>
          </div>
          <ChipGroup class="mt-2" :label="t('podcast.library.episodeFilters')">
            <FilterChip
              v-for="filter in episodeFilters"
              :key="filter.id"
              :active="episodeFilter === filter.id"
              @select="selectEpisodeFilter(filter.id)"
            >
              {{ filter.label }}
            </FilterChip>
          </ChipGroup>
        </form>
        <DynamicScroller v-if="episodes.length" page-mode :items="episodeScrollerItems" :min-item-size="40" key-field="id">
          <template #default="{ item, index, active }">
            <DynamicScrollerItem :item="item" :active="active" :data-index="index" :class="item.kind === 'episode' ? 'pb-2.5' : 'pb-2 pt-1'">
              <h3 v-if="item.kind === 'season'" class="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {{ t('podcast.show.seasonHeader', { season: item.season }) }}
              </h3>
              <PodcastEpisodeRow
                v-else
                :episode="item.episode"
                :can-download="canDownload"
                :can-edit-metadata="canEditMetadata"
                :download-progress="downloadProgress.get(item.episode.id)"
                :show-podcast-title="false"
                :is-active="player.episode.value?.id === item.episode.id"
                :is-playing="player.isPlaying.value && player.episode.value?.id === item.episode.id"
              />
            </DynamicScrollerItem>
          </template>
        </DynamicScroller>
        <div
          v-else
          class="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/45 px-6 text-center"
        >
          <Radio class="h-8 w-8 text-muted-foreground" />
          <h2 class="mt-4 text-lg font-bold tracking-tight">{{ t('podcast.show.noEpisodes') }}</h2>
          <p class="mt-2 max-w-sm text-sm text-muted-foreground">
            {{ episodeFilter === 'pinned' ? t('podcast.labels.pinnedHint') : t('podcast.show.noEpisodesDescription') }}
          </p>
        </div>
      </section>
    </template>

    <div ref="sentinel">
      <ListEndFooter :loading-more="loadingMore" :at-end="Boolean(show) && !hasMoreEpisodes && episodes.length > 0" :total="totalEpisodes" />
    </div>

    <ConfirmDialog
      :open="confirmRemoveDownloads"
      :title="t('podcast.actions.removeAllDownloads')"
      :description="t('podcast.show.confirmRemoveAllDownloads')"
      :confirm-label="t('podcast.actions.removeAllDownloads')"
      :busy="bulkAction === 'remove'"
      destructive
      @confirm="removeAllDownloads"
      @cancel="cancelRemoveAllDownloads"
    />

    <AddShowToCollectionSheet :open="addToCollectionOpen" :show="show" @update:open="setAddToCollectionOpen" />

    <PodcastShowSettingsSheet v-model:open="settingsOpen" :show="show" :busy="requestPending" @save="saveSettings" @manage="openManage" />

    <PodcastShowManageSheet :management="management" :show="show" :can-purge="canPurge" />

    <PodcastEditDetailsSheet
      v-if="show && canEditMetadata"
      :open="editDetailsOpen"
      :show="show"
      @update:open="handleEditDetailsOpenChange"
      @saved="applyMetadataUpdate"
      @artwork-changed="applyArtworkUpdate"
    />

    <PodcastEpisodeEditSheet
      v-if="episodeSheets.editEpisodeId.value !== null"
      :open="episodeSheets.editEpisodeOpen.value"
      :episode-id="episodeSheets.editEpisodeId.value"
      @update:open="episodeSheets.setEditOpen"
      @saved="applyEpisodeMetadata"
    />

    <PodcastEpisodeQuickView
      :open="episodeSheets.quickViewOpen.value"
      :episode="episodeSheets.quickViewEpisode.value"
      @update:open="episodeSheets.setQuickViewOpen"
      :can-download="canDownload"
      :can-edit-metadata="canEditMetadata"
      :is-active="player.episode.value?.id === episodeSheets.quickViewEpisode.value?.id"
      :is-playing="player.isPlaying.value && player.episode.value?.id === episodeSheets.quickViewEpisode.value?.id"
    />
  </main>
</template>
