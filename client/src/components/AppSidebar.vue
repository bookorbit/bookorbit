<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as Icons from 'lucide-vue-next'
import { VueDraggable } from 'vue-draggable-plus'
import {
  Sidebar,
  SidebarContent,
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
import { useLenses } from '@/features/lens/composables/useLenses'
import { useCollections } from '@/features/collection/composables/useCollections'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useScanProgress, getSocket } from '@/features/scanner/composables/useScanProgress'
import { useLibraryUploadEvents } from '@/features/library/composables/useLibraryUploadEvents'
import { useDraggableOrder } from '@/composables/useDraggableOrder'
import type { Library } from '@projectx/types'
import CreateLensDialog from '@/features/lens/components/CreateLensDialog.vue'
import CreateCollectionDialog from '@/features/collection/components/CreateCollectionDialog.vue'
import LibraryCreatorModal from '@/features/library/components/LibraryCreatorModal.vue'
import { useLibraryCreationRedirect } from '@/features/library/composables/useLibraryCreationRedirect'
import { useThemeStore } from '@/stores/theme'

function resolveIcon(name: string | null | undefined, fallback: Component): Component {
  if (name && name in Icons) return (Icons as Record<string, unknown>)[name] as Component
  return fallback
}

function useSidebarSection(key: string) {
  const isOpen = ref(localStorage.getItem(`projectx:sidebar:${key}`) !== 'false')
  function toggle() {
    isOpen.value = !isOpen.value
    localStorage.setItem(`projectx:sidebar:${key}`, String(isOpen.value))
  }
  return { isOpen, toggle }
}

const router = useRouter()
const route = useRoute()
const { isMobile, setOpenMobile } = useSidebar()
const { libraries, fetchLibraries, refreshLibraries, reorderLibraries } = useLibraries()
const { lenses, fetchLenses, reorderLenses } = useLenses()
const { collections, fetchCollections, reorderCollections } = useCollections()
const { hasPermission } = usePermissions()
const { subscribeLibrary, getProgress, progressMap } = useScanProgress()
const { handleLibraryCreated } = useLibraryCreationRedirect()
const themeStore = useThemeStore()

const iconRadiusClass = computed(() => (themeStore.radius === 'sharp' ? 'rounded-none' : 'rounded-full'))

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

const createLensOpen = ref(false)
const createCollectionOpen = ref(false)
const createLibraryOpen = ref(false)

const { isOpen: librariesOpen, toggle: toggleLibraries } = useSidebarSection('libraries')
const { isOpen: lensesOpen, toggle: toggleLenses } = useSidebarSection('lenses')
const { isOpen: collectionsOpen, toggle: toggleCollections } = useSidebarSection('collections')

const isReorderingLibraries = ref(false)
const isReorderingLenses = ref(false)
const isReorderingCollections = ref(false)

const {
  localItems: localLibraries,
  onDragStart: onLibraryDragStart,
  onDragEnd: onLibraryDragEnd,
} = useDraggableOrder({ source: libraries, persist: reorderLibraries })

const {
  localItems: localLenses,
  onDragStart: onLensDragStart,
  onDragEnd: onLensDragEnd,
} = useDraggableOrder({ source: lenses, persist: reorderLenses })

const {
  localItems: localCollections,
  onDragStart: onCollectionDragStart,
  onDragEnd: onCollectionDragEnd,
} = useDraggableOrder({ source: collections, persist: reorderCollections })

const isDashboardActive = computed(() => route.name === 'dashboard')
const isAuthorsActive = computed(() => route.name === 'authors' || route.name === 'author-detail')

const activeLibraryId = computed(() => {
  const id = route.params.id
  return route.name === 'library' && id ? Number(id) : null
})

const activeLensId = computed(() => {
  const id = route.params.id
  return route.name === 'lens' && id ? Number(id) : null
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
  fetchLenses()
  fetchCollections()
})

const stopLibraryUploadListener = onLibraryUploadCompleted((event) => {
  if (event.uploadedCount > 0) {
    refreshLibraries()
  }
})

onUnmounted(() => stopLibraryUploadListener())
</script>

