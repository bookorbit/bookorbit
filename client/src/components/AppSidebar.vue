<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as Icons from '@lucide/vue'
import { VueDraggable } from 'vue-draggable-plus'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar'
import SidebarNavItem from '@/components/sidebar/SidebarNavItem.vue'
import SidebarSectionHeader from '@/components/sidebar/SidebarSectionHeader.vue'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useSmartScopes } from '@/features/smart-scope/composables/useSmartScopes'
import { useCollections } from '@/features/collection/composables/useCollections'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useScanProgress, getSocket } from '@/features/scanner/composables/useScanProgress'
import { useLibraryUploadEvents } from '@/features/library/composables/useLibraryUploadEvents'
import { useDraggableOrder } from '@/composables/useDraggableOrder'
import type { Library } from '@bookorbit/types'
import CreateSmartScopeDialog from '@/features/smart-scope/components/CreateSmartScopeDialog.vue'
import CreateCollectionDialog from '@/features/collection/components/CreateCollectionDialog.vue'
import LibraryCreatorModal from '@/features/library/components/LibraryCreatorModal.vue'
import { useLibraryCreationRedirect } from '@/features/library/composables/useLibraryCreationRedirect'
import { useThemeStore } from '@/stores/theme'
import { useAppInfo } from '@/features/settings/composables/useAppInfo'
import { buildSidebarVersionUi } from '@/components/sidebar/versionUi'
import { useWhatsNew } from '@/features/whats-new/composables/useWhatsNew'

function useSidebarSection(key: string) {
  const isOpen = ref(localStorage.getItem(`bookorbit:sidebar:${key}`) !== 'false')
  function toggle() {
    isOpen.value = !isOpen.value
    localStorage.setItem(`bookorbit:sidebar:${key}`, String(isOpen.value))
  }
  return { isOpen, toggle }
}

const router = useRouter()
const route = useRoute()
const { isMobile, setOpenMobile } = useSidebar()
const { libraries, fetchLibraries, refreshLibraries, reorderLibraries } = useLibraries()
const { smartScopes, fetchSmartScopes, reorderSmartScopes } = useSmartScopes()
const { collections, fetchCollections, reorderCollections } = useCollections()
const { hasPermission } = usePermissions()
const { subscribeLibrary, getProgress, progressMap } = useScanProgress()
const { handleLibraryCreated } = useLibraryCreationRedirect()
const themeStore = useThemeStore()
const { version, updateAvailable, latestVersion, loadAppInfo } = useAppInfo()
const { hasUnseen: hasUnseenWhatsNew } = useWhatsNew()

const iconRadiusClass = computed(() => (themeStore.radius === 'sharp' ? 'rounded-none' : 'rounded-full'))
const versionUi = computed(() => {
  return buildSidebarVersionUi(version.value, updateAvailable.value, latestVersion.value)
})

const refreshedFor = new Set<number>()
watch(progressMap, (map) => {
  for (const [libraryId, event] of map.entries()) {
    if (event.status === 'completed' && !refreshedFor.has(libraryId)) {
      refreshedFor.add(libraryId)
      refreshLibraries()
      setTimeout(() => refreshedFor.delete(libraryId), 5000)
    }
  }
})
const { onLibraryUploadCompleted } = useLibraryUploadEvents()

const createSmartScopeOpen = ref(false)
const createCollectionOpen = ref(false)
const createLibraryOpen = ref(false)

const { isOpen: librariesOpen, toggle: toggleLibraries } = useSidebarSection('libraries')
const { isOpen: smartScopesOpen, toggle: toggleSmartScopes } = useSidebarSection('smart-scopes')
const { isOpen: collectionsOpen, toggle: toggleCollections } = useSidebarSection('collections')

const isReorderingLibraries = ref(false)
const isReorderingSmartScopes = ref(false)
const isReorderingCollections = ref(false)

const {
  localItems: localLibraries,
  onDragStart: onLibraryDragStart,
  onDragEnd: onLibraryDragEnd,
} = useDraggableOrder({ source: libraries, persist: reorderLibraries })

const {
  localItems: localSmartScopes,
  onDragStart: onSmartScopeDragStart,
  onDragEnd: onSmartScopeDragEnd,
} = useDraggableOrder({ source: smartScopes, persist: reorderSmartScopes })

const {
  localItems: localCollections,
  onDragStart: onCollectionDragStart,
  onDragEnd: onCollectionDragEnd,
} = useDraggableOrder({ source: collections, persist: reorderCollections })

const isDashboardActive = computed(() => route.name === 'dashboard')
const isAuthorsActive = computed(() => route.name === 'authors' || route.name === 'author-detail')
const isSeriesActive = computed(() => route.name === 'series' || route.name === 'series-detail')
const isToolsActive = computed(() => typeof route.name === 'string' && route.name.startsWith('tools-'))

