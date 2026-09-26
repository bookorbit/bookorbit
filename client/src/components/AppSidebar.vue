<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { Aperture, BookCopy, CircleArrowUp, FolderOpen, Heart, Orbit, Podcast } from '@lucide/vue'
import { APP_FEATURES, Permission, type Library, type LibraryType, type MediaType } from '@bookorbit/types'
import { formatCompactNumber, formatNumber } from '@/i18n/formatters'
import { entityCount } from '@/lib/entity-count'
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail, SidebarSeparator, useSidebar } from '@/components/ui/sidebar'
import SidebarZone from '@/components/sidebar/SidebarZone.vue'
import SidebarNavItem from '@/components/sidebar/SidebarNavItem.vue'
import SidebarBadge from '@/components/sidebar/SidebarBadge.vue'
import SidebarEntitySection from '@/components/sidebar/SidebarEntitySection.vue'
import SidebarModeSwitch from '@/components/sidebar/SidebarModeSwitch.vue'
import SidebarSectionPopover from '@/components/sidebar/SidebarSectionPopover.vue'
import SidebarGithubStar from '@/components/sidebar/SidebarGithubStar.vue'
import SidebarAppLinks from '@/components/sidebar/SidebarAppLinks.vue'
import { buildSidebarVersionUi } from '@/components/sidebar/versionUi'
import { mergedMediaOrder, ownedInOrder, type DisplayOrderEntry } from '@/components/sidebar/sidebar-order'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSidebarNav } from '@/composables/useSidebarNav'
import { useBrowseCounts } from '@/composables/useBrowseCounts'
import { mediaModeHome, useMediaMode } from '@/composables/useMediaMode'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useLibraryScanRefresh } from '@/features/library/composables/useLibraryScanRefresh'
import { useSmartScopes } from '@/features/smart-scope/composables/useSmartScopes'
import { useCollections } from '@/features/collection/composables/useCollections'
import { canMutateCollection } from '@/features/collection/lib/collection-access'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useScanProgress, getSocket } from '@/features/scanner/composables/useScanProgress'
import { usePodcastImportProgress } from '@/features/podcast/composables/usePodcastImportProgress'
import { useLibraryUploadEvents } from '@/features/library/composables/useLibraryUploadEvents'
import { useBookDockSummary } from '@/features/book-dock/composables/useBookDockSummary'
import CreateSmartScopeDialog from '@/features/smart-scope/components/CreateSmartScopeDialog.vue'
import CreateCollectionDialog from '@/features/collection/components/CreateCollectionDialog.vue'
import LibraryCreatorModal from '@/features/library/components/LibraryCreatorModal.vue'
import { useLibraryCreationRedirect } from '@/features/library/composables/useLibraryCreationRedirect'
import { useAppInfo } from '@/features/settings/composables/useAppInfo'
import SettingsSidebar from '@/features/settings/components/SettingsSidebar.vue'
import { useWhatsNew } from '@/features/whats-new/composables/useWhatsNew'
import { useBookRequestSummary } from '@/features/book-requests/composables/useBookRequestSummary'
import { useBookRequestProgress } from '@/features/book-requests/composables/useBookRequestProgress'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { state, isMobile, setOpenMobile } = useSidebar()
const { mode, setMode, syncModeFromRoute } = useMediaMode()
const { libraries, fetchLibraries, refreshLibraries, reorderLibraries } = useLibraries()
const { bookScopes, podcastScopes, fetchSmartScopes, reorderSmartScopes } = useSmartScopes()
const { bookCollections, podcastCollections, fetchCollections, reorderCollections } = useCollections()
const { hasPermission } = usePermissions()
const { subscribeLibrary, getProgress } = useScanProgress()
const podcastImportProgress = APP_FEATURES.podcasts ? usePodcastImportProgress() : null
const { handleLibraryCreated } = useLibraryCreationRedirect()
const { version, updateAvailable, latestVersion, loadAppInfo } = useAppInfo()
const { hasUnseen: hasUnseenWhatsNew } = useWhatsNew()
const { fetchSummary: fetchBookDockSummary, subscribe: subscribeBookDockSummary } = useBookDockSummary()
const { fetchCounts: fetchBrowseCounts, refreshCounts: refreshBrowseCounts } = useBrowseCounts()
const { summary: bookRequestSummary, fetchSummary: fetchBookRequestSummary, refreshSummary: refreshBookRequestSummary } = useBookRequestSummary()
const outstandingRequestTotal = computed(() =>
  hasPermission(Permission.ManageBookRequests) ? (bookRequestSummary.value?.active ?? 0) : (bookRequestSummary.value?.mine ?? 0),
)
const { zones } = useSidebarNav(() => outstandingRequestTotal.value)
const requestProgress = hasPermission(Permission.BookRequestAccess) ? useBookRequestProgress() : null
useLibraryScanRefresh()

