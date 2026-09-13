<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { Aperture, BookCopy, CircleArrowUp, FolderOpen, Heart, Orbit } from '@lucide/vue'
import { Permission, type Library } from '@bookorbit/types'
import { formatCompactNumber, formatNumber } from '@/i18n/formatters'
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail, SidebarSeparator, useSidebar } from '@/components/ui/sidebar'
import SidebarZone from '@/components/sidebar/SidebarZone.vue'
import SidebarNavItem from '@/components/sidebar/SidebarNavItem.vue'
import SidebarBadge from '@/components/sidebar/SidebarBadge.vue'
import SidebarEntitySection from '@/components/sidebar/SidebarEntitySection.vue'
import SidebarSectionPopover from '@/components/sidebar/SidebarSectionPopover.vue'
import SidebarGithubStar from '@/components/sidebar/SidebarGithubStar.vue'
import { buildSidebarVersionUi } from '@/components/sidebar/versionUi'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSidebarNav } from '@/composables/useSidebarNav'
import { useBrowseCounts } from '@/composables/useBrowseCounts'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useLibraryScanRefresh } from '@/features/library/composables/useLibraryScanRefresh'
import { useSmartScopes } from '@/features/smart-scope/composables/useSmartScopes'
import { useCollections } from '@/features/collection/composables/useCollections'
import { ownedCollectionOrder } from '@/features/collection/lib/collection-access'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useScanProgress, getSocket } from '@/features/scanner/composables/useScanProgress'
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
const { state, isMobile, setOpenMobile } = useSidebar()
const { libraries, fetchLibraries, refreshLibraries, reorderLibraries } = useLibraries()
const { smartScopes, fetchSmartScopes, reorderSmartScopes } = useSmartScopes()
const { collections, fetchCollections, reorderCollections } = useCollections()
const { hasPermission } = usePermissions()
const { subscribeLibrary, getProgress } = useScanProgress()
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

// Shared scopes belong to their owner, so their display order is not this user's to
// persist. Sending them anyway makes the server reject the whole reorder.
async function persistSmartScopeOrder(order: { id: number; displayOrder: number }[]) {
  const ownedIds = new Set(smartScopes.value.filter((scope) => scope.isOwner).map((scope) => scope.id))
  const ownedOrder = order.filter((entry) => ownedIds.has(entry.id))
  if (ownedOrder.length === 0) return
  await reorderSmartScopes(ownedOrder)
}

async function persistCollectionOrder(order: { id: number; displayOrder: number }[]) {
  const ownedOrder = ownedCollectionOrder(collections.value, order)
  if (ownedOrder.length === 0) return
  await reorderCollections(ownedOrder)
}

const createSmartScopeOpen = ref(false)
const createCollectionOpen = ref(false)
const createLibraryOpen = ref(false)

const isRail = computed(() => state.value === 'collapsed' && !isMobile.value)
const isSettingsRoute = computed(() => typeof route.name === 'string' && route.name.startsWith('settings-'))
const versionUi = computed(() => buildSidebarVersionUi(version.value, updateAvailable.value, latestVersion.value))

function activeIdFor(routeName: string): number | null {
  const id = route.params.id
  return route.name === routeName && id ? Number(id) : null
}

const activeLibraryId = computed(() => activeIdFor('library'))
const activeSmartScopeId = computed(() => activeIdFor('smartScope'))
const activeCollectionId = computed(() => activeIdFor('collection'))

const canManageLibraries = computed(() => hasPermission('manage_libraries'))

function handleNavigate() {
  if (isMobile.value) setOpenMobile(false)
}

function openCreateLibrary() {
  createLibraryOpen.value = true
}

function openCreateSmartScope() {
  createSmartScopeOpen.value = true
}

