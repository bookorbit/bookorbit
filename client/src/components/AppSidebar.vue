<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as Icons from 'lucide-vue-next'
import { Aperture, ChevronDown, FolderOpen, LayoutDashboard, PackageOpen, Plus } from 'lucide-vue-next'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
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

const librariesOpen = ref(localStorage.getItem('projectx:sidebar:libraries') !== 'false')
const lensesOpen = ref(localStorage.getItem('projectx:sidebar:lenses') !== 'false')
const collectionsOpen = ref(localStorage.getItem('projectx:sidebar:collections') !== 'false')

function toggleLibraries() {
  librariesOpen.value = !librariesOpen.value
  localStorage.setItem('projectx:sidebar:libraries', String(librariesOpen.value))
}
function toggleLenses() {
  lensesOpen.value = !lensesOpen.value
  localStorage.setItem('projectx:sidebar:lenses', String(lensesOpen.value))
}
function toggleCollections() {
  collectionsOpen.value = !collectionsOpen.value
  localStorage.setItem('projectx:sidebar:collections', String(collectionsOpen.value))
}

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

  <Sidebar variant="floating" collapsible="icon" style="--sidebar-border: color-mix(in oklch, var(--primary) 18%, transparent)">
    <SidebarHeader class="border-b border-sidebar-border/80 bg-gradient-to-b from-primary/10 via-primary/4 to-transparent rounded-t-xl">
      <div
        class="flex items-center gap-2.5 px-1.5 py-1.5 group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center"
      >
        <!-- Logo mark -->
        <div
          class="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-xl shadow-sm ring-1 ring-black/5 dark:ring-white/10"
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
          <span class="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-sidebar-foreground/50">Library Control</span>
        </div>
      </div>
    </SidebarHeader>

    <SidebarContent>
      <!-- Dashboard / Staging -->
      <SidebarGroup class="py-2">
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                :is-active="isDashboardActive"
                tooltip="Dashboard"
                class="relative h-9 gap-2.5 rounded-xl px-2 transition-[background-color,box-shadow] duration-200 before:absolute before:-left-1.5 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:scale-y-75 before:rounded-full before:bg-primary before:opacity-0 before:transition-all before:duration-200 hover:bg-primary/8 data-[active=true]:bg-primary/15 data-[active=true]:shadow-[inset_0_0_0_1px_var(--sidebar-border)] data-[active=true]:before:scale-y-100 data-[active=true]:before:opacity-100 group/item group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-1.5"
                @click="router.push({ name: 'dashboard' })"
              >
                <span class="inline-flex h-[1.65rem] w-[1.65rem] shrink-0 items-center justify-center rounded-lg transition-colors">
                  <LayoutDashboard
                    :size="16"
                    class="text-sidebar-foreground/70 transition-colors group-hover/item:text-sidebar-foreground group-data-[active=true]/item:text-primary"
                  />
                </span>
                <span
                  class="text-[13.5px] font-semibold tracking-[0.005em] text-sidebar-foreground/80 transition-colors group-hover/item:text-sidebar-foreground group-data-[active=true]/item:text-primary group-data-[collapsible=icon]:hidden"
                  >Dashboard</span
                >
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem v-if="hasPermission('staging_access')">
              <SidebarMenuButton
                :is-active="isStagingActive"
                tooltip="Staging"
                class="relative h-9 gap-2.5 rounded-xl px-2 transition-[background-color,box-shadow] duration-200 before:absolute before:-left-1.5 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:scale-y-75 before:rounded-full before:bg-primary before:opacity-0 before:transition-all before:duration-200 hover:bg-primary/8 data-[active=true]:bg-primary/15 data-[active=true]:shadow-[inset_0_0_0_1px_var(--sidebar-border)] data-[active=true]:before:scale-y-100 data-[active=true]:before:opacity-100 group/item group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-1.5"
                @click="router.push({ name: 'staging' })"
              >
                <span class="inline-flex h-[1.65rem] w-[1.65rem] shrink-0 items-center justify-center rounded-lg transition-colors">
                  <PackageOpen
                    :size="16"
                    class="text-sidebar-foreground/70 transition-colors group-hover/item:text-sidebar-foreground group-data-[active=true]/item:text-primary"
                  />
                </span>
                <span
                  class="text-[13.5px] font-semibold tracking-[0.005em] text-sidebar-foreground/80 transition-colors group-hover/item:text-sidebar-foreground group-data-[active=true]/item:text-primary group-data-[collapsible=icon]:hidden"
                  >Staging</span
                >
                <span
                  v-if="stagingSummary.total > 0"
                  class="ml-auto shrink-0 rounded-md bg-sidebar-foreground/10 px-1.5 py-px text-[11px] font-semibold tabular-nums text-sidebar-foreground/60 transition-colors group-data-[active=true]/item:bg-primary/20 group-data-[active=true]/item:text-primary group-data-[collapsible=icon]:hidden"
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
      <SidebarGroup class="py-2">
        <div class="flex h-8 items-center px-2 group-data-[collapsible=icon]:hidden">
          <button class="group/hdr flex min-w-0 flex-1 items-center gap-1.5" @click="toggleLibraries">
            <span
              class="text-[11px] font-bold uppercase tracking-[0.12em] text-sidebar-foreground/60 transition-colors group-hover/hdr:text-sidebar-foreground/90"
              >Libraries</span
            >
            <span v-if="!librariesOpen && libraries.length > 0" class="text-[11px] font-medium text-sidebar-foreground/40">
              ({{ libraries.length }})
            </span>
            <ChevronDown
              :size="13"
              :stroke-width="2.5"
              class="ml-auto shrink-0 text-sidebar-foreground/40 transition-transform duration-200 group-hover/hdr:text-sidebar-foreground/70"
              :class="librariesOpen ? 'rotate-0' : '-rotate-90'"
            />
          </button>
          <button
            v-if="hasPermission('manage_libraries')"
            class="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/40 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            title="New Library"
            @click="createLibraryOpen = true"
          >
            <Plus :size="14" :stroke-width="2.5" />
          </button>
        </div>
        <div v-show="librariesOpen">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="lib in libraries" :key="lib.id">
                <SidebarMenuButton
                  :is-active="activeLibraryId === lib.id"
                  :tooltip="getProgress(lib.id)?.status === 'running' ? `${lib.name} - Scanning ${scanPct(lib.id)}%` : lib.name"
                  class="relative h-9 gap-2.5 rounded-xl px-2 transition-[background-color,box-shadow] duration-200 before:absolute before:-left-1.5 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:scale-y-75 before:rounded-full before:bg-primary before:opacity-0 before:transition-all before:duration-200 hover:bg-primary/8 data-[active=true]:bg-primary/15 data-[active=true]:shadow-[inset_0_0_0_1px_var(--sidebar-border)] data-[active=true]:before:scale-y-100 data-[active=true]:before:opacity-100 group/item group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-1.5"
                  @click="router.push({ name: 'library', params: { id: lib.id } })"
                >
                  <span class="inline-flex h-[1.65rem] w-[1.65rem] shrink-0 items-center justify-center rounded-lg transition-colors">
                    <component
                      :is="getLibraryIcon(lib.icon)"
                      :size="17"
                      class="text-sidebar-foreground/70 transition-colors group-hover/item:text-sidebar-foreground group-data-[active=true]/item:text-primary"
                      :class="getProgress(lib.id)?.status === 'running' ? 'animate-pulse' : ''"
                    />
                  </span>
                  <span
                    class="text-[13.5px] font-semibold tracking-[0.005em] text-sidebar-foreground/80 transition-colors group-hover/item:text-sidebar-foreground group-data-[active=true]/item:text-primary group-data-[collapsible=icon]:hidden"
                  >
                    {{ lib.name }}
                  </span>
                  <span
                    v-if="getProgress(lib.id)?.status === 'running'"
                    class="ml-auto shrink-0 rounded-md bg-primary/20 px-1.5 py-px text-[11px] font-semibold tabular-nums text-primary group-data-[collapsible=icon]:hidden"
                  >
                    {{ scanPct(lib.id) }}%
                  </span>
                  <span
                    v-else-if="lib.bookCount !== undefined"
                    class="ml-auto shrink-0 rounded-md bg-sidebar-foreground/10 px-1.5 py-px text-[11px] font-semibold tabular-nums text-sidebar-foreground/60 transition-colors group-data-[active=true]/item:bg-primary/20 group-data-[active=true]/item:text-primary group-data-[collapsible=icon]:hidden"
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
        </div>
      </SidebarGroup>

      <SidebarSeparator class="group-data-[collapsible=icon]:hidden" />

      <!-- Lenses -->
      <SidebarGroup class="py-2">
        <div class="flex h-8 items-center px-2 group-data-[collapsible=icon]:hidden">
          <button class="group/hdr flex min-w-0 flex-1 items-center gap-1.5" @click="toggleLenses">
            <span
              class="text-[11px] font-bold uppercase tracking-[0.12em] text-sidebar-foreground/60 transition-colors group-hover/hdr:text-sidebar-foreground/90"
              >Lenses</span
            >
            <span v-if="!lensesOpen && lenses.length > 0" class="text-[11px] font-medium text-sidebar-foreground/40"> ({{ lenses.length }}) </span>
            <ChevronDown
              :size="13"
              :stroke-width="2.5"
              class="ml-auto shrink-0 text-sidebar-foreground/40 transition-transform duration-200 group-hover/hdr:text-sidebar-foreground/70"
              :class="lensesOpen ? 'rotate-0' : '-rotate-90'"
            />
          </button>
          <button
            class="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/40 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            title="New Lens"
            @click="createLensOpen = true"
          >
            <Plus :size="14" :stroke-width="2.5" />
          </button>
        </div>
        <div v-show="lensesOpen">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="lens in lenses" :key="lens.id">
                <SidebarMenuButton
                  :is-active="activeLensId === lens.id"
                  :tooltip="lens.name"
                  class="relative h-9 gap-2.5 rounded-xl px-2 transition-[background-color,box-shadow] duration-200 before:absolute before:-left-1.5 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:scale-y-75 before:rounded-full before:bg-primary before:opacity-0 before:transition-all before:duration-200 hover:bg-primary/8 data-[active=true]:bg-primary/15 data-[active=true]:shadow-[inset_0_0_0_1px_var(--sidebar-border)] data-[active=true]:before:scale-y-100 data-[active=true]:before:opacity-100 group/item group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-1.5"
                  @click="router.push({ name: 'lens', params: { id: lens.id } })"
                >
                  <span class="inline-flex h-[1.65rem] w-[1.65rem] shrink-0 items-center justify-center rounded-lg transition-colors">
                    <component
                      :is="getLensIcon(lens.icon)"
                      :size="16"
                      class="text-sidebar-foreground/70 transition-colors group-hover/item:text-sidebar-foreground group-data-[active=true]/item:text-primary"
                    />
                  </span>
                  <span
                    class="text-[13.5px] font-semibold tracking-[0.005em] text-sidebar-foreground/80 transition-colors group-hover/item:text-sidebar-foreground group-data-[active=true]/item:text-primary group-data-[collapsible=icon]:hidden"
                  >
                    {{ lens.name }}
                  </span>
                  <span
                    v-if="lens.bookCount !== undefined"
                    class="ml-auto shrink-0 rounded-md bg-sidebar-foreground/10 px-1.5 py-px text-[11px] font-semibold tabular-nums text-sidebar-foreground/60 transition-colors group-data-[active=true]/item:bg-primary/20 group-data-[active=true]/item:text-primary group-data-[collapsible=icon]:hidden"
                  >
                    {{ lens.bookCount.toLocaleString() }}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem v-if="lenses.length === 0">
                <span class="px-2 py-1 text-[11px] text-sidebar-foreground/35 group-data-[collapsible=icon]:hidden">No lenses yet</span>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </div>
      </SidebarGroup>

      <SidebarSeparator class="group-data-[collapsible=icon]:hidden" />

      <!-- Collections -->
      <SidebarGroup class="py-2">
        <div class="flex h-8 items-center px-2 group-data-[collapsible=icon]:hidden">
          <button class="group/hdr flex min-w-0 flex-1 items-center gap-1.5" @click="toggleCollections">
            <span
              class="text-[11px] font-bold uppercase tracking-[0.12em] text-sidebar-foreground/60 transition-colors group-hover/hdr:text-sidebar-foreground/90"
              >Collections</span
            >
            <span v-if="!collectionsOpen && collections.length > 0" class="text-[11px] font-medium text-sidebar-foreground/40">
              ({{ collections.length }})
            </span>
            <ChevronDown
              :size="13"
              :stroke-width="2.5"
              class="ml-auto shrink-0 text-sidebar-foreground/40 transition-transform duration-200 group-hover/hdr:text-sidebar-foreground/70"
              :class="collectionsOpen ? 'rotate-0' : '-rotate-90'"
            />
          </button>
          <button
            class="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/40 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            title="New Collection"
            @click="createCollectionOpen = true"
          >
            <Plus :size="14" :stroke-width="2.5" />
          </button>
        </div>
        <div v-show="collectionsOpen">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="collection in collections" :key="collection.id">
                <SidebarMenuButton
                  :is-active="activeCollectionId === collection.id"
                  :tooltip="collection.name"
                  class="relative h-9 gap-2.5 rounded-xl px-2 transition-[background-color,box-shadow] duration-200 before:absolute before:-left-1.5 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:scale-y-75 before:rounded-full before:bg-primary before:opacity-0 before:transition-all before:duration-200 hover:bg-primary/8 data-[active=true]:bg-primary/15 data-[active=true]:shadow-[inset_0_0_0_1px_var(--sidebar-border)] data-[active=true]:before:scale-y-100 data-[active=true]:before:opacity-100 group/item group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-1.5"
                  @click="router.push({ name: 'collection', params: { id: collection.id } })"
                >
                  <span class="inline-flex h-[1.65rem] w-[1.65rem] shrink-0 items-center justify-center rounded-lg transition-colors">
                    <component
                      :is="getCollectionIcon(collection.icon)"
                      :size="16"
                      class="text-sidebar-foreground/70 transition-colors group-hover/item:text-sidebar-foreground group-data-[active=true]/item:text-primary"
                    />
                  </span>
                  <span
                    class="text-[13.5px] font-semibold tracking-[0.005em] text-sidebar-foreground/80 transition-colors group-hover/item:text-sidebar-foreground group-data-[active=true]/item:text-primary group-data-[collapsible=icon]:hidden"
                  >
                    {{ collection.name }}
                  </span>
                  <span
                    class="ml-auto shrink-0 rounded-md bg-sidebar-foreground/10 px-1.5 py-px text-[11px] font-semibold tabular-nums text-sidebar-foreground/60 transition-colors group-data-[active=true]/item:bg-primary/20 group-data-[active=true]/item:text-primary group-data-[collapsible=icon]:hidden"
                  >
                    {{ collection.bookCount.toLocaleString() }}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem v-if="collections.length === 0">
                <span class="px-2 py-1 text-[11px] text-sidebar-foreground/35 group-data-[collapsible=icon]:hidden">No collections yet</span>
              </SidebarMenuItem>
            </SidebarMenu>
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
