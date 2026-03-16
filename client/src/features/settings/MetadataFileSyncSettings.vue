<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { FileEdit } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import type { GlobalFileWriteSettings } from '@projectx/types'
import { DEFAULT_FILE_WRITE_SETTINGS } from '@projectx/types'
import { api } from '@/lib/api'

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
  if (res.ok) writeSettings.value = await res.json()
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
  writeSettings.value.cbx.formats = idx === -1 ? [...formats, fmt] : formats.filter((f) => f !== fmt)
  void saveWriteSettings()
}
</script>

<template>
  <p class="settings-group-label">Configuration</p>
  <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
    <div class="px-5 py-4 flex items-start justify-between gap-6 bg-card">
      <div class="flex items-start gap-3">
        <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <FileEdit :size="16" class="text-primary" />
        </div>
        <div>
          <p class="settings-label">Write metadata to original files</p>
          <p class="settings-hint">When enabled, saving metadata updates the physical file on disk. Configure each format below.</p>
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
      <div class="px-5 py-4 flex items-center justify-between gap-4 bg-card">
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

      <div class="px-5 py-4 space-y-3 bg-card">
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
        <div v-if="writeSettings.epub.enabled" class="flex items-center justify-between gap-4">
          <p class="settings-hint">Max file size (MB)</p>
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

      <div class="px-5 py-4 space-y-3 bg-card">
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
          <p class="settings-hint">Max file size (MB)</p>
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

      <div class="px-5 py-4 space-y-3 bg-card">
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
            <p class="settings-hint">Max file size (MB)</p>
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
</template>
