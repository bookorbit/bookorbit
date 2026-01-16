<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FolderOpen, Plus, RefreshCw, Pencil, Trash2, Library } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { Library as LibraryType, LibraryStats } from '@projectx/types'
import LibraryCreatorModal from '@/features/library/components/LibraryCreatorModal.vue'
import { useLibraries } from '@/features/library/composables/useLibraries'

const route = useRoute()
const router = useRouter()
const { libraries, fetchLibraries } = useLibraries()

const stats = ref<Record<number, LibraryStats>>({})
const scanning = ref<Record<number, boolean>>({})
const scanningAll = ref(false)
const creatorOpen = ref(false)
const editingLibrary = ref<LibraryType | null>(null)
const deletingLibrary = ref<LibraryType | null>(null)
const deleteConfirmName = ref('')
const deleting = ref(false)

async function loadAllStats() {
  await Promise.all(
    libraries.value.map(async (lib) => {
      const res = await api(`/api/libraries/${lib.id}/stats`)
      if (res.ok) stats.value[lib.id] = await res.json()
    }),
  )
}

onMounted(async () => {
  await fetchLibraries()
  loadAllStats()
})

async function scan(lib: LibraryType) {
  scanning.value[lib.id] = true
  try {
    const res = await api(`/api/scanner/libraries/${lib.id}/scan`, { method: 'POST' })
    if (res.ok) {
      toast.success(`Scan started for "${lib.name}"`)
    } else {
      toast.error(`Failed to start scan for "${lib.name}"`)
    }
  } catch {
    toast.error(`Failed to start scan for "${lib.name}"`)
  } finally {
    scanning.value[lib.id] = false
  }
}

async function scanAll() {
  scanningAll.value = true
  try {
    const results = await Promise.all(libraries.value.map((lib) => api(`/api/scanner/libraries/${lib.id}/scan`, { method: 'POST' })))
    const failed = results.filter((r) => !r.ok).length
    if (failed === 0) {
      toast.success('Scan started for all libraries')
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

async function onSaved(library: LibraryType) {
  creatorOpen.value = false
  editingLibrary.value = null
  await fetchLibraries()
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
    const res = await api(`/api/libraries/${deletedId}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success(`"${deletedName}" deleted`)
      deletingLibrary.value = null
      await fetchLibraries()
      loadAllStats()
      // If currently viewing the deleted library, navigate to the first remaining one
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

function iconComponent(iconName: string | null | undefined) {
  // Dynamic Lucide icon lookup via pre-imported default
  return iconName ? null : Library
}
</script>

<template>
  <div class="px-5 py-6 sm:px-10 sm:py-8 max-w-3xl mx-auto">
    <!-- Header -->
    <div class="flex items-start justify-between mb-8">
      <div>
        <h2 class="font-serif font-semibold text-foreground text-2xl tracking-tight">Libraries</h2>
        <p class="mt-1 text-sm text-muted-foreground">Manage your media libraries and trigger content scans.</p>
      </div>
      <div class="flex items-center gap-2 shrink-0 ml-4">
        <button
          class="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
          :disabled="scanningAll || libraries.length === 0"
          @click="scanAll"
        >
          <RefreshCw :size="12" :class="scanningAll ? 'animate-spin' : ''" />
          {{ scanningAll ? 'Scanning…' : 'Scan All' }}
        </button>
        <button
          class="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          @click="openCreate"
        >
          <Plus :size="12" />
          Add Library
        </button>
      </div>
    </div>

    <!-- Library list -->
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
      <div v-for="lib in libraries" :key="lib.id" class="bg-card px-5 py-4">
        <div class="flex items-center gap-4">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <FolderOpen :size="17" class="text-primary" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-foreground truncate">{{ lib.name }}</p>
            <div class="flex items-center gap-3 mt-0.5">
              <span v-if="stats[lib.id]" class="text-xs text-muted-foreground">
                {{ stats[lib.id].totalBooks }} book{{ stats[lib.id].totalBooks === 1 ? '' : 's' }}
                <span v-if="stats[lib.id].totalSizeBytes > 0"> &middot; {{ formatBytes(stats[lib.id].totalSizeBytes) }}</span>
              </span>
              <span v-else class="text-xs text-muted-foreground">
                Added {{ new Date(lib.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }}
              </span>
              <span v-if="lib.watch" class="text-xs text-primary/70">Watching</span>
            </div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <button
              class="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Edit library"
              @click="openEdit(lib)"
            >
              <Pencil :size="13" />
            </button>
            <button
              class="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              title="Delete library"
              @click="openDelete(lib)"
            >
              <Trash2 :size="13" />
            </button>
            <button
              class="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
              :disabled="scanning[lib.id]"
              @click="scan(lib)"
            >
              <RefreshCw :size="12" :class="scanning[lib.id] ? 'animate-spin' : ''" />
              {{ scanning[lib.id] ? 'Scanning…' : 'Scan' }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="libraries.length === 0" class="bg-card px-5 py-12 text-center">
        <FolderOpen :size="28" class="text-muted-foreground/30 mx-auto mb-3" />
        <p class="text-sm text-muted-foreground">No libraries yet.</p>
        <button class="mt-3 text-xs text-primary hover:underline" @click="openCreate">Create your first library</button>
      </div>
    </div>

    <!-- Library creator/editor modal -->
    <LibraryCreatorModal
      v-if="creatorOpen"
      :library="editingLibrary"
      @close="creatorOpen = false; editingLibrary = null"
      @saved="onSaved"
    />

    <!-- Delete confirmation dialog -->
    <div v-if="deletingLibrary" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div class="bg-card border border-border rounded-xl shadow-xl w-full max-w-sm p-6">
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
  </div>
</template>