const SUPPORT_URL = 'https://ko-fi.com/neonbookorbit'

// Shared scopes belong to their owner, so their display order is not this user's to persist.
const ownedBookScopes = computed(() => bookScopes.value.filter((scope) => scope.isOwner))
const ownedPodcastScopes = computed(() => podcastScopes.value.filter((scope) => scope.isOwner))

async function persistSmartScopeOrder(order: DisplayOrderEntry[]) {
  const books = ownedInOrder(order, ownedBookScopes.value)
  if (books.length === 0) return
  await reorderSmartScopes(mergedMediaOrder(books, ownedPodcastScopes.value))
}

async function persistPodcastScopeOrder(order: DisplayOrderEntry[]) {
  const podcasts = ownedInOrder(order, ownedPodcastScopes.value)
  if (podcasts.length === 0) return
  await reorderSmartScopes(mergedMediaOrder(ownedBookScopes.value, podcasts))
}

const ownedBookCollections = computed(() => bookCollections.value.filter(canMutateCollection))
const ownedPodcastCollections = computed(() => podcastCollections.value.filter(canMutateCollection))

async function persistCollectionOrder(order: DisplayOrderEntry[]) {
  const books = ownedInOrder(order, ownedBookCollections.value)
  if (books.length === 0) return
  await reorderCollections(mergedMediaOrder(books, ownedPodcastCollections.value))
}

async function persistPodcastCollectionOrder(order: DisplayOrderEntry[]) {
  const podcasts = ownedInOrder(order, ownedPodcastCollections.value)
  if (podcasts.length === 0) return
  await reorderCollections(mergedMediaOrder(ownedBookCollections.value, podcasts))
}

const createSmartScopeOpen = ref(false)
const createCollectionOpen = ref(false)
const createLibraryOpen = ref(false)
const createLibraryType = ref<LibraryType>('books')
const createScopeMediaType = ref<MediaType>('books')
const createCollectionMediaType = ref<MediaType>('books')
/** A podcast scope belongs to one library; the first is the sensible default target. */
const defaultPodcastLibraryId = computed(() => podcastLibraries.value[0]?.id ?? null)

const isRail = computed(() => state.value === 'collapsed' && !isMobile.value)
const isSettingsRoute = computed(() => typeof route.name === 'string' && route.name.startsWith('settings-'))
const versionUi = computed(() => buildSidebarVersionUi(version.value, updateAvailable.value, latestVersion.value))

function activeIdFor(...routeNames: string[]): number | null {
  const id = route.params.id
  return routeNames.some((routeName) => route.name === routeName) && id ? Number(id) : null
}

const activeLibraryId = computed(() => activeIdFor('library'))
const activePodcastLibraryId = computed(() => activeIdFor('podcast-library'))
const activeSmartScopeId = computed(() => activeIdFor('smartScope'))
const activeCollectionId = computed(() => activeIdFor('collection'))
const activePodcastScopeId = computed(() => activeIdFor('podcast-playlist'))
const activePodcastCollectionId = computed(() => activeIdFor('podcast-collection'))

const canManageLibraries = computed(() => hasPermission('manage_libraries'))

