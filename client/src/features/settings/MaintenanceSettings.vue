<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Check, RefreshCw, Sparkles, FileEdit } from 'lucide-vue-next'
import type { GlobalFileWriteSettings } from '@projectx/types'
import { DEFAULT_FILE_WRITE_SETTINGS } from '@projectx/types'

import { api } from '@/lib/api'

const running = ref(false)
const queued = ref<number | null>(null)
const error = ref<string | null>(null)

async function rebuildEmbeddings() {
  running.value = true
  queued.value = null
  error.value = null
  try {
    const res = await api('/api/v1/books/embed-all', { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data: { queued: number } = await res.json()
    queued.value = data.queued
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed'
  } finally {
    running.value = false
  }
}

const writeSettings = ref<GlobalFileWriteSettings>({ ...DEFAULT_FILE_WRITE_SETTINGS })
const writeSaving = ref(false)
const writeSaved = ref(false)

const maxFileSizeMb = computed({
  get: () => Math.round(writeSettings.value.maxFileSizeBytes / (1024 * 1024)),
  set: (mb: number) => {
    writeSettings.value.maxFileSizeBytes = mb * 1024 * 1024
  },
})

onMounted(async () => {
  const res = await api('/api/v1/app-settings/file-write-settings')
  if (res.ok) {
    const data: GlobalFileWriteSettings = await res.json()
    writeSettings.value = data
  }
})

async function saveWriteSettings() {
  if (writeSaving.value) return
  writeSaving.value = true
  writeSaved.value = false
  try {
    const res = await api('/api/v1/app-settings/file-write-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(writeSettings.value),
    })
    if (res.ok) {
      writeSettings.value = await res.json()
      writeSaved.value = true
      setTimeout(() => {
        writeSaved.value = false
      }, 2000)
    }
  } finally {
    writeSaving.value = false
  }
}

function toggleEnabled() {
  writeSettings.value.enabled = !writeSettings.value.enabled
  void saveWriteSettings()
}

function toggleWriteCover() {
  writeSettings.value.writeCover = !writeSettings.value.writeCover
  void saveWriteSettings()
}
</script>

<template>
  <div class="mb-8">
    <h2 class="settings-title">Maintenance</h2>
    <p class="settings-subtitle">System maintenance and data operations.</p>
  </div>

  <div>
    <p class="settings-group-label">Recommendations</p>
    <div class="border border-border rounded-lg bg-card px-5 py-5">
      <div class="flex items-start justify-between gap-6">
        <div class="flex items-start gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Sparkles :size="16" class="text-primary" />
          </div>
          <div>
            <p class="settings-label">Rebuild recommendation embeddings</p>
            <p class="settings-hint leading-relaxed max-w-sm">
              Generates vector embeddings for all books. Run this after a large import or if recommendations seem off. Processes in the background.
            </p>
            <p v-if="queued !== null" class="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 mt-2">
              <Check :size="12" />
              {{ queued }} books queued for processing
            </p>
            <p v-if="error" class="text-xs text-destructive mt-2">{{ error }}</p>
          </div>
        </div>
        <button
          class="flex shrink-0 items-center gap-2 h-8 px-3 rounded-md border border-border bg-background text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          :disabled="running"
          @click="rebuildEmbeddings"
        >
          <RefreshCw :size="13" :class="running ? 'animate-spin' : ''" />
          {{ running ? 'Running...' : 'Run' }}
        </button>
      </div>
    </div>
  </div>

  <div class="mt-8">
    <p class="settings-group-label">Metadata File Sync</p>
    <div class="border border-border rounded-lg bg-card px-5 py-5 space-y-5">
      <div class="flex items-start gap-3">
        <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <FileEdit :size="16" class="text-primary" />
        </div>
        <div class="flex-1">
          <p class="settings-label">Write metadata to original files</p>
          <p class="settings-hint leading-relaxed max-w-sm">
            When enabled, saving metadata automatically updates the physical file on disk. Supports EPUB. Other formats are skipped.
          </p>
        </div>
        <button
          class="relative shrink-0 w-10 h-6 rounded-full transition-colors disabled:opacity-50"
          :class="writeSettings.enabled ? 'bg-primary' : 'bg-muted'"
          :disabled="writeSaving"
          @click="toggleEnabled"
        >
          <span
            class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
            :class="writeSettings.enabled ? 'translate-x-4' : 'translate-x-0'"
          />
        </button>
      </div>

      <div v-if="writeSettings.enabled" class="pl-12 space-y-4">
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="settings-label text-sm">Max file size (MB)</p>
            <p class="settings-hint text-xs">Files larger than this are skipped.</p>
          </div>
          <input
            v-model.number="maxFileSizeMb"
            type="number"
            min="1"
            max="2000"
            :disabled="writeSaving"
            class="w-24 text-sm border border-border rounded-md px-3 py-1.5 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            @change="saveWriteSettings"
          />
        </div>

        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="settings-label text-sm">Include cover image</p>
            <p class="settings-hint text-xs">Writes the stored cover back into the file.</p>
          </div>
          <button
            class="relative shrink-0 w-10 h-6 rounded-full transition-colors disabled:opacity-50"
            :class="writeSettings.writeCover ? 'bg-primary' : 'bg-muted'"
            :disabled="writeSaving"
            @click="toggleWriteCover"
          >
            <span
              class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
              :class="writeSettings.writeCover ? 'translate-x-4' : 'translate-x-0'"
            />
          </button>
        </div>
      </div>

      <p v-if="writeSaved" class="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 pl-12">
        <Check :size="12" />
        Settings saved
      </p>
    </div>
  </div>
</template>
