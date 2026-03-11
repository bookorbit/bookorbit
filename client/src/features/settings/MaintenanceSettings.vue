<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Check, RefreshCw, Sparkles, FileEdit } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'
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
    toast.success(`${data.queued} books queued for embedding`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed'
    toast.error(`Failed to rebuild embeddings: ${error.value ?? 'Unknown error'}`)
  } finally {
    running.value = false
  }
}

const writeSettings = ref<GlobalFileWriteSettings>(structuredClone(DEFAULT_FILE_WRITE_SETTINGS))
const writeSaving = ref(false)

const epubMaxMb = computed({
  get: () => Math.round(writeSettings.value.epub.maxFileSizeBytes / (1024 * 1024)),
  set: (mb: number) => {
    writeSettings.value.epub.maxFileSizeBytes = mb * 1024 * 1024
  },
})
const pdfMaxMb = computed({
  get: () => Math.round(writeSettings.value.pdf.maxFileSizeBytes / (1024 * 1024)),
  set: (mb: number) => {
    writeSettings.value.pdf.maxFileSizeBytes = mb * 1024 * 1024
  },
})
const cbxMaxMb = computed({
  get: () => Math.round(writeSettings.value.cbx.maxFileSizeBytes / (1024 * 1024)),
  set: (mb: number) => {
    writeSettings.value.cbx.maxFileSizeBytes = mb * 1024 * 1024
  },
})

onMounted(async () => {
  const res = await api('/api/v1/app-settings/file-write-settings')
  if (res.ok) {
    writeSettings.value = await res.json()
  }
})

async function saveWriteSettings() {
  if (writeSaving.value) return
  writeSaving.value = true
  try {
    const res = await api('/api/v1/app-settings/file-write-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(writeSettings.value),
    })
    if (res.ok) {
      writeSettings.value = await res.json()
      toast.success('Metadata sync settings saved')
    } else {
      toast.error('Failed to save metadata sync settings')
    }
  } catch {
    toast.error('Failed to save metadata sync settings')
  } finally {
    writeSaving.value = false
  }
}

function toggle(path: () => boolean, set: (v: boolean) => void) {
  set(!path())
  void saveWriteSettings()
}

function toggleCbxFormat(fmt: 'cbz' | 'cb7') {
  const formats = writeSettings.value.cbx.formats
  const idx = formats.indexOf(fmt)
  if (idx === -1) {
    writeSettings.value.cbx.formats = [...formats, fmt]
  } else {
    writeSettings.value.cbx.formats = formats.filter((f) => f !== fmt)
  }
  void saveWriteSettings()
}
</script>