const bookLibraries = computed(() => libraries.value.filter((library) => library.type !== 'podcasts'))
const podcastLibraries = computed(() => libraries.value.filter((library) => library.type === 'podcasts'))

/** Books-only users never see the switcher; the creator is the entry point into podcasts. */
const showModeSwitch = computed(() => APP_FEATURES.podcasts && podcastLibraries.value.length > 0)

const isBooksMode = computed(() => mode.value === 'books')

watch(
  () => route.name,
  (routeName) => syncModeFromRoute(routeName),
  { immediate: true },
)

watch(showModeSwitch, (visible) => {
  if (!visible && mode.value === 'podcasts') setMode('books')
})

async function handleModeSwitch(target: LibraryType) {
  setMode(target)
  await router.push(mediaModeHome(target, podcastLibraries.value))
  handleNavigate()
}

async function persistLibraryOrder(order: DisplayOrderEntry[]) {
  await reorderLibraries(mergedMediaOrder(order, podcastLibraries.value))
}

async function persistPodcastLibraryOrder(order: DisplayOrderEntry[]) {
  await reorderLibraries(mergedMediaOrder(bookLibraries.value, order))
}

function handleNavigate() {
  if (isMobile.value) setOpenMobile(false)
}

function openCreateLibrary() {
  createLibraryType.value = 'books'
  createLibraryOpen.value = true
}

function openCreatePodcastLibrary() {
  createLibraryType.value = 'podcasts'
  createLibraryOpen.value = true
}

function openCreatePodcastScope() {
  createScopeMediaType.value = 'podcasts'
  createSmartScopeOpen.value = true
}

function openCreatePodcastCollection() {
  createCollectionMediaType.value = 'podcasts'
  createCollectionOpen.value = true
}

function openCreateSmartScope() {
  createScopeMediaType.value = 'books'
  createSmartScopeOpen.value = true
}

function openCreateCollection() {
  createCollectionMediaType.value = 'books'
  createCollectionOpen.value = true
}

function closeCreateLibrary() {
  createLibraryOpen.value = false
}

function closeCreateSmartScope() {
  createSmartScopeOpen.value = false
}

function closeCreateCollection() {
  createCollectionOpen.value = false
}

function isScanning(libraryId: number): boolean {
  return getProgress(libraryId)?.status === 'running'
}

function scanPct(libraryId: number): number {
  const progress = getProgress(libraryId)
  if (!progress || progress.total === 0) return 0
  return Math.floor((progress.processed / progress.total) * 100)
}

function scanProgressLabel(libraryId: number): string {
  const progress = getProgress(libraryId)
  if (!progress) return ''
  return t('components.sidebar.scanProgress', {
    processed: formatNumber(progress.processed),
    total: formatNumber(progress.total),
  })
}

function scanBarWidth(libraryId: number): string {
  const progress = getProgress(libraryId)
  return progress && progress.total > 0 ? `${scanPct(libraryId)}%` : '30%'
}

function podcastImportLabel(libraryId: number): string {
  const state = podcastImportProgress?.getImport(libraryId)
  if (!state) return ''
  return state.total === null
    ? t('components.sidebar.podcastImportCounting')
    : t('components.sidebar.podcastImportProgress', { processed: formatNumber(state.processed), total: formatNumber(state.total) })
}

/** Podcast libraries watch the same id on their own channel, so both subscriptions are needed. */
function subscribeLibraryProgress(library: { id: number; type?: string }): void {
  subscribeLibrary(library.id)
  if (library.type === 'podcasts') podcastImportProgress?.subscribeLibrary(library.id)
}

function isImportingPodcasts(libraryId: number): boolean {
  return podcastImportProgress?.isImporting(libraryId) ?? false
}

function podcastImportPct(libraryId: number): number {
  return podcastImportProgress?.importPct(libraryId) ?? 0
}

function podcastImportBarWidth(libraryId: number): string {
  return podcastImportProgress?.importBarWidth(libraryId) ?? '0%'
}

async function onLibrarySaved(library: Library) {
  createLibraryOpen.value = false
  subscribeLibraryProgress(library)
  await handleLibraryCreated(library)
}

