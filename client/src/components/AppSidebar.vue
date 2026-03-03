<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as Icons from 'lucide-vue-next'
import { Aperture, FolderOpen, LayoutDashboard, PackageOpen, Plus } from 'lucide-vue-next'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useLenses } from '@/features/lens/composables/useLenses'
import { useCollections } from '@/features/collection/composables/useCollections'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useScanProgress, getSocket } from '@/features/scanner/composables/useScanProgress'
import { useStagingSummary } from '@/features/staging/composables/useStagingSummary'
import type { Library } from '@projectx/types'
import CreateLensDialog from '@/features/lens/components/CreateLensDialog.vue'
import CreateCollectionDialog from '@/features/collection/components/CreateCollectionDialog.vue'
import LibraryCreatorModal from '@/features/library/components/LibraryCreatorModal.vue'

function getCollectionIcon(iconName: string | null) {
  if (iconName) {
    const found = (Icons as Record<string, unknown>)[iconName]
    if (found) return found
  }
  return FolderOpen
}

const router = useRouter()
const route = useRoute()
const { libraries, fetchLibraries, refreshLibraries } = useLibraries()
const { lenses, fetchLenses } = useLenses()
const { collections, fetchCollections } = useCollections()
const { hasPermission } = usePermissions()
const { subscribeLibrary, getProgress, progressMap } = useScanProgress()
const { summary: stagingSummary, fetchSummary: fetchStagingSummary, subscribe: subscribeStagingSummary } = useStagingSummary()

const createLensOpen = ref(false)
const createCollectionOpen = ref(false)
const createLibraryOpen = ref(false)
const scanningLibraryId = ref<number | null>(null)

const activeLibraryId = computed(() => {
  const id = route.params.id
  return route.name === 'library' && id ? Number(id) : null
})

const isDashboardActive = computed(() => route.name === 'dashboard')
const isStagingActive = computed(() => route.name === 'staging')

const activeLensId = computed(() => {
  const id = route.params.id
  return route.name === 'lens' && id ? Number(id) : null
})

function getLibraryIcon(name: string | null | undefined) {
  if (name && name in Icons) return (Icons as Record<string, unknown>)[name]
  return Icons.BookCopy
}

function getLensIcon(name: string | null | undefined) {
  if (name && name in Icons) return (Icons as Record<string, unknown>)[name]
  return Aperture
}

const activeCollectionId = computed(() => {
  const id = route.params.id
  return route.name === 'collection' && id ? Number(id) : null
})

function scanPct(libraryId: number): number {
  const p = getProgress(libraryId)
  if (!p || p.total === 0) return 0
  return Math.floor((p.processed / p.total) * 100)
}

function onLibrarySaved(library: Library) {
  createLibraryOpen.value = false
  subscribeLibrary(library.id)
  scanningLibraryId.value = library.id
  refreshLibraries()
}

watch(progressMap, (map) => {
  if (scanningLibraryId.value === null) return
  const event = map.get(scanningLibraryId.value)
  if (event?.status === 'completed') {
    const id = scanningLibraryId.value
    scanningLibraryId.value = null
    router.push({ name: 'library', params: { id } })
  }
})

onMounted(async () => {
  getSocket()
  await fetchLibraries()
  for (const lib of libraries.value) {
    subscribeLibrary(lib.id)
  }
  fetchLenses()
  fetchCollections()
  if (hasPermission('staging_access')) {
    fetchStagingSummary()
    subscribeStagingSummary()
  }
})
</script>

