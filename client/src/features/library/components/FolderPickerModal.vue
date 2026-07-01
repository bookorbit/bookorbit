<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { Folder, FolderOpen, FolderPlus, ChevronRight, ChevronUp, Search, X, Check, Loader2, HardDrive } from '@lucide/vue'
import type { CreateFolderResult } from '@bookorbit/types'
import { api } from '@/lib/api'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const { t } = useI18n()

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
      error.value = t('library.folderPicker.errors.readDirectory')
      entries.value = []
    }
  } catch {
    error.value = t('library.folderPicker.errors.connect')
    entries.value = []
  } finally {
    loading.value = false
  }
}

watch(currentPath, (p) => loadEntries(p), { immediate: true })

function selectCurrent() {
  emit('select', currentPath.value)
}

const creatingFolder = ref(false)
const newFolderName = ref('')
const createError = ref<string | null>(null)
const createLoading = ref(false)
const newFolderInput = ref<HTMLInputElement | null>(null)

function toggleNewFolder() {
  creatingFolder.value = !creatingFolder.value
  newFolderName.value = ''
  createError.value = null
  if (creatingFolder.value) {
    nextTick(() => newFolderInput.value?.focus())
  }
}

function cancelNewFolder() {
  creatingFolder.value = false
  newFolderName.value = ''
  createError.value = null
}

async function submitNewFolder() {
  const name = newFolderName.value.trim()
  if (!name || createLoading.value) return
  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..' || name.startsWith('.')) {
    createError.value = t('library.folderPicker.errors.invalidName')
    return
  }
  createLoading.value = true
  createError.value = null
  try {
    const res = await api('/api/v1/path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentPath: currentPath.value, name }),
    })
    if (res.ok) {
      const created: CreateFolderResult = await res.json()
      creatingFolder.value = false
      newFolderName.value = ''
      navigate(created.path)
    } else {
      const body = await res.json().catch(() => ({}))
      const message = Array.isArray(body?.message) ? body.message[0] : body?.message
      createError.value = message ?? t('library.folderPicker.errors.createFolder')
    }
  } catch {
    createError.value = t('library.folderPicker.errors.connect')
  } finally {
    createLoading.value = false
  }
}

function onNewFolderKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    submitNewFolder()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    cancelNewFolder()
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/50 backdrop-blur-[2px]" @click="emit('close')" />

      <div
        class="relative flex flex-col w-full max-w-lg bg-background rounded-lg shadow-2xl border border-border overflow-hidden"
        style="height: min(80vh, 560px)"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div class="flex items-center gap-2">
            <HardDrive :size="15" class="text-primary" />
            <span class="text-sm font-semibold text-foreground">{{ t('library.folderPicker.title') }}</span>
          </div>
          <div class="flex items-center gap-1">
            <button
              class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              @click="toggleNewFolder"
            >
              <FolderPlus :size="13" />
              {{ t('library.folderPicker.newFolder') }}
            </button>
            <button
              class="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              @click="emit('close')"
            >
              <X :size="14" />
            </button>
          </div>
        </div>

        <!-- Breadcrumb -->
        <div class="flex items-center gap-1 px-4 py-2 border-b border-border bg-muted/30 shrink-0 overflow-x-auto">
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                v-if="canGoUp"
                class="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0 mr-1"
                @click="goUp"
              >
                <ChevronUp :size="13" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ t('library.folderPicker.goUp') }}</TooltipContent>
          </Tooltip>
          <template v-for="(crumb, i) in breadcrumbs" :key="crumb.path">
            <ChevronRight v-if="i > 0" :size="12" class="text-muted-foreground/70 shrink-0" />
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
            :placeholder="t('library.folderPicker.filterPlaceholder')"
            class="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
          />
          <button v-if="search" class="text-muted-foreground hover:text-foreground" @click="search = ''">
            <X :size="12" />
          </button>
        </div>

        <!-- New folder -->
        <div v-if="creatingFolder" class="px-3 py-2 border-b border-border bg-muted/20 shrink-0">
          <div class="flex items-center gap-2">
            <FolderPlus :size="13" class="text-primary shrink-0" />
            <input
              ref="newFolderInput"
              v-model="newFolderName"
              type="text"
              :placeholder="t('library.folderPicker.newFolderNamePlaceholder')"
              class="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
              @keydown="onNewFolderKeydown"
            />
            <button
              class="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity shrink-0 disabled:opacity-50"
              :disabled="!newFolderName.trim() || createLoading"
              @click="submitNewFolder"
            >
              <Loader2 v-if="createLoading" :size="12" class="animate-spin" />
              {{ t('library.folderPicker.create') }}
            </button>
            <button
              class="px-2.5 py-1 rounded-md border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
              @click="cancelNewFolder"
            >
              {{ t('common.cancel') }}
            </button>
          </div>
          <p v-if="createError" class="mt-1.5 pl-5 text-xs text-destructive">{{ createError }}</p>
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
            <p class="text-sm text-muted-foreground">{{ t('library.folderPicker.noFolders') }}</p>
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
              <ChevronRight :size="13" class="text-muted-foreground/60 shrink-0" />
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
              {{ t('common.cancel') }}
            </button>
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
              @click="selectCurrent"
            >
              <Check :size="12" />
              {{ t('library.folderPicker.selectFolder') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
