<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  FolderOpen,
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  Images,
  FileEdit,
  MoreHorizontal,
  BookOpen,
  HardDrive,
  Eye,
  FileText,
  Folder,
  CalendarClock,
} from '@lucide/vue'
import SettingsPageHeader from './SettingsPageHeader.vue'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { Library as LibraryType, LibraryStats } from '@bookorbit/types'
import LibraryCreatorModal from '@/features/library/components/LibraryCreatorModal.vue'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useLibraryCreationRedirect } from '@/features/library/composables/useLibraryCreationRedirect'
import { useLibraryFileSync } from '@/features/library/composables/useLibraryFileSync'
import { useScanProgress, getSocket } from '@/features/scanner/composables/useScanProgress'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { parseCronToHuman } from '@/features/library/utils/cron'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import AppIcon from '@/components/AppIcon.vue'

const route = useRoute()
const router = useRouter()
const { hasPermission } = usePermissions()

if (!hasPermission('manage_libraries')) {
  router.replace({ name: 'settings-appearance' })
}

const { libraries, fetchLibraries, refreshLibraries } = useLibraries()
const { handleLibraryCreated } = useLibraryCreationRedirect()
const { subscribeLibrary, getProgress, isScanning, progressMap, getCoverRefreshProgress, isRefreshingCovers } = useScanProgress()

const stats = ref<Record<number, LibraryStats>>({})
const scanningAll = ref(false)
const creatorOpen = ref(false)
const editingLibrary = ref<LibraryType | null>(null)
const deletingLibrary = ref<LibraryType | null>(null)
const deleteConfirmName = ref('')
const deleting = ref(false)
const fileSyncingMap = ref<Record<number, boolean>>({})
const confirmSyncLibrary = ref<LibraryType | null>(null)

const { syncAll: syncAllFiles } = useLibraryFileSync()

function promptSyncFiles(lib: LibraryType) {
  confirmSyncLibrary.value = lib
}

