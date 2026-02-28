<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Folder, FolderOpen, ChevronRight, ChevronUp, Search, X, Check, Loader2, HardDrive } from 'lucide-vue-next'
import { api } from '@/lib/api'

interface DirEntry {
  name: string
  path: string
}

const emit = defineEmits<{
  select: [path: string]
  close: []
}>()

const currentPath = ref('/')
const entries = ref<DirEntry[]>([])
const loading = ref(false)
const search = ref('')
const error = ref<string | null>(null)

const filteredEntries = computed(() => {
  const q = search.value.trim().toLowerCase()
  return q ? entries.value.filter((e) => e.name.toLowerCase().includes(q)) : entries.value
})

const breadcrumbs = computed(() => {
  if (currentPath.value === '/') return [{ label: '/', path: '/' }]
  const parts = currentPath.value.split('/').filter(Boolean)
  const crumbs = [{ label: '/', path: '/' }]
  let built = ''
  for (const part of parts) {
    built += '/' + part
    crumbs.push({ label: part, path: built })
  }
  return crumbs
})

const canGoUp = computed(() => currentPath.value !== '/')

async function navigate(path: string) {
  search.value = ''
  currentPath.value = path
}

async function goUp() {
  const parts = currentPath.value.split('/').filter(Boolean)
  parts.pop()
  navigate(parts.length === 0 ? '/' : '/' + parts.join('/'))
}

async function loadEntries(path: string) {
  loading.value = true
  error.value = null
  try {
    const res = await api(`/api/v1/path?path=${encodeURIComponent(path)}`)
    if (res.ok) {
      entries.value = await res.json()
    } else {
      error.value = 'Could not read directory'
      entries.value = []
    }
  } catch {
    error.value = 'Could not connect'
    entries.value = []
  } finally {
    loading.value = false
  }
}

watch(currentPath, (p) => loadEntries(p), { immediate: true })

function selectCurrent() {
  emit('select', currentPath.value)
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/50 backdrop-blur-[2px]" @click="emit('close')" />

      <div
        class="relative flex flex-col w-full max-w-lg bg-background rounded-xl shadow-2xl border border-border overflow-hidden"
        style="height: min(80vh, 560px)"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div class="flex items-center gap-2">
            <HardDrive :size="15" class="text-primary" />
            <span class="text-sm font-semibold text-foreground">Browse folders</span>
          </div>
          <button
            class="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            @click="emit('close')"
          >
            <X :size="14" />
          </button>
        </div>

        <!-- Breadcrumb -->
        <div class="flex items-center gap-1 px-4 py-2 border-b border-border bg-muted/30 shrink-0 overflow-x-auto">
          <button
            v-if="canGoUp"
            class="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0 mr-1"
            :title="'Go up'"
            @click="goUp"
          >
            <ChevronUp :size="13" />
          </button>
          <template v-for="(crumb, i) in breadcrumbs" :key="crumb.path">
            <ChevronRight v-if="i > 0" :size="12" class="text-muted-foreground/50 shrink-0" />
            <button
              class="text-xs px-1 py-0.5 rounded transition-colors shrink-0 whitespace-nowrap"
              :class="i === breadcrumbs.length - 1 ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted'"
              @click="navigate(crumb.path)"
            >
              {{ crumb.label }}
            </button>
          </template>
        </div>

        <!-- Search -->
        <div class="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
          <Search :size="13" class="text-muted-foreground shrink-0" />
          <input
            v-model="search"
            type="text"
            placeholder="Filter folders…"
            class="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
          />
          <button v-if="search" class="text-muted-foreground hover:text-foreground" @click="search = ''">
            <X :size="12" />
          </button>
        </div>

        <!-- Directory list -->
        <div class="flex-1 overflow-y-auto">
          <div v-if="loading" class="flex items-center justify-center h-full">
            <Loader2 :size="20" class="animate-spin text-muted-foreground" />
          </div>

          <div v-else-if="error" class="flex items-center justify-center h-full">
            <p class="text-sm text-muted-foreground">{{ error }}</p>
          </div>

          <div v-else-if="filteredEntries.length === 0" class="flex items-center justify-center h-full">
            <p class="text-sm text-muted-foreground">No folders found</p>
          </div>

          <div v-else class="py-1">
            <button
              v-for="entry in filteredEntries"
              :key="entry.path"
              class="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/60 transition-colors group"
              @click="navigate(entry.path)"
            >
              <Folder :size="15" class="text-primary/70 shrink-0 group-hover:hidden" />
              <FolderOpen :size="15" class="text-primary shrink-0 hidden group-hover:block" />
              <span class="flex-1 text-sm text-foreground text-left truncate">{{ entry.name }}</span>
              <ChevronRight :size="13" class="text-muted-foreground/40 shrink-0" />
            </button>
          </div>
        </div>

        <!-- Footer -->
        <div class="shrink-0 border-t border-border px-4 py-3 flex items-center justify-between gap-3 bg-muted/20">
          <p class="text-xs text-muted-foreground font-mono truncate">{{ currentPath }}</p>
          <div class="flex items-center gap-2 shrink-0">
            <button
              class="px-3 py-1.5 rounded-md border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              @click="emit('close')"
            >
              Cancel
            </button>
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
              @click="selectCurrent"
            >
              <Check :size="12" />
              Select this folder
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