const activeLibraryId = computed(() => {
  const id = route.params.id
  return route.name === 'library' && id ? Number(id) : null
})

const activeSmartScopeId = computed(() => {
  const id = route.params.id
  return route.name === 'smartScope' && id ? Number(id) : null
})

const activeCollectionId = computed(() => {
  const id = route.params.id
  return route.name === 'collection' && id ? Number(id) : null
})

function scanPct(libraryId: number): number {
  const p = getProgress(libraryId)
  if (!p || p.total === 0) return 0
  return Math.floor((p.processed / p.total) * 100)
}

function navigateFromSidebar(to: { name: string; params?: Record<string, string | number> }) {
  void router.push(to)
  if (isMobile.value) setOpenMobile(false)
}

async function onLibrarySaved(library: Library) {
  createLibraryOpen.value = false
  subscribeLibrary(library.id)
  await handleLibraryCreated(library)
}

onMounted(async () => {
  getSocket()
  await fetchLibraries()
  for (const lib of libraries.value) {
    subscribeLibrary(lib.id)
  }
  fetchSmartScopes()
  fetchCollections()
  loadAppInfo()
})

const stopLibraryUploadListener = onLibraryUploadCompleted((event) => {
  if (event.uploadedCount > 0) {
    refreshLibraries()
  }
})

onUnmounted(() => stopLibraryUploadListener())
</script>