function openCreateCollection() {
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

async function onLibrarySaved(library: Library) {
  createLibraryOpen.value = false
  subscribeLibrary(library.id)
  await handleLibraryCreated(library)
}

onMounted(async () => {
  getSocket()
  await fetchLibraries()
  for (const library of libraries.value) {
    subscribeLibrary(library.id)
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
  <CreateSmartScopeDialog :open="createSmartScopeOpen" @close="closeCreateSmartScope" />
  <CreateCollectionDialog :open="createCollectionOpen" @close="closeCreateCollection" />
  <LibraryCreatorModal v-if="createLibraryOpen" @close="closeCreateLibrary" @saved="onLibrarySaved" />

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
          <div class="flex flex-col items-center gap-1 px-2">
            <SidebarSectionPopover :label="t('components.sidebar.libraries')" :icon="BookCopy" :count="libraries.length">
              <SidebarEntitySection
                section-id="libraries"
                always-open
                :label="t('components.sidebar.libraries')"
                :items="libraries"
                route-name="library"
                index-route-name="libraries"
                :active-id="activeLibraryId"
                fallback-icon="BookCopy"
                :empty-text="t('components.sidebar.noLibraries')"
                :filter-label="t('components.sidebar.filterLibraries')"
                :filter-placeholder="t('components.sidebar.filterLibrariesPlaceholder')"
                :see-all-label="t('components.sidebar.seeAllLibraries', { count: formatNumber(libraries.length) })"
                :can-add="canManageLibraries"
                :add-label="t('components.sidebar.newLibrary')"
                @add="openCreateLibrary"
                @navigate="handleNavigate"
              />
            </SidebarSectionPopover>

            <SidebarSectionPopover :label="t('components.sidebar.smartScopes')" :icon="Aperture" :count="smartScopes.length">
              <SidebarEntitySection
                section-id="smartScopes"
                always-open
                :label="t('components.sidebar.smartScopes')"
                :items="smartScopes"
                route-name="smartScope"
                index-route-name="smart-scopes"
                :active-id="activeSmartScopeId"
                fallback-icon="Aperture"
                :empty-text="t('components.sidebar.noSmartScopes')"
                :filter-label="t('components.sidebar.filterSmartScopes')"
                :filter-placeholder="t('components.sidebar.filterSmartScopesPlaceholder')"
                :see-all-label="t('components.sidebar.seeAllSmartScopes', { count: formatNumber(smartScopes.length) })"
                can-add
                :add-label="t('components.sidebar.newSmartScope')"
                @add="openCreateSmartScope"
                @navigate="handleNavigate"
              />
            </SidebarSectionPopover>

            <SidebarSectionPopover :label="t('components.sidebar.collections')" :icon="FolderOpen" :count="collections.length">
              <SidebarEntitySection
                section-id="collections"
                always-open
                :label="t('components.sidebar.collections')"
                :items="collections"
                route-name="collection"
                index-route-name="collections"
                :active-id="activeCollectionId"
                fallback-icon="FolderOpen"
                :empty-text="t('components.sidebar.noCollections')"
                :filter-label="t('components.sidebar.filterCollections')"
                :filter-placeholder="t('components.sidebar.filterCollectionsPlaceholder')"
                :see-all-label="t('components.sidebar.seeAllCollections', { count: formatNumber(collections.length) })"
                can-add
                :add-label="t('components.sidebar.newCollection')"
                @add="openCreateCollection"
                @navigate="handleNavigate"
              />
            </SidebarSectionPopover>
          </div>
        </template>

        <template v-else>
          <SidebarEntitySection
            section-id="libraries"
            tour-id="sidebar-libraries"
            :label="t('components.sidebar.libraries')"
            :items="libraries"
            route-name="library"
            index-route-name="libraries"
            :active-id="activeLibraryId"
            fallback-icon="BookCopy"
            :empty-text="t('components.sidebar.noLibraries')"
            :filter-label="t('components.sidebar.filterLibraries')"
            :filter-placeholder="t('components.sidebar.filterLibrariesPlaceholder')"
            :see-all-label="t('components.sidebar.seeAllLibraries', { count: formatNumber(libraries.length) })"
            :can-add="canManageLibraries"
            :add-label="t('components.sidebar.newLibrary')"
            :can-reorder="canManageLibraries"
            :persist-order="reorderLibraries"
            @add="openCreateLibrary"
            @navigate="handleNavigate"
          >
            <template #itemBadge="{ item }">
              <SidebarBadge v-if="isScanning(item.id)" variant="progress">{{ scanPct(item.id) }}%</SidebarBadge>
              <SidebarBadge v-else-if="typeof item.bookCount === 'number'">{{ formatCompactNumber(item.bookCount) }}</SidebarBadge>
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
            :items="smartScopes"
            route-name="smartScope"
            index-route-name="smart-scopes"
            :active-id="activeSmartScopeId"
            fallback-icon="Aperture"
            :empty-text="t('components.sidebar.noSmartScopes')"
            :filter-label="t('components.sidebar.filterSmartScopes')"
            :filter-placeholder="t('components.sidebar.filterSmartScopesPlaceholder')"
            :see-all-label="t('components.sidebar.seeAllSmartScopes', { count: formatNumber(smartScopes.length) })"
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
            :items="collections"
            route-name="collection"
            index-route-name="collections"
            :active-id="activeCollectionId"
            fallback-icon="FolderOpen"
            :empty-text="t('components.sidebar.noCollections')"
            :filter-label="t('components.sidebar.filterCollections')"
            :filter-placeholder="t('components.sidebar.filterCollectionsPlaceholder')"
            :see-all-label="t('components.sidebar.seeAllCollections', { count: formatNumber(collections.length) })"
            can-add
            :add-label="t('components.sidebar.newCollection')"
            can-reorder
            :persist-order="persistCollectionOrder"
            @add="openCreateCollection"
            @navigate="handleNavigate"
          />
        </template>
      </template>
    </SidebarContent>

    <SidebarFooter v-if="!isSettingsRoute" class="border-t border-sidebar-border px-4 py-2 group-data-[collapsible=icon]:px-2">
      <div
        class="grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)_1.75rem] items-center gap-2 group-data-[collapsible=icon]:grid-cols-1 group-data-[collapsible=icon]:justify-items-center group-data-[collapsible=icon]:gap-1"
      >
        <SidebarGithubStar :is-rail="isRail" />

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

        <Tooltip>
          <TooltipTrigger as-child>
            <a
              :href="SUPPORT_URL"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="t('components.sidebar.supportAria')"
              class="inline-flex h-7 w-7 shrink-0 items-center justify-center justify-self-end rounded-md text-destructive outline-hidden transition-colors duration-150 hover:bg-(--shell-accent-wash) focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:justify-self-center"
            >
              <Heart :size="16" class="fill-current" aria-hidden="true" />
            </a>
          </TooltipTrigger>
          <TooltipContent :side="isRail ? 'right' : 'top'">{{ t('components.sidebar.support') }}</TooltipContent>
        </Tooltip>
      </div>
    </SidebarFooter>

    <SidebarRail />
  </Sidebar>
</template>