onMounted(async () => {
  getSocket()
  await fetchLibraries()
  for (const library of libraries.value) {
    subscribeLibraryProgress(library)
  }
  void fetchSmartScopes()
  void fetchCollections()
  void fetchBrowseCounts()
  if (hasPermission(Permission.BookRequestAccess)) void fetchBookRequestSummary()
  void loadAppInfo()
  if (hasPermission('book_dock_access')) {
    void fetchBookDockSummary()
    subscribeBookDockSummary()
  }
})

requestProgress?.onRequestsChanged(() => {
  void refreshBookRequestSummary()
})

if (requestProgress) {
  watch(requestProgress.connected, (connected) => {
    if (connected) void refreshBookRequestSummary()
  })
}

const { onLibraryUploadCompleted } = useLibraryUploadEvents()
const stopLibraryUploadListener = onLibraryUploadCompleted((event) => {
  if (event.uploadedCount === 0) return
  void refreshLibraries()
  void refreshBrowseCounts()
})

onUnmounted(() => stopLibraryUploadListener())
</script>

<template>
  <CreateSmartScopeDialog
    :open="createSmartScopeOpen"
    :media-type="createScopeMediaType"
    :library-id="defaultPodcastLibraryId"
    @close="closeCreateSmartScope"
  />
  <CreateCollectionDialog :open="createCollectionOpen" :media-type="createCollectionMediaType" @close="closeCreateCollection" />
  <LibraryCreatorModal v-if="createLibraryOpen" :initial-type="createLibraryType" @close="closeCreateLibrary" @saved="onLibrarySaved" />

  <Sidebar variant="floating" collapsible="icon">
    <!-- px-4 puts the logo on the same left edge as the nav row icons (group px-2 + row px-2). -->
    <SidebarHeader class="border-b border-sidebar-border px-4 py-2.5 group-data-[collapsible=icon]:px-2">
      <RouterLink
        to="/"
        class="flex h-9 items-center gap-3 rounded-(--shell-radius) outline-hidden group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        :aria-label="t('components.sidebar.dashboard')"
        @click="handleNavigate"
      >
        <div
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--shell-radius) bg-primary ring-1 ring-(--shell-accent-line)"
          aria-hidden="true"
        >
          <Orbit :size="21" class="text-primary-foreground" />
        </div>
        <span class="truncate font-serif text-[18px] font-semibold leading-none text-sidebar-foreground group-data-[collapsible=icon]:hidden">
          Book<span class="text-primary"> Orbit</span>
        </span>
      </RouterLink>
      <SidebarModeSwitch v-if="showModeSwitch" :mode="mode" :rail="isRail" class="mt-1.5" @switch="handleModeSwitch" />
    </SidebarHeader>

    <SidebarContent>
      <!-- Settings takes over the sidebar rather than adding a second one next to it. -->
      <SettingsSidebar v-if="isSettingsRoute" :is-rail="isRail" />

      <template v-else>
        <!-- Fixed destinations come first: they are a known height, so the variable-length
             entity sections below can never push them out of the first screenful. -->
        <SidebarZone
          v-for="zone in zones"
          :key="zone.id"
          :label="zone.labelKey ? t(zone.labelKey) : null"
          :section-id="zone.sectionId ?? undefined"
          :always-open="isRail"
        >
          <SidebarNavItem
            v-for="entry in zone.entries"
            :key="entry.id"
            :is-active="entry.isActive"
            :tooltip="entry.badge?.label ?? entry.label"
            :to="entry.to"
            :icon="entry.icon"
            :label="entry.label"
            :data-tour="entry.tourId"
            @navigate="handleNavigate"
          >
            <template #badge>
              <SidebarBadge v-if="entry.badge !== null" :tone="entry.badge.tone" :label="entry.badge.label">{{
                formatCompactNumber(entry.badge.value)
              }}</SidebarBadge>
            </template>
          </SidebarNavItem>
        </SidebarZone>

        <SidebarSeparator />

        <template v-if="isRail">
          <div v-if="isBooksMode" class="flex flex-col items-center gap-1 px-2">
            <SidebarSectionPopover :label="t('components.sidebar.libraries')" :icon="BookCopy" :count="bookLibraries.length">
              <SidebarEntitySection
                section-id="libraries"
                always-open
                :label="t('components.sidebar.libraries')"
                :items="bookLibraries"
                route-name="library"
                index-route-name="libraries"
                :active-id="activeLibraryId"
                fallback-icon="BookCopy"
                :empty-text="t('components.sidebar.noLibraries')"
                :filter-label="t('components.sidebar.filterLibraries')"
                :filter-placeholder="t('components.sidebar.filterLibrariesPlaceholder')"
                :see-all-label="t('components.sidebar.seeAllLibraries', { count: formatNumber(bookLibraries.length) })"
                :can-add="canManageLibraries"
                :add-label="t('components.sidebar.newLibrary')"
                @add="openCreateLibrary"
                @navigate="handleNavigate"
              />
            </SidebarSectionPopover>

            <SidebarSectionPopover :label="t('components.sidebar.smartScopes')" :icon="Aperture" :count="bookScopes.length">
              <SidebarEntitySection
                section-id="smartScopes"
                always-open
                :label="t('components.sidebar.smartScopes')"
                :items="bookScopes"
                route-name="smartScope"
                index-route-name="smart-scopes"
                :active-id="activeSmartScopeId"
                fallback-icon="Aperture"
                :empty-text="t('components.sidebar.noSmartScopes')"
                :filter-label="t('components.sidebar.filterSmartScopes')"
                :filter-placeholder="t('components.sidebar.filterSmartScopesPlaceholder')"
                :see-all-label="t('components.sidebar.seeAllSmartScopes', { count: formatNumber(bookScopes.length) })"
                can-add
                :add-label="t('components.sidebar.newSmartScope')"
                @add="openCreateSmartScope"
                @navigate="handleNavigate"
              />
            </SidebarSectionPopover>

            <SidebarSectionPopover :label="t('components.sidebar.collections')" :icon="FolderOpen" :count="bookCollections.length">
              <SidebarEntitySection
                section-id="collections"
                always-open
                :label="t('components.sidebar.collections')"
                :items="bookCollections"
                route-name="collection"
                index-route-name="collections"
                :active-id="activeCollectionId"
                fallback-icon="FolderOpen"
                :empty-text="t('components.sidebar.noCollections')"
                :filter-label="t('components.sidebar.filterCollections')"
                :filter-placeholder="t('components.sidebar.filterCollectionsPlaceholder')"
                :see-all-label="t('components.sidebar.seeAllCollections', { count: formatNumber(bookCollections.length) })"
                can-add
                :add-label="t('components.sidebar.newCollection')"
                @add="openCreateCollection"
                @navigate="handleNavigate"
              />
            </SidebarSectionPopover>
          </div>

          <div v-else class="flex flex-col items-center gap-1 px-2">
            <SidebarSectionPopover :label="t('components.sidebar.podcasts')" :icon="Podcast" :count="podcastLibraries.length">
              <SidebarEntitySection
                section-id="podcasts"
                always-open
                :label="t('components.sidebar.podcasts')"
                :items="podcastLibraries"
                route-name="podcast-library"
                index-route-name="podcast-libraries"
                :active-id="activePodcastLibraryId"
                fallback-icon="Podcast"
                :empty-text="t('components.sidebar.noPodcastLibraries')"
                :filter-label="t('components.sidebar.filterPodcastLibraries')"
                :filter-placeholder="t('components.sidebar.filterPodcastLibrariesPlaceholder')"
                :see-all-label="t('components.sidebar.seeAllPodcastLibraries', { count: formatNumber(podcastLibraries.length) })"
                :can-add="canManageLibraries"
                :add-label="t('components.sidebar.newPodcastLibrary')"
                @add="openCreatePodcastLibrary"
                @navigate="handleNavigate"
              />
            </SidebarSectionPopover>

            <SidebarSectionPopover :label="t('components.sidebar.playlists')" :icon="Aperture" :count="podcastScopes.length">
              <SidebarEntitySection
                section-id="podcastScopes"
                always-open
                :label="t('components.sidebar.playlists')"
                :items="podcastScopes"
                route-name="podcast-playlist"
                :active-id="activePodcastScopeId"
                fallback-icon="Aperture"
                :empty-text="t('components.sidebar.noPlaylists')"
                :filter-label="t('components.sidebar.filterPlaylists')"
                :filter-placeholder="t('components.sidebar.filterPlaylistsPlaceholder')"
                :see-all-label="t('components.sidebar.seeAllPlaylists', { count: formatNumber(podcastScopes.length) })"
                :can-add="showModeSwitch"
                :add-label="t('components.sidebar.newPlaylist')"
                @add="openCreatePodcastScope"
                @navigate="handleNavigate"
              />
            </SidebarSectionPopover>

            <SidebarSectionPopover :label="t('components.sidebar.collections')" :icon="FolderOpen" :count="podcastCollections.length">
              <SidebarEntitySection
                section-id="podcastCollections"
                always-open
                :label="t('components.sidebar.collections')"
                :items="podcastCollections"
                route-name="podcast-collection"
                :active-id="activePodcastCollectionId"
                fallback-icon="FolderOpen"
                :empty-text="t('components.sidebar.noPodcastCollections')"
                :filter-label="t('components.sidebar.filterPodcastCollections')"
                :filter-placeholder="t('components.sidebar.filterPodcastCollectionsPlaceholder')"
                :see-all-label="t('components.sidebar.seeAllPodcastCollections', { count: formatNumber(podcastCollections.length) })"
                :can-add="showModeSwitch"
                :add-label="t('components.sidebar.newPodcastCollection')"
                @add="openCreatePodcastCollection"
                @navigate="handleNavigate"
              />
            </SidebarSectionPopover>
          </div>
        </template>

        <template v-else-if="isBooksMode">
          <SidebarEntitySection
            section-id="libraries"
            tour-id="sidebar-libraries"
            :label="t('components.sidebar.libraries')"
            :items="bookLibraries"
            route-name="library"
            index-route-name="libraries"
            :active-id="activeLibraryId"
            fallback-icon="BookCopy"
            :empty-text="t('components.sidebar.noLibraries')"
            :filter-label="t('components.sidebar.filterLibraries')"
            :filter-placeholder="t('components.sidebar.filterLibrariesPlaceholder')"
            :see-all-label="t('components.sidebar.seeAllLibraries', { count: formatNumber(bookLibraries.length) })"
            :can-add="canManageLibraries"
            :add-label="t('components.sidebar.newLibrary')"
            :can-reorder="canManageLibraries"
            :persist-order="persistLibraryOrder"
            @add="openCreateLibrary"
            @navigate="handleNavigate"
          >
            <template #itemBadge="{ item }">
              <SidebarBadge v-if="isScanning(item.id)" variant="progress">{{ scanPct(item.id) }}%</SidebarBadge>
              <SidebarBadge v-else-if="entityCount(item) !== null">{{ formatCompactNumber(entityCount(item) ?? 0) }}</SidebarBadge>
            </template>
            <template #itemExtra="{ item }">
              <div v-if="isScanning(item.id)" class="px-2 pb-1.5 group-data-[collapsible=icon]:hidden">
                <div class="h-0.5 w-full overflow-hidden rounded-full bg-(--shell-accent-tint)">
                  <div class="h-full rounded-full bg-primary" :style="{ width: scanBarWidth(item.id) }" />
                </div>
                <p class="mt-0.5 text-[13px] text-muted-foreground">{{ scanProgressLabel(item.id) }}</p>
              </div>
            </template>
          </SidebarEntitySection>

          <SidebarEntitySection
            section-id="smartScopes"
            tour-id="sidebar-smartScopes"
            :label="t('components.sidebar.smartScopes')"
            :items="bookScopes"
            route-name="smartScope"
            index-route-name="smart-scopes"
            :active-id="activeSmartScopeId"
            fallback-icon="Aperture"
            :empty-text="t('components.sidebar.noSmartScopes')"
            :filter-label="t('components.sidebar.filterSmartScopes')"
            :filter-placeholder="t('components.sidebar.filterSmartScopesPlaceholder')"
            :see-all-label="t('components.sidebar.seeAllSmartScopes', { count: formatNumber(bookScopes.length) })"
            can-add
            :add-label="t('components.sidebar.newSmartScope')"
            can-reorder
            :persist-order="persistSmartScopeOrder"
            @add="openCreateSmartScope"
            @navigate="handleNavigate"
          />

          <SidebarEntitySection
            section-id="collections"
            tour-id="sidebar-collections"
            :label="t('components.sidebar.collections')"
            :items="bookCollections"
            route-name="collection"
            index-route-name="collections"
            :active-id="activeCollectionId"
            fallback-icon="FolderOpen"
            :empty-text="t('components.sidebar.noCollections')"
            :filter-label="t('components.sidebar.filterCollections')"
            :filter-placeholder="t('components.sidebar.filterCollectionsPlaceholder')"
            :see-all-label="t('components.sidebar.seeAllCollections', { count: formatNumber(bookCollections.length) })"
            can-add
            :add-label="t('components.sidebar.newCollection')"
            can-reorder
            :persist-order="persistCollectionOrder"
            @add="openCreateCollection"
            @navigate="handleNavigate"
          />
        </template>

        <template v-else>
          <SidebarEntitySection
            section-id="podcasts"
            :label="t('components.sidebar.podcasts')"
            :items="podcastLibraries"
            route-name="podcast-library"
            index-route-name="podcast-libraries"
            :active-id="activePodcastLibraryId"
            fallback-icon="Podcast"
            :empty-text="t('components.sidebar.noPodcastLibraries')"
            :filter-label="t('components.sidebar.filterPodcastLibraries')"
            :filter-placeholder="t('components.sidebar.filterPodcastLibrariesPlaceholder')"
            :see-all-label="t('components.sidebar.seeAllPodcastLibraries', { count: formatNumber(podcastLibraries.length) })"
            :can-add="canManageLibraries"
            :add-label="t('components.sidebar.newPodcastLibrary')"
            :can-reorder="canManageLibraries"
            :persist-order="persistPodcastLibraryOrder"
            @add="openCreatePodcastLibrary"
            @navigate="handleNavigate"
          >
            <template #itemBadge="{ item }">
              <SidebarBadge v-if="isImportingPodcasts(item.id)" variant="progress">{{ podcastImportPct(item.id) }}%</SidebarBadge>
              <SidebarBadge v-else-if="entityCount(item) !== null">{{ formatCompactNumber(entityCount(item) ?? 0) }}</SidebarBadge>
            </template>
            <template #itemExtra="{ item }">
              <div v-if="isImportingPodcasts(item.id)" class="px-2 pb-1.5 group-data-[collapsible=icon]:hidden">
                <div class="h-0.5 w-full overflow-hidden rounded-full bg-(--shell-accent-tint)">
                  <div class="h-full rounded-full bg-primary" :style="{ width: podcastImportBarWidth(item.id) }" />
                </div>
                <p class="mt-0.5 text-[13px] text-muted-foreground">{{ podcastImportLabel(item.id) }}</p>
              </div>
            </template>
          </SidebarEntitySection>

          <SidebarEntitySection
            section-id="podcastScopes"
            :label="t('components.sidebar.playlists')"
            :items="podcastScopes"
            route-name="podcast-playlist"
            :active-id="activePodcastScopeId"
            fallback-icon="Aperture"
            :empty-text="t('components.sidebar.noPlaylists')"
            :filter-label="t('components.sidebar.filterPlaylists')"
            :filter-placeholder="t('components.sidebar.filterPlaylistsPlaceholder')"
            :see-all-label="t('components.sidebar.seeAllPlaylists', { count: formatNumber(podcastScopes.length) })"
            :can-add="showModeSwitch"
            :add-label="t('components.sidebar.newPlaylist')"
            can-reorder
            :persist-order="persistPodcastScopeOrder"
            @add="openCreatePodcastScope"
            @navigate="handleNavigate"
          />

          <SidebarEntitySection
            section-id="podcastCollections"
            :label="t('components.sidebar.collections')"
            :items="podcastCollections"
            route-name="podcast-collection"
            :active-id="activePodcastCollectionId"
            fallback-icon="FolderOpen"
            :empty-text="t('components.sidebar.noPodcastCollections')"
            :filter-label="t('components.sidebar.filterPodcastCollections')"
            :filter-placeholder="t('components.sidebar.filterPodcastCollectionsPlaceholder')"
            :see-all-label="t('components.sidebar.seeAllPodcastCollections', { count: formatNumber(podcastCollections.length) })"
            :can-add="showModeSwitch"
            :add-label="t('components.sidebar.newPodcastCollection')"
            can-reorder
            :persist-order="persistPodcastCollectionOrder"
            @add="openCreatePodcastCollection"
            @navigate="handleNavigate"
          />
        </template>
      </template>
    </SidebarContent>

    <SidebarFooter v-if="!isSettingsRoute" class="border-t border-sidebar-border px-4 py-2 group-data-[collapsible=icon]:px-2">
      <div
        class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 group-data-[collapsible=icon]:grid-cols-1 group-data-[collapsible=icon]:justify-items-center group-data-[collapsible=icon]:gap-1"
      >
        <div
          class="flex items-center justify-self-start group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1 group-data-[collapsible=icon]:justify-self-center"
        >
          <SidebarGithubStar :is-rail="isRail" />

          <Tooltip>
            <TooltipTrigger as-child>
              <a
                :href="SUPPORT_URL"
                target="_blank"
                rel="noopener noreferrer"
                :aria-label="t('components.sidebar.supportAria')"
                class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-destructive outline-hidden transition-colors duration-150 hover:bg-(--shell-accent-wash) focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                <Heart :size="16" class="fill-current" aria-hidden="true" />
              </a>
            </TooltipTrigger>
            <TooltipContent :side="isRail ? 'right' : 'top'">{{ t('components.sidebar.support') }}</TooltipContent>
          </Tooltip>
        </div>

        <div class="flex min-w-0 items-center justify-center gap-1 group-data-[collapsible=icon]:hidden">
          <RouterLink
            v-if="versionUi.currentLabel"
            to="/whats-new"
            class="inline-flex min-w-0 items-center gap-1.5 rounded-md text-[13px] font-medium text-muted-foreground outline-hidden transition-colors duration-150 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            @click="handleNavigate"
          >
            <span class="truncate">{{ versionUi.currentLabel }}</span>
            <span
              v-if="hasUnseenWhatsNew"
              class="h-1.5 w-1.5 flex-none rounded-full bg-primary"
              :aria-label="t('components.sidebar.newReleaseNotes')"
            />
          </RouterLink>

          <Tooltip v-if="versionUi.showUpdate">
            <TooltipTrigger as-child>
              <a
                :href="versionUi.updateHref"
                target="_blank"
                rel="noopener noreferrer"
                :aria-label="t('components.sidebar.openUpdateRelease', { version: versionUi.updateVersionLabel })"
                class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-success outline-hidden transition-colors duration-150 hover:bg-(--shell-accent-wash) focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                <CircleArrowUp :size="18" aria-hidden="true" />
              </a>
            </TooltipTrigger>
            <TooltipContent side="top">{{ t('components.sidebar.updateTooltip', { version: versionUi.updateVersionLabel }) }}</TooltipContent>
          </Tooltip>
        </div>

        <div class="justify-self-end group-data-[collapsible=icon]:justify-self-center">
          <SidebarAppLinks :is-rail="isRail" />
        </div>
      </div>
    </SidebarFooter>

    <SidebarRail />
  </Sidebar>
</template>