<template>
  <SettingsPageHeader title="Maintenance" subtitle="System maintenance and data operations." />

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
        <button class="settings-btn-outline" :disabled="running" @click="rebuildEmbeddings">
          <RefreshCw :size="13" :class="running ? 'animate-spin' : ''" />
          {{ running ? 'Running...' : 'Run' }}
        </button>
      </div>
    </div>
  </div>

  <div class="mt-8">
    <p class="settings-group-label">Metadata File Sync</p>
    <div class="border border-border rounded-lg bg-card divide-y divide-border">
      <!-- Master toggle -->
      <div class="px-5 py-4 flex items-start justify-between gap-6">
        <div class="flex items-start gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <FileEdit :size="16" class="text-primary" />
          </div>
          <div>
            <p class="settings-label">Write metadata to original files</p>
            <p class="settings-hint leading-relaxed max-w-sm">
              When enabled, saving metadata updates the physical file on disk. Configure each format below.
            </p>
          </div>
        </div>
        <ToggleSwitch
          :model-value="writeSettings.enabled"
          :disabled="writeSaving"
          @update:model-value="
            toggle(
              () => writeSettings.enabled,
              (v) => (writeSettings.enabled = v),
            )
          "
        />
      </div>

      <template v-if="writeSettings.enabled">
        <!-- Cover toggle -->
        <div class="px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p class="settings-label">Include cover image</p>
            <p class="settings-hint">Writes the stored cover back into the file (EPUB only).</p>
          </div>
          <ToggleSwitch
            :model-value="writeSettings.writeCover"
            :disabled="writeSaving"
            @update:model-value="
              toggle(
                () => writeSettings.writeCover,
                (v) => (writeSettings.writeCover = v),
              )
            "
          />
        </div>

        <!-- EPUB row -->
        <div class="px-5 py-4 space-y-3">
          <div class="flex items-center justify-between gap-4">
            <div>
              <p class="settings-label">EPUB</p>
              <p class="settings-hint">Writes metadata into the OPF file inside the EPUB archive.</p>
            </div>
            <ToggleSwitch
              :model-value="writeSettings.epub.enabled"
              :disabled="writeSaving"
              @update:model-value="
                toggle(
                  () => writeSettings.epub.enabled,
                  (v) => (writeSettings.epub.enabled = v),
                )
              "
            />
          </div>
          <div v-if="writeSettings.epub.enabled" class="flex items-center justify-between gap-4 pl-0">
            <p class="text-sm text-muted-foreground">Max file size (MB)</p>
            <input
              v-model.number="epubMaxMb"
              type="number"
              min="1"
              max="2000"
              :disabled="writeSaving"
              class="input-field w-24"
              @change="saveWriteSettings"
            />
          </div>
        </div>

        <!-- PDF row -->
        <div class="px-5 py-4 space-y-3">
          <div class="flex items-center justify-between gap-4">
            <div>
              <p class="settings-label">PDF</p>
              <p class="settings-hint">Embeds metadata into PDF Info dictionary and XMP stream.</p>
            </div>
            <ToggleSwitch
              :model-value="writeSettings.pdf.enabled"
              :disabled="writeSaving"
              @update:model-value="
                toggle(
                  () => writeSettings.pdf.enabled,
                  (v) => (writeSettings.pdf.enabled = v),
                )
              "
            />
          </div>
          <div v-if="writeSettings.pdf.enabled" class="flex items-center justify-between gap-4">
            <p class="text-sm text-muted-foreground">Max file size (MB)</p>
            <input
              v-model.number="pdfMaxMb"
              type="number"
              min="1"
              max="2000"
              :disabled="writeSaving"
              class="input-field w-24"
              @change="saveWriteSettings"
            />
          </div>
        </div>

        <!-- Comic archives row -->
        <div class="px-5 py-4 space-y-3">
          <div class="flex items-center justify-between gap-4">
            <div>
              <p class="settings-label">Comic archives</p>
              <p class="settings-hint">Writes ComicInfo.xml into CBZ and CB7 archives.</p>
            </div>
            <ToggleSwitch
              :model-value="writeSettings.cbx.enabled"
              :disabled="writeSaving"
              @update:model-value="
                toggle(
                  () => writeSettings.cbx.enabled,
                  (v) => (writeSettings.cbx.enabled = v),
                )
              "
            />
          </div>
          <template v-if="writeSettings.cbx.enabled">
            <div class="flex items-center gap-2 flex-wrap">
              <button
                v-for="fmt in ['cbz', 'cb7'] as const"
                :key="fmt"
                class="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors disabled:opacity-50"
                :class="
                  writeSettings.cbx.formats.includes(fmt)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                "
                :disabled="writeSaving"
                @click="toggleCbxFormat(fmt)"
              >
                {{ fmt.toUpperCase() }}
              </button>
              <span
                class="flex items-center px-3 py-1 rounded-full text-xs font-medium border border-border bg-muted text-muted-foreground cursor-default select-none"
              >
                CBR not writable
              </span>
            </div>
            <div class="flex items-center justify-between gap-4">
              <p class="text-sm text-muted-foreground">Max file size (MB)</p>
              <input
                v-model.number="cbxMaxMb"
                type="number"
                min="1"
                max="5000"
                :disabled="writeSaving"
                class="input-field w-24"
                @change="saveWriteSettings"
              />
            </div>
          </template>
        </div>
      </template>
    </div>
  </div>
</template>