<template>
  <CreateLensDialog :open="createLensOpen" @close="createLensOpen = false" />
  <CreateCollectionDialog :open="createCollectionOpen" @close="createCollectionOpen = false" />
  <LibraryCreatorModal v-if="createLibraryOpen" @close="createLibraryOpen = false" @saved="onLibrarySaved" />

  <Sidebar
    collapsible="icon"
    style="--sidebar-border: color-mix(in oklch, var(--primary) 18%, transparent)"
    class="[&>div:last-child]:shadow-[4px_0_12px_-2px_oklch(0_0_0/0.08)]"
  >
    <SidebarHeader class="border-b border-sidebar-border bg-gradient-to-b from-primary/6 to-transparent">
      <div class="flex items-center gap-2.5 px-1 py-1">
        <!-- Logo mark -->
        <div
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-sm"
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
            Project<span class="text-primary"> X</span>
          </span>
        </div>
      </div>
    </SidebarHeader>

    <SidebarContent>
      <!-- Dashboard -->
      <SidebarGroup class="pt-2 pb-0">
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton :is-active="isDashboardActive" tooltip="Dashboard" class="gap-2.5" @click="router.push({ name: 'dashboard' })">
                <LayoutDashboard :size="15" :class="isDashboardActive ? 'text-sidebar-primary' : 'text-sidebar-foreground/50'" />
                <span :class="isDashboardActive ? 'font-medium text-sidebar-foreground' : 'text-sidebar-foreground/70'"> Dashboard </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem v-if="hasPermission('staging_access')">
              <SidebarMenuButton :is-active="isStagingActive" tooltip="Staging" class="gap-2.5" @click="router.push({ name: 'staging' })">
                <PackageOpen :size="15" :class="isStagingActive ? 'text-sidebar-primary' : 'text-sidebar-foreground/50'" />
                <span :class="isStagingActive ? 'font-medium text-sidebar-foreground' : 'text-sidebar-foreground/70'"> Staging </span>
                <span
                  v-if="stagingSummary.total > 0"
                  class="ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs tabular-nums group-data-[collapsible=icon]:hidden transition-colors"
                  :class="isStagingActive ? 'bg-primary/15 text-primary' : 'bg-sidebar-foreground/10 text-sidebar-foreground/70'"
                >
                  {{ stagingSummary.total }}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarSeparator class="group-data-[collapsible=icon]:hidden" />

      <!-- Libraries -->
      <SidebarGroup class="pt-2">
        <SidebarGroupLabel
          class="text-[10px] uppercase tracking-widest text-sidebar-foreground/75 font-semibold group-data-[collapsible=icon]:hidden"
        >
          Libraries
        </SidebarGroupLabel>
        <SidebarGroupAction v-if="hasPermission('manage_libraries')" tooltip="New Library" @click="createLibraryOpen = true">
          <Plus />
        </SidebarGroupAction>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="lib in libraries" :key="lib.id">
              <SidebarMenuButton
                :is-active="activeLibraryId === lib.id"
                :tooltip="getProgress(lib.id)?.status === 'running' ? `${lib.name} - Scanning ${scanPct(lib.id)}%` : lib.name"
                class="gap-2.5"
                @click="router.push({ name: 'library', params: { id: lib.id } })"
              >
                <component
                  :is="getLibraryIcon(lib.icon)"
                  :size="15"
                  :class="[
                    activeLibraryId === lib.id ? 'text-sidebar-primary' : 'text-sidebar-foreground/50',
                    getProgress(lib.id)?.status === 'running' ? 'animate-pulse' : '',
                  ]"
                />
                <span :class="activeLibraryId === lib.id ? 'font-medium text-sidebar-foreground' : 'text-sidebar-foreground/70'">
                  {{ lib.name }}
                </span>
                <span
                  v-if="getProgress(lib.id)?.status === 'running'"
                  class="ml-auto shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs tabular-nums text-primary group-data-[collapsible=icon]:hidden"
                >
                  {{ scanPct(lib.id) }}%
                </span>
                <span
                  v-else-if="lib.bookCount !== undefined"
                  class="ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs tabular-nums group-data-[collapsible=icon]:hidden transition-colors"
                  :class="activeLibraryId === lib.id ? 'bg-primary/15 text-primary' : 'bg-sidebar-foreground/10 text-sidebar-foreground/70'"
                >
                  {{ lib.bookCount.toLocaleString() }}
                </span>
              </SidebarMenuButton>
              <Transition name="scan-progress">
                <div v-if="getProgress(lib.id)?.status === 'running'" class="px-2 pb-1.5 group-data-[collapsible=icon]:hidden">
                  <div class="h-0.5 w-full rounded-full bg-sidebar-foreground/10 overflow-hidden">
                    <div
                      class="h-full rounded-full bg-primary transition-all duration-300"
                      :style="{
                        width: getProgress(lib.id)!.total > 0 ? `${scanPct(lib.id)}%` : '30%',
                        animation: getProgress(lib.id)!.total === 0 ? 'pulse 1.5s ease-in-out infinite' : 'none',
                      }"
                    />
                  </div>
                  <p class="mt-0.5 text-[10px] text-sidebar-foreground/45">
                    {{ getProgress(lib.id)!.processed.toLocaleString() }} / {{ getProgress(lib.id)!.total.toLocaleString() }} books
                  </p>
                </div>
              </Transition>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarSeparator class="group-data-[collapsible=icon]:hidden" />

      <!-- Lenses -->
      <SidebarGroup>
        <SidebarGroupLabel
          class="text-[10px] uppercase tracking-widest text-sidebar-foreground/75 font-semibold group-data-[collapsible=icon]:hidden"
        >
          Lenses
        </SidebarGroupLabel>
        <SidebarGroupAction tooltip="New Lens" @click="createLensOpen = true">
          <Plus />
        </SidebarGroupAction>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="lens in lenses" :key="lens.id">
              <SidebarMenuButton
                :is-active="activeLensId === lens.id"
                :tooltip="lens.name"
                class="gap-2.5"
                @click="router.push({ name: 'lens', params: { id: lens.id } })"
              >
                <component
                  :is="getLensIcon(lens.icon)"
                  :size="15"
                  :class="activeLensId === lens.id ? 'text-sidebar-primary' : 'text-sidebar-foreground/50'"
                />
                <span :class="activeLensId === lens.id ? 'font-medium text-sidebar-foreground' : 'text-sidebar-foreground/70'">
                  {{ lens.name }}
                </span>
                <span
                  v-if="lens.bookCount !== undefined"
                  class="ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs tabular-nums group-data-[collapsible=icon]:hidden transition-colors"
                  :class="activeLensId === lens.id ? 'bg-primary/15 text-primary' : 'bg-sidebar-foreground/10 text-sidebar-foreground/70'"
                >
                  {{ lens.bookCount.toLocaleString() }}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem v-if="lenses.length === 0">
              <span class="px-2 py-1 text-xs text-sidebar-foreground/35 group-data-[collapsible=icon]:hidden">No lenses yet</span>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarSeparator class="group-data-[collapsible=icon]:hidden" />

      <!-- Collections -->
      <SidebarGroup>
        <SidebarGroupLabel
          class="text-[10px] uppercase tracking-widest text-sidebar-foreground/75 font-semibold group-data-[collapsible=icon]:hidden"
        >
          Collections
        </SidebarGroupLabel>
        <SidebarGroupAction tooltip="New Collection" @click="createCollectionOpen = true">
          <Plus />
        </SidebarGroupAction>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="collection in collections" :key="collection.id">
              <SidebarMenuButton
                :is-active="activeCollectionId === collection.id"
                :tooltip="collection.name"
                class="gap-2.5"
                @click="router.push({ name: 'collection', params: { id: collection.id } })"
              >
                <component
                  :is="getCollectionIcon(collection.icon)"
                  :size="15"
                  :class="activeCollectionId === collection.id ? 'text-sidebar-primary' : 'text-sidebar-foreground/50'"
                />
                <span :class="activeCollectionId === collection.id ? 'font-medium text-sidebar-foreground' : 'text-sidebar-foreground/70'">
                  {{ collection.name }}
                </span>
                <span
                  class="ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs tabular-nums group-data-[collapsible=icon]:hidden transition-colors"
                  :class="activeCollectionId === collection.id ? 'bg-primary/15 text-primary' : 'bg-sidebar-foreground/10 text-sidebar-foreground/70'"
                >
                  {{ collection.bookCount.toLocaleString() }}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem v-if="collections.length === 0">
              <span class="px-2 py-1 text-xs text-sidebar-foreground/35 group-data-[collapsible=icon]:hidden">No collections yet</span>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
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