<template>
  <CreateSmartScopeDialog :open="createSmartScopeOpen" @close="createSmartScopeOpen = false" />
  <CreateCollectionDialog :open="createCollectionOpen" @close="createCollectionOpen = false" />
  <LibraryCreatorModal v-if="createLibraryOpen" @close="createLibraryOpen = false" @saved="onLibrarySaved" />

  <Sidebar variant="floating" collapsible="icon" style="--sidebar-border: color-mix(in oklch, var(--primary) 18%, transparent)">
    <SidebarHeader class="border-b border-sidebar-border/80 bg-linear-to-b from-primary/10 via-primary/4 to-transparent rounded-t-xl">
      <div
        class="flex items-center gap-2.5 px-1.5 py-1.5 group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center"
      >
        <!-- Logo mark -->
        <div
          class="flex h-8.5 w-8.5 shrink-0 items-center justify-center shadow-sm ring-1 ring-black/5 dark:ring-white/10"
          :class="iconRadiusClass"
          style="background: linear-gradient(135deg, var(--primary) 0%, color-mix(in oklch, var(--primary) 75%, transparent) 100%)"
        >
          <Icons.Orbit class="h-5 w-5 text-primary-foreground" />
        </div>
        <!-- Brand name -->
        <div class="flex flex-col leading-none group-data-[collapsible=icon]:hidden">
          <span class="text-lg font-serif font-semibold text-sidebar-foreground leading-tight tracking-tight">
            Book<span class="text-primary"> Orbit</span>
          </span>
          <span class="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-sidebar-foreground/65">Your Reading Space</span>
        </div>
      </div>
    </SidebarHeader>

    <SidebarContent>
      <!-- Dashboard / Book Dock / Authors -->
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu class="gap-0">
            <SidebarNavItem
              :is-active="isDashboardActive"
              tooltip="Dashboard"
              :icon="Icons.LayoutDashboard"
              label="Dashboard"
              @click="navigateFromSidebar({ name: 'dashboard' })"
            />
            <SidebarNavItem
              :is-active="isAuthorsActive"
              tooltip="Authors"
              :icon="Icons.Users"
              label="Authors"
              @click="navigateFromSidebar({ name: 'authors' })"
            />
            <SidebarNavItem
              :is-active="isSeriesActive"
              tooltip="Series"
              :icon="Icons.Library"
              label="Series"
              @click="navigateFromSidebar({ name: 'series' })"
            />
            <SidebarNavItem
              v-if="hasPermission('manage_libraries')"
              :is-active="isToolsActive"
              tooltip="Tools"
              :icon="Icons.Wrench"
              label="Tools"
              @click="navigateFromSidebar({ name: 'tools-entity-manager' })"
            />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarSeparator />

      <!-- Libraries -->
      <SidebarGroup>
        <SidebarSectionHeader
          data-tour="sidebar-libraries"
          label="Libraries"
          :is-open="librariesOpen"
          :collapsed-count="libraries.length"
          :can-add="hasPermission('manage_libraries')"
          add-title="New Library"
          :can-reorder="hasPermission('manage_libraries')"
          :is-reordering="isReorderingLibraries"
          @toggle="toggleLibraries"
          @add="createLibraryOpen = true"
          @toggle-reorder="isReorderingLibraries = !isReorderingLibraries"
        />
        <Transition name="section">
          <div v-if="librariesOpen">
            <SidebarGroupContent>
              <VueDraggable
                v-model="localLibraries"
                tag="ul"
                :animation="150"
                handle=".drag-handle"
                :disabled="!isReorderingLibraries"
                class="contents"
                @start="onLibraryDragStart"
                @end="onLibraryDragEnd"
              >
                <SidebarNavItem
                  v-for="lib in localLibraries"
                  :key="lib.id"
                  :is-active="activeLibraryId === lib.id"
                  :tooltip="getProgress(lib.id)?.status === 'running' ? `${lib.name} - Scanning ${scanPct(lib.id)}%` : lib.name"
                  :icon="lib.icon || 'BookCopy'"
                  fallback-icon="BookCopy"
                  :icon-class="''"
                  :label="lib.name"
                  @click="navigateFromSidebar({ name: 'library', params: { id: lib.id } })"
                >
                  <template #badge>
                    <span
                      v-if="getProgress(lib.id)?.status === 'running'"
                      class="ml-auto shrink-0 rounded-md bg-primary/20 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-primary group-data-[collapsible=icon]:hidden"
                    >
                      {{ scanPct(lib.id) }}%
                    </span>
                    <span
                      v-else-if="lib.bookCount !== undefined"
                      class="ml-auto shrink-0 rounded-md bg-sidebar-foreground/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-sidebar-foreground/80 transition-colors group-data-[active=true]/item:bg-primary/20 group-data-[active=true]/item:text-primary group-data-[collapsible=icon]:hidden"
                    >
                      {{ lib.bookCount.toLocaleString() }}
                    </span>
                    <Icons.GripVertical
                      v-if="isReorderingLibraries"
                      class="drag-handle ml-1 h-3.5 w-3.5 shrink-0 cursor-grab text-primary/60 group-data-[collapsible=icon]:hidden"
                      @click.stop
                    />
                  </template>
                  <template #extra>
                    <Transition name="scan-progress">
                      <div v-if="getProgress(lib.id)?.status === 'running'" class="px-2 pb-1.5 group-data-[collapsible=icon]:hidden">
                        <div class="h-0.5 w-full rounded-full bg-sidebar-foreground/10 overflow-hidden">
                          <div
                            class="h-full rounded-full bg-primary"
                            :style="{
                              width: getProgress(lib.id)!.total > 0 ? `${scanPct(lib.id)}%` : '30%',
                              animation: 'none',
                            }"
                          />
                        </div>
                        <p class="mt-0.5 text-[10px] text-sidebar-foreground/45">
                          {{ getProgress(lib.id)!.processed.toLocaleString() }} / {{ getProgress(lib.id)!.total.toLocaleString() }} books
                        </p>
                      </div>
                    </Transition>
                  </template>
                </SidebarNavItem>
              </VueDraggable>
            </SidebarGroupContent>
          </div>
        </Transition>
      </SidebarGroup>

      <SidebarSeparator />

      <!-- SmartScopes -->
      <SidebarGroup>
        <SidebarSectionHeader
          data-tour="sidebar-smartScopes"
          label="Smart Scopes"
          :is-open="smartScopesOpen"
          :collapsed-count="smartScopes.length"
          :can-add="true"
          add-title="New Smart Scope"
          :can-reorder="smartScopes.length > 1"
          :is-reordering="isReorderingSmartScopes"
          @toggle="toggleSmartScopes"
          @add="createSmartScopeOpen = true"
          @toggle-reorder="isReorderingSmartScopes = !isReorderingSmartScopes"
        />
        <Transition name="section">
          <div v-if="smartScopesOpen">
            <SidebarGroupContent>
              <VueDraggable
                v-model="localSmartScopes"
                tag="ul"
                :animation="150"
                handle=".drag-handle"
                :disabled="!isReorderingSmartScopes"
                class="contents"
                @start="onSmartScopeDragStart"
                @end="onSmartScopeDragEnd"
              >
                <SidebarNavItem
                  v-for="smartScope in localSmartScopes"
                  :key="smartScope.id"
                  :is-active="activeSmartScopeId === smartScope.id"
                  :tooltip="smartScope.name"
                  :icon="smartScope.icon || 'Aperture'"
                  fallback-icon="Aperture"
                  :label="smartScope.name"
                  @click="navigateFromSidebar({ name: 'smartScope', params: { id: smartScope.id } })"
                >
                  <template #badge>
                    <span
                      v-if="smartScope.bookCount != null && smartScope.bookCount > 0"
                      class="ml-auto shrink-0 rounded-md bg-sidebar-foreground/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-sidebar-foreground/80 transition-colors group-data-[active=true]/item:bg-primary/20 group-data-[active=true]/item:text-primary group-data-[collapsible=icon]:hidden"
                    >
                      {{ smartScope.bookCount.toLocaleString() }}
                    </span>
                    <Icons.GripVertical
                      v-if="isReorderingSmartScopes"
                      class="drag-handle ml-1 h-3.5 w-3.5 shrink-0 cursor-grab text-primary/60 group-data-[collapsible=icon]:hidden"
                      @click.stop
                    />
                  </template>
                </SidebarNavItem>
              </VueDraggable>
              <div v-if="localSmartScopes.length === 0">
                <span class="px-2 py-1 text-[11px] text-sidebar-foreground/40 group-data-[collapsible=icon]:hidden">No Smart Scopes yet</span>
              </div>
            </SidebarGroupContent>
          </div>
        </Transition>
      </SidebarGroup>

      <SidebarSeparator />

      <!-- Collections -->
      <SidebarGroup>
        <SidebarSectionHeader
          data-tour="sidebar-collections"
          label="Collections"
          :is-open="collectionsOpen"
          :collapsed-count="collections.length"
          :can-add="true"
          add-title="New Collection"
          :can-reorder="collections.length > 1"
          :is-reordering="isReorderingCollections"
          @toggle="toggleCollections"
          @add="createCollectionOpen = true"
          @toggle-reorder="isReorderingCollections = !isReorderingCollections"
        />
        <Transition name="section">
          <div v-if="collectionsOpen">
            <SidebarGroupContent>
              <VueDraggable
                v-model="localCollections"
                tag="ul"
                :animation="150"
                handle=".drag-handle"
                :disabled="!isReorderingCollections"
                class="contents"
                @start="onCollectionDragStart"
                @end="onCollectionDragEnd"
              >
                <SidebarNavItem
                  v-for="collection in localCollections"
                  :key="collection.id"
                  :is-active="activeCollectionId === collection.id"
                  :tooltip="collection.name"
                  :icon="collection.icon || 'FolderOpen'"
                  fallback-icon="FolderOpen"
                  :label="collection.name"
                  @click="navigateFromSidebar({ name: 'collection', params: { id: collection.id } })"
                >
                  <template #badge>
                    <span
                      v-if="collection.bookCount > 0"
                      class="ml-auto shrink-0 rounded-md bg-sidebar-foreground/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-sidebar-foreground/80 transition-colors group-data-[active=true]/item:bg-primary/20 group-data-[active=true]/item:text-primary group-data-[collapsible=icon]:hidden"
                    >
                      {{ collection.bookCount.toLocaleString() }}
                    </span>
                    <Icons.GripVertical
                      v-if="isReorderingCollections"
                      class="drag-handle ml-1 h-3.5 w-3.5 shrink-0 cursor-grab text-primary/60 group-data-[collapsible=icon]:hidden"
                      @click.stop
                    />
                  </template>
                </SidebarNavItem>
              </VueDraggable>
              <div v-if="localCollections.length === 0">
                <span class="px-2 py-1 text-[11px] text-sidebar-foreground/40 group-data-[collapsible=icon]:hidden">No collections yet</span>
              </div>
            </SidebarGroupContent>
          </div>
        </Transition>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter v-if="versionUi.currentLabel" class="border-t border-sidebar-border/60">
      <div class="px-2 py-2 group-data-[collapsible=icon]:hidden">
        <div class="flex flex-wrap items-center justify-center gap-2 text-center text-[12px] font-medium leading-none text-sidebar-foreground/80">
          <RouterLink to="/whats-new" class="inline-flex items-center gap-1.5 transition-colors hover:text-sidebar-foreground">
            {{ versionUi.currentLabel }}
            <span v-if="hasUnseenWhatsNew" class="h-1.5 w-1.5 rounded-full bg-primary" aria-label="New release notes available" />
          </RouterLink>

          <span v-if="versionUi.showLatest" class="text-sidebar-foreground/45">•</span>

          <a
            v-if="versionUi.showLatest"
            :href="versionUi.latestHref"
            target="_blank"
            rel="noopener noreferrer"
            class="font-semibold text-primary transition-colors hover:text-primary/85"
          >
            Latest {{ versionUi.latestLabel }}
          </a>
        </div>
      </div>
    </SidebarFooter>

    <SidebarRail />
  </Sidebar>
</template>

<style scoped>
.scan-progress-enter-active {
  transition:
    opacity 0.25s ease,
    max-height 0.25s ease;
}
.scan-progress-leave-active {
  transition:
    opacity 0.35s ease,
    max-height 0.35s ease;
}
.scan-progress-enter-from,
.scan-progress-leave-to {
  opacity: 0;
  max-height: 0;
}
.scan-progress-enter-to,
.scan-progress-leave-from {
  opacity: 1;
  max-height: 2.5rem;
}
</style>