async function confirmSyncFiles() {
  const lib = confirmSyncLibrary.value
  if (!lib) return
  confirmSyncLibrary.value = null
  fileSyncingMap.value[lib.id] = true
  try {
    await syncAllFiles(lib.id)
    toast.success(`Metadata synced to files for "${lib.name}"`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (msg.includes('400')) {
      toast.error('Metadata file write is not enabled for this library. Enable it in the library settings.')
    } else {
      toast.error(`File sync failed for "${lib.name}"`)
    }
  } finally {
    fileSyncingMap.value[lib.id] = false
  }
}

async function loadAllStats() {
  await Promise.all(
    libraries.value.map(async (lib) => {
      const res = await api(`/api/v1/libraries/${lib.id}/stats`)
      if (res.ok) stats.value[lib.id] = await res.json()
    }),
  )
}

function subscribeAll() {
  for (const lib of libraries.value) {
    subscribeLibrary(lib.id)
  }
}

onMounted(async () => {
  getSocket()
  await fetchLibraries()
  subscribeAll()
  loadAllStats()
})

const statsReloadedFor = new Set<number>()

watch(progressMap, (map) => {
  for (const [libraryId, event] of map) {
    if (event.status === 'completed' && !statsReloadedFor.has(libraryId)) {
      statsReloadedFor.add(libraryId)
      api(`/api/v1/libraries/${libraryId}/stats`).then(async (res) => {
        if (res.ok) stats.value[libraryId] = await res.json()
        setTimeout(() => statsReloadedFor.delete(libraryId), 5000)
      })
    }
  }
})

async function scan(lib: LibraryType) {
  try {
    const res = await api(`/api/v1/scanner/libraries/${lib.id}/scan`, { method: 'POST' })
    if (res.ok) {
      toast.success(`Scan started for "${lib.name}"`)
      subscribeLibrary(lib.id)
    } else {
      toast.error(`Failed to start scan for "${lib.name}"`)
    }
  } catch {
    toast.error(`Failed to start scan for "${lib.name}"`)
  }
}

async function refreshCovers(lib: LibraryType) {
  try {
    const res = await api(`/api/v1/scanner/libraries/${lib.id}/refresh-covers`, { method: 'POST' })
    if (!res.ok) toast.error(`Failed to refresh covers for "${lib.name}"`)
  } catch {
    toast.error(`Failed to refresh covers for "${lib.name}"`)
  }
}

async function scanAll() {
  scanningAll.value = true
  try {
    const results = await Promise.all(libraries.value.map((lib) => api(`/api/v1/scanner/libraries/${lib.id}/scan`, { method: 'POST' })))
    const failed = results.filter((r) => !r.ok).length
    if (failed === 0) {
      toast.success('Scan started for all libraries')
      subscribeAll()
    } else {
      toast.error(`${failed} librar${failed === 1 ? 'y' : 'ies'} failed to start`)
    }
  } catch {
    toast.error('Failed to start scans')
  } finally {
    scanningAll.value = false
  }
}

function openCreate() {
  editingLibrary.value = null
  creatorOpen.value = true
}

function openEdit(lib: LibraryType) {
  editingLibrary.value = lib
  creatorOpen.value = true
}

function closeCreator() {
  creatorOpen.value = false
  editingLibrary.value = null
}

async function onSaved(library: LibraryType) {
  const isNew = !editingLibrary.value
  creatorOpen.value = false
  editingLibrary.value = null
  subscribeLibrary(library.id)
  if (isNew) {
    toast.success(`Library "${library.name}" created`)
    await handleLibraryCreated(library)
  } else {
    toast.success(`Library "${library.name}" updated`)
    await refreshLibraries()
  }
  loadAllStats()
}

function openDelete(lib: LibraryType) {
  deletingLibrary.value = lib
  deleteConfirmName.value = ''
}

async function confirmDelete() {
  if (!deletingLibrary.value) return
  deleting.value = true
  const deletedId = deletingLibrary.value.id
  const deletedName = deletingLibrary.value.name
  try {
    const res = await api(`/api/v1/libraries/${deletedId}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success(`"${deletedName}" deleted`)
      deletingLibrary.value = null
      await refreshLibraries()
      loadAllStats()
      if (route.name === 'library' && Number(route.params.id) === deletedId) {
        const next = libraries.value[0]
        if (next) {
          router.replace({ name: 'library', params: { id: next.id } })
        } else {
          router.replace('/')
        }
      }
    } else {
      toast.error('Failed to delete library')
    }
  } catch {
    toast.error('Failed to delete library')
  } finally {
    deleting.value = false
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function scanProgressLabel(libraryId: number): string {
  const p = getProgress(libraryId)
  if (!p) return ''
  if (p.status === 'running') {
    if (p.total === 0) return 'Scanning...'
    const pct = Math.floor((p.processed / p.total) * 100)
    return `Scanning ${pct}% (${p.processed}/${p.total})`
  }
  if (p.status === 'completed') return `Done - ${p.added} added, ${p.updated} updated`
  if (p.status === 'failed') return p.errorMessage ? `Failed: ${p.errorMessage}` : 'Scan failed'
  return ''
}

function coverRefreshLabel(libraryId: number): string {
  const p = getCoverRefreshProgress(libraryId)
  if (!p) return ''
  if (p.status === 'running') {
    const pct = p.total > 0 ? Math.floor((p.processed / p.total) * 100) : 0
    return `Refreshing covers ${pct}% (${p.processed}/${p.total})`
  }
  if (p.status === 'completed') return `Covers refreshed (${p.total} processed)`
  return ''
}
</script>

<template>
  <div class="md:hidden mb-3">
    <h2 class="settings-title">Libraries</h2>
    <p class="settings-subtitle overflow-hidden" style="display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2">
      Manage your media libraries and trigger content scans.
    </p>
  </div>
  <div
    class="md:hidden sticky top-0 z-20 mb-4 -mx-4 px-4 py-2 border-y border-border/70 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/75"
  >
    <div class="grid grid-cols-2 gap-2">
      <button class="settings-btn-outline w-full justify-center" :disabled="scanningAll || libraries.length === 0" @click="scanAll">
        <RefreshCw :size="14" :class="scanningAll ? 'animate-spin' : ''" />
        {{ scanningAll ? 'Scanning...' : 'Scan All' }}
      </button>
      <button class="settings-btn-primary w-full justify-center" @click="openCreate">
        <Plus :size="14" />
        Add Library
      </button>
    </div>
  </div>

  <SettingsPageHeader title="Libraries" subtitle="Manage your media libraries and trigger content scans." class="hidden md:flex">
    <button class="settings-btn-outline" :disabled="scanningAll || libraries.length === 0" @click="scanAll">
      <RefreshCw :size="14" :class="scanningAll ? 'animate-spin' : ''" />
      {{ scanningAll ? 'Scanning...' : 'Scan All' }}
    </button>
    <button class="settings-btn-primary" @click="openCreate">
      <Plus :size="14" />
      Add Library
    </button>
  </SettingsPageHeader>

  <!-- Library cards -->
  <TooltipProvider>
    <div class="space-y-2 md:space-y-4">
      <div v-for="lib in libraries" :key="lib.id" class="rounded-lg border border-border bg-card overflow-hidden shadow-xs">
        <div class="px-4 py-3.5 md:px-5 md:py-4">
          <div class="flex items-center gap-3">
            <!-- Icon -->
            <RouterLink
              :to="{ name: 'library', params: { id: lib.id } }"
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 hover:bg-primary/15 transition-colors"
            >
              <AppIcon :icon="lib.icon || 'FolderOpen'" fallback="FolderOpen" :size="16" class="text-primary" />
            </RouterLink>

            <!-- Name + stats -->
            <div class="flex-1 min-w-0">
              <RouterLink
                :to="{ name: 'library', params: { id: lib.id } }"
                class="settings-label hover:text-primary transition-colors truncate block leading-snug"
              >
                {{ lib.name }}
              </RouterLink>
              <div class="grid grid-rows-4 grid-cols-2 md:grid-rows-2 md:grid-cols-[90px_100px_200px_96px] grid-flow-col gap-x-4 gap-y-1.5 mt-1.5">
                <!-- Col 1 -->
                <span v-if="stats[lib.id]" class="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                  <BookOpen :size="11" class="shrink-0" />
                  <span class="truncate">{{ stats[lib.id]?.totalBooks }} book{{ stats[lib.id]?.totalBooks === 1 ? '' : 's' }}</span>
                </span>
                <span v-else class="text-xs text-muted-foreground truncate min-w-0">
                  Added {{ new Date(lib.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }}
                </span>

                <span
                  v-if="stats[lib.id] && (stats[lib.id]?.totalSizeBytes ?? 0) > 0"
                  class="flex items-center gap-1 text-xs text-muted-foreground min-w-0"
                >
                  <HardDrive :size="11" class="shrink-0" />
                  <span class="truncate">{{ formatBytes(stats[lib.id]?.totalSizeBytes ?? 0) }}</span>
                </span>
                <span v-else class="min-w-0"></span>

                <!-- Col 2 -->
                <span class="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                  <component :is="lib.organizationMode === 'book_per_file' ? FileText : Folder" :size="11" class="shrink-0" />
                  <span class="truncate">{{ lib.organizationMode === 'book_per_file' ? 'File mode' : 'Folder mode' }}</span>
                </span>

                <Tooltip v-if="lib.folders.length > 0">
                  <TooltipTrigger as-child>
                    <span class="flex items-center gap-1 text-xs text-muted-foreground cursor-default min-w-0">
                      <FolderOpen :size="11" class="shrink-0" />
                      <span class="truncate">{{ lib.folders.length }} {{ lib.folders.length === 1 ? 'folder' : 'folders' }}</span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent class="max-w-xs">
                    <div class="space-y-0.5">
                      <p v-for="folder in lib.folders" :key="folder.id" class="font-mono text-xs break-all">{{ folder.path }}</p>
                    </div>
                  </TooltipContent>
                </Tooltip>
                <span v-else class="min-w-0"></span>

                <!-- Col 3 -->
                <span v-if="lib.watch" class="flex items-center gap-1 text-xs font-medium text-primary/80 min-w-0">
                  <Eye :size="11" class="shrink-0" />
                  <span class="truncate">Watching</span>
                </span>
                <span v-else class="min-w-0"></span>

                <span
                  v-if="parseCronToHuman(lib.autoScanCronExpression)"
                  class="flex items-center gap-1 text-xs text-muted-foreground min-w-0"
                  :title="parseCronToHuman(lib.autoScanCronExpression) || undefined"
                >
                  <CalendarClock :size="11" class="shrink-0" />
                  <span class="truncate">{{ parseCronToHuman(lib.autoScanCronExpression) }}</span>
                </span>
                <span v-else class="min-w-0"></span>

                <!-- Col 4 -->
                <span v-if="lib.fileWriteEnabled" class="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                  <FileEdit :size="11" class="shrink-0" />
                  <span class="truncate">File write</span>
                </span>
                <span v-else class="min-w-0"></span>

                <span v-if="lib.fileRenameEnabled" class="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                  <Pencil :size="11" class="shrink-0" />
                  <span class="truncate">File rename</span>
                </span>
                <span v-else class="min-w-0"></span>
              </div>
            </div>

            <!-- Actions -->
            <div class="flex items-center gap-2 shrink-0">
              <button class="settings-btn-outline" :disabled="isScanning(lib.id)" @click="scan(lib)">
                <RefreshCw :size="14" :class="isScanning(lib.id) ? 'animate-spin' : ''" />
                {{ isScanning(lib.id) ? 'Scanning...' : 'Scan' }}
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <button
                    class="flex h-11 w-11 md:h-auto md:w-auto md:px-2 md:py-1.5 items-center justify-center rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                  >
                    <MoreHorizontal :size="16" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="w-52">
                  <DropdownMenuItem @click="openEdit(lib)">
                    <Pencil />
                    Edit library
                  </DropdownMenuItem>
                  <DropdownMenuItem :disabled="isRefreshingCovers(lib.id)" @click="refreshCovers(lib)">
                    <Images :class="isRefreshingCovers(lib.id) ? 'animate-pulse' : ''" />
                    Refresh covers
                  </DropdownMenuItem>
                  <DropdownMenuItem :disabled="!!fileSyncingMap[lib.id] || !lib.fileWriteEnabled" @click="promptSyncFiles(lib)">
                    <FileEdit :class="fileSyncingMap[lib.id] ? 'animate-pulse' : ''" />
                    <span class="flex-1">Sync metadata to files</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" @click="openDelete(lib)">
                    <Trash2 />
                    Delete library
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        <!-- Progress bars (shown below the main row, full width) -->
        <div
          v-if="getProgress(lib.id) || getCoverRefreshProgress(lib.id)"
          class="border-t border-border px-4 py-2.5 space-y-2 md:px-5 md:py-3 md:space-y-2.5"
        >
          <div v-if="getProgress(lib.id)">
            <div class="flex items-center justify-between mb-1.5 min-w-0">
              <span
                class="block min-w-0 text-xs font-medium overflow-hidden text-ellipsis whitespace-nowrap md:whitespace-normal md:overflow-visible"
                :class="getProgress(lib.id)?.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'"
              >
                {{ scanProgressLabel(lib.id) }}
              </span>
            </div>
            <div v-if="getProgress(lib.id)?.status === 'running'" class="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                class="h-full rounded-full bg-primary transition-all duration-300"
                :style="{
                  width:
                    getProgress(lib.id)!.total > 0 ? `${Math.floor((getProgress(lib.id)!.processed / getProgress(lib.id)!.total) * 100)}%` : '100%',
                  animation: getProgress(lib.id)!.total === 0 ? 'pulse 1.5s ease-in-out infinite' : 'none',
                }"
              />
            </div>
          </div>
          <div v-if="getCoverRefreshProgress(lib.id)">
            <div class="flex items-center justify-between mb-1.5 min-w-0">
              <span
                class="block min-w-0 text-xs font-medium text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap md:whitespace-normal md:overflow-visible"
              >
                {{ coverRefreshLabel(lib.id) }}
              </span>
            </div>
            <div v-if="getCoverRefreshProgress(lib.id)?.status === 'running'" class="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                class="h-full rounded-full bg-accent transition-all duration-300"
                :style="{
                  width:
                    getCoverRefreshProgress(lib.id)!.total > 0
                      ? `${Math.floor((getCoverRefreshProgress(lib.id)!.processed / getCoverRefreshProgress(lib.id)!.total) * 100)}%`
                      : '0%',
                }"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="libraries.length === 0" class="rounded-lg border border-dashed border-border bg-card/50 px-8 py-16 text-center shadow-xs">
        <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-muted mx-auto mb-4">
          <FolderOpen :size="22" class="text-muted-foreground/80" />
        </div>
        <p class="text-sm font-medium text-foreground mb-1">No libraries yet</p>
        <p class="text-sm text-muted-foreground mb-5">Add a library to start organizing your books.</p>
        <button class="settings-btn-primary" @click="openCreate">
          <Plus :size="14" />
          Add your first library
        </button>
      </div>
    </div>
  </TooltipProvider>

  <!-- Library creator/editor modal -->
  <LibraryCreatorModal v-if="creatorOpen" :library="editingLibrary" @close="closeCreator" @saved="onSaved" />

  <!-- Delete confirmation dialog -->
  <div v-if="deletingLibrary" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
    <div class="bg-card border border-border rounded-lg shadow-xl w-full max-w-sm p-6">
      <h3 class="text-base font-semibold text-foreground mb-1">Delete "{{ deletingLibrary.name }}"?</h3>
      <p class="text-sm text-muted-foreground mb-4">
        This will permanently remove all books, metadata, reading progress, bookmarks, and annotations in this library. This cannot be undone.
      </p>
      <p class="text-sm text-foreground mb-2">Type the library name to confirm:</p>
      <input
        v-model="deleteConfirmName"
        type="text"
        :placeholder="deletingLibrary.name"
        class="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-destructive mb-4"
        @keydown.enter="deleteConfirmName === deletingLibrary.name && !deleting ? confirmDelete() : null"
        @keydown.escape="deletingLibrary = null"
      />
      <div class="flex justify-end gap-2">
        <button
          class="px-4 py-2 text-sm font-medium rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground"
          @click="deletingLibrary = null"
        >
          Cancel
        </button>
        <button
          class="px-4 py-2 text-sm font-medium rounded-md bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          :disabled="deleteConfirmName !== deletingLibrary.name || deleting"
          @click="confirmDelete"
        >
          {{ deleting ? 'Deleting...' : 'Delete Library' }}
        </button>
      </div>
    </div>
  </div>

  <!-- Sync confirmation dialog -->
  <div v-if="confirmSyncLibrary" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
    <div class="bg-card border border-border rounded-lg shadow-xl w-full max-w-sm p-6">
      <h3 class="text-base font-semibold text-foreground mb-1">Sync metadata to files?</h3>
      <p class="text-sm text-muted-foreground mb-4">
        This will overwrite the metadata inside every supported file in
        <span class="font-medium text-foreground">{{ confirmSyncLibrary.name }}</span>
        directly on disk. This cannot be undone.
      </p>
      <div class="flex justify-end gap-2">
        <button
          class="px-4 py-2 text-sm font-medium rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground"
          @click="confirmSyncLibrary = null"
        >
          Cancel
        </button>
        <button
          class="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          @click="confirmSyncFiles"
        >
          Sync files
        </button>
      </div>
    </div>
  </div>
</template>
