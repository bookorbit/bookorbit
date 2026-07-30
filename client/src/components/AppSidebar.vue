<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { Aperture, BookCopy, FolderOpen, Heart, Orbit } from '@lucide/vue'
import { formatCompactNumber, formatNumber } from '@/i18n/formatters'
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail, SidebarSeparator, useSidebar } from '@/components/ui/sidebar'
import SidebarZone from '@/components/sidebar/SidebarZone.vue'
import SidebarNavItem from '@/components/sidebar/SidebarNavItem.vue'
import SidebarBadge from '@/components/sidebar/SidebarBadge.vue'
import SidebarEntitySection from '@/components/sidebar/SidebarEntitySection.vue'
import SidebarSectionPopover from '@/components/sidebar/SidebarSectionPopover.vue'
import { buildSidebarVersionUi } from '@/components/sidebar/versionUi'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSidebarNav } from '@/composables/useSidebarNav'
import { useBrowseCounts } from '@/composables/useBrowseCounts'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useLibraryScanRefresh } from '@/features/library/composables/useLibraryScanRefresh'
import { useSmartScopes } from '@/features/smart-scope/composables/useSmartScopes'
import { useCollections } from '@/features/collection/composables/useCollections'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useScanProgress, getSocket } from '@/features/scanner/composables/useScanProgress'
import { useLibraryUploadEvents } from '@/features/library/composables/useLibraryUploadEvents'
import { useBookDockSummary } from '@/features/book-dock/composables/useBookDockSummary'
import type { Library } from '@bookorbit/types'
import CreateSmartScopeDialog from '@/features/smart-scope/components/CreateSmartScopeDialog.vue'
import CreateCollectionDialog from '@/features/collection/components/CreateCollectionDialog.vue'
import LibraryCreatorModal from '@/features/library/components/LibraryCreatorModal.vue'
import { useLibraryCreationRedirect } from '@/features/library/composables/useLibraryCreationRedirect'
import { useAppInfo } from '@/features/settings/composables/useAppInfo'
import { useWhatsNew } from '@/features/whats-new/composables/useWhatsNew'

const { t } = useI18n()
const route = useRoute()
const { state, isMobile, setOpenMobile } = useSidebar()
const { zones } = useSidebarNav()
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

const createSmartScopeOpen = ref(false)
const createCollectionOpen = ref(false)
const createLibraryOpen = ref(false)

const isRail = computed(() => state.value === 'collapsed' && !isMobile.value)
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
  void loadAppInfo()
  if (hasPermission('book_dock_access')) {
    void fetchBookDockSummary()
    subscribeBookDockSummary()
  }
})

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
      <div class="flex h-9 items-center gap-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0">
        <div
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--shell-radius) bg-primary ring-1 ring-(--shell-accent-line)"
          aria-hidden="true"
        >
          <Orbit :size="21" class="text-primary-foreground" />
        </div>
        <span class="truncate font-serif text-[18px] font-semibold leading-none text-sidebar-foreground group-data-[collapsible=icon]:hidden">
          Book<span class="text-primary"> Orbit</span>
        </span>
      </div>
    </SidebarHeader>

    <SidebarContent>
      <!-- Fixed destinations come first: they are a known height, so the variable-length
           entity sections below can never push them out of the first screenful. -->
      <SidebarZone v-for="zone in zones" :key="zone.id" :label="zone.labelKey ? t(zone.labelKey) : null">
        <SidebarNavItem
          v-for="entry in zone.entries"
          :key="entry.id"
          :is-active="entry.isActive"
          :tooltip="entry.label"
          :to="entry.to"
          :icon="entry.icon"
          :label="entry.label"
          :data-tour="entry.tourId"
          @navigate="handleNavigate"
        >
          <template #badge>
            <SidebarBadge v-if="entry.badge !== null">{{ formatCompactNumber(entry.badge) }}</SidebarBadge>
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
          :persist-order="reorderCollections"
          @add="openCreateCollection"
          @navigate="handleNavigate"
        />
      </template>
    </SidebarContent>

    <SidebarFooter class="border-t border-sidebar-border px-4 py-2 group-data-[collapsible=icon]:px-2">
      <div class="hidden justify-center group-data-[collapsible=icon]:flex">
        <Tooltip>
          <TooltipTrigger as-child>
            <a
              :href="SUPPORT_URL"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="t('components.sidebar.supportAria')"
              class="inline-flex h-8 w-8 items-center justify-center rounded-md text-destructive outline-hidden transition-colors duration-150 hover:bg-(--shell-accent-wash) focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <Heart :size="18" class="fill-current" aria-hidden="true" />
            </a>
          </TooltipTrigger>
          <TooltipContent side="right">{{ t('components.sidebar.support') }}</TooltipContent>
        </Tooltip>
      </div>

      <div class="flex h-7 min-w-0 items-center gap-2 group-data-[collapsible=icon]:hidden">
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

        <a
          v-if="versionUi.showUpdate"
          :href="versionUi.updateHref"
          target="_blank"
          rel="noopener noreferrer"
          class="ml-auto inline-flex min-w-0 items-center rounded-md border border-(--shell-accent-line) bg-(--shell-accent-tint) px-1.5 py-0.5 text-[11px] font-semibold text-primary outline-hidden transition-colors duration-150 hover:bg-(--shell-accent-wash) focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <span class="truncate">{{ t('components.sidebar.updateAvailable', { version: versionUi.updateVersionLabel }) }}</span>
        </a>

        <a
          v-else
          :href="SUPPORT_URL"
          target="_blank"
          rel="noopener noreferrer"
          :aria-label="t('components.sidebar.supportAria')"
          class="ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-destructive outline-hidden transition-colors duration-150 hover:bg-(--shell-accent-wash) focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <Heart :size="16" class="fill-current" aria-hidden="true" />
        </a>
      </div>
    </SidebarFooter>

    <SidebarRail />
  </Sidebar>
</template>