<template>
  <CreateLensDialog :open="createLensOpen" @close="createLensOpen = false" />
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
          <svg viewBox="0 0 20 20" fill="none" class="h-4 w-4" aria-hidden="true">
            <path
              d="M5 2.5A1.5 1.5 0 016.5 1h9A1.5 1.5 0 0117 2.5v15a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 015 17.5V2.5z"
              fill="var(--primary-foreground)"
              opacity="0.25"
            />
            <path d="M3 4a1 1 0 011-1h8.5A1.5 1.5 0 0114 4.5V17a1.5 1.5 0 01-1.5 1.5H4a1 1 0 01-1-1V4z" fill="var(--primary-foreground)" />
            <line x1="6" y1="7.5" x2="11.5" y2="7.5" stroke="var(--primary)" stroke-width="1.3" stroke-linecap="round" />
            <line x1="6" y1="10.5" x2="11.5" y2="10.5" stroke="var(--primary)" stroke-width="1.3" stroke-linecap="round" opacity="0.7" />
            <line x1="6" y1="13.5" x2="9.5" y2="13.5" stroke="var(--primary)" stroke-width="1.3" stroke-linecap="round" opacity="0.4" />
          </svg>
        </div>
        <!-- Brand name -->
        <div class="flex flex-col leading-none group-data-[collapsible=icon]:hidden">
          <span class="text-lg font-serif font-semibold text-sidebar-foreground leading-tight tracking-tight">
            Project<span class="text-primary"> Q</span>
          </span>
          <span class="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-sidebar-foreground/65">Library Control</span>
        </div>
      </div>
    </SidebarHeader>

    <SidebarContent>
      <!-- Dashboard / Book Bucket / Authors -->
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
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
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarSeparator />

      <!-- Libraries -->
      <SidebarGroup>
        <SidebarSectionHeader
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
        <div v-show="librariesOpen">
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
                :icon="resolveIcon(lib.icon, Icons.BookCopy)"
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
      </SidebarGroup>

      <SidebarSeparator />

      <!-- Lenses -->
      <SidebarGroup>
        <SidebarSectionHeader
          label="Lenses"
          :is-open="lensesOpen"
          :collapsed-count="lenses.length"
          :can-add="true"
          add-title="New Lens"
          :can-reorder="lenses.length > 1"
          :is-reordering="isReorderingLenses"
          @toggle="toggleLenses"
          @add="createLensOpen = true"
          @toggle-reorder="isReorderingLenses = !isReorderingLenses"
        />
        <div v-show="lensesOpen">
          <SidebarGroupContent>
            <VueDraggable
              v-model="localLenses"
              tag="ul"
              :animation="150"
              handle=".drag-handle"
              :disabled="!isReorderingLenses"
              class="contents"
              @start="onLensDragStart"
              @end="onLensDragEnd"
            >
              <SidebarNavItem
                v-for="lens in localLenses"
                :key="lens.id"
                :is-active="activeLensId === lens.id"
                :tooltip="lens.name"
                :icon="resolveIcon(lens.icon, Icons.Aperture)"
                :label="lens.name"
                @click="navigateFromSidebar({ name: 'lens', params: { id: lens.id } })"
              >
                <template #badge>
                  <span
                    v-if="lens.bookCount != null && lens.bookCount > 0"
                    class="ml-auto shrink-0 rounded-md bg-sidebar-foreground/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-sidebar-foreground/80 transition-colors group-data-[active=true]/item:bg-primary/20 group-data-[active=true]/item:text-primary group-data-[collapsible=icon]:hidden"
                  >
                    {{ lens.bookCount.toLocaleString() }}
                  </span>
                  <Icons.GripVertical
                    v-if="isReorderingLenses"
                    class="drag-handle ml-1 h-3.5 w-3.5 shrink-0 cursor-grab text-primary/60 group-data-[collapsible=icon]:hidden"
                    @click.stop
                  />
                </template>
              </SidebarNavItem>
            </VueDraggable>
            <div v-if="localLenses.length === 0">
              <span class="px-2 py-1 text-[11px] text-sidebar-foreground/40 group-data-[collapsible=icon]:hidden">No lenses yet</span>
            </div>
          </SidebarGroupContent>
        </div>
      </SidebarGroup>

      <SidebarSeparator />

      <!-- Collections -->
      <SidebarGroup>
        <SidebarSectionHeader
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
        <div v-show="collectionsOpen">
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
                :icon="resolveIcon(collection.icon, Icons.FolderOpen)"
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
      </SidebarGroup>
    </SidebarContent>

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
