<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'

const { t } = useI18n()

const props = defineProps<{
  fileRenameEnabled: boolean
  fileWriteEnabled: boolean
  fileWriteWriteCover: boolean
  fileWriteEpubEnabled: boolean
  fileWriteEpubMaxFileSizeMb: number
  fileWritePdfEnabled: boolean
  fileWritePdfMaxFileSizeMb: number
  fileWriteCbxEnabled: boolean
  fileWriteCbxMaxFileSizeMb: number
  fileWriteAudioEnabled: boolean
  fileWriteAudioMaxFileSizeMb: number
}>()

const emit = defineEmits<{
  'update:fileRenameEnabled': [value: boolean]
  'update:fileWriteEnabled': [value: boolean]
  'update:fileWriteWriteCover': [value: boolean]
  'update:fileWriteEpubEnabled': [value: boolean]
  'update:fileWriteEpubMaxFileSizeMb': [value: number]
  'update:fileWritePdfEnabled': [value: boolean]
  'update:fileWritePdfMaxFileSizeMb': [value: number]
  'update:fileWriteCbxEnabled': [value: boolean]
  'update:fileWriteCbxMaxFileSizeMb': [value: number]
  'update:fileWriteAudioEnabled': [value: boolean]
  'update:fileWriteAudioMaxFileSizeMb': [value: number]
}>()

function handleFileRenameToggle() {
  emit('update:fileRenameEnabled', !props.fileRenameEnabled)
}

function handleFileWriteToggle() {
  emit('update:fileWriteEnabled', !props.fileWriteEnabled)
}

function handleWriteCoverToggle() {
  const next = !props.fileWriteWriteCover
  emit('update:fileWriteWriteCover', next)
  if (!next && props.fileWriteAudioEnabled) {
    emit('update:fileWriteAudioEnabled', false)
  }
}

function handleEpubToggle() {
  emit('update:fileWriteEpubEnabled', !props.fileWriteEpubEnabled)
}

function handlePdfToggle() {
  emit('update:fileWritePdfEnabled', !props.fileWritePdfEnabled)
}

function handleCbxToggle() {
  emit('update:fileWriteCbxEnabled', !props.fileWriteCbxEnabled)
}

function handleAudioToggle() {
  emit('update:fileWriteAudioEnabled', !props.fileWriteAudioEnabled)
}

function onMaxSizeInput(field: 'epub' | 'pdf' | 'cbx' | 'audio', e: Event) {
  const val = Number((e.target as HTMLInputElement).value)
  if (field === 'epub') emit('update:fileWriteEpubMaxFileSizeMb', val)
  else if (field === 'pdf') emit('update:fileWritePdfMaxFileSizeMb', val)
  else if (field === 'cbx') emit('update:fileWriteCbxMaxFileSizeMb', val)
  else emit('update:fileWriteAudioMaxFileSizeMb', val)
}

function onEpubMaxSizeInput(e: Event) {
  onMaxSizeInput('epub', e)
}

function onPdfMaxSizeInput(e: Event) {
  onMaxSizeInput('pdf', e)
}

function onCbxMaxSizeInput(e: Event) {
  onMaxSizeInput('cbx', e)
}

function onAudioMaxSizeInput(e: Event) {
  onMaxSizeInput('audio', e)
}
</script>

<template>
  <div class="space-y-4 px-4 py-5 sm:px-6 sm:py-6">
    <div class="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-4">
      <div>
        <p class="text-sm font-medium text-foreground">{{ t('library.creator.fileWrite.rename.title') }}</p>
        <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
          {{ t('library.creator.fileWrite.rename.hint') }}
        </p>
      </div>
      <ToggleSwitch
        :model-value="fileRenameEnabled"
        :aria-label="t('library.creator.fileWrite.rename.title')"
        @update:model-value="handleFileRenameToggle"
      />
    </div>

    <div class="rounded-lg border border-border bg-card p-4">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-foreground">{{ t('library.creator.fileWrite.write.title') }}</p>
          <p class="mt-1 text-xs leading-relaxed text-muted-foreground">{{ t('library.creator.fileWrite.write.hint') }}</p>
        </div>
        <ToggleSwitch
          :model-value="fileWriteEnabled"
          :aria-label="t('library.creator.fileWrite.write.title')"
          @update:model-value="handleFileWriteToggle"
        />
      </div>

      <div v-if="fileWriteEnabled" class="mt-4 border-t border-border pt-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-sm font-medium text-foreground">{{ t('library.creator.fileWrite.cover.title') }}</p>
            <p class="mt-1 text-xs text-muted-foreground">{{ t('library.creator.fileWrite.cover.hint') }}</p>
          </div>
          <ToggleSwitch
            :model-value="fileWriteWriteCover"
            :aria-label="t('library.creator.fileWrite.cover.title')"
            @update:model-value="handleWriteCoverToggle"
          />
        </div>
      </div>
    </div>

    <template v-if="fileWriteEnabled">
      <p class="pt-2 text-[11px] font-semibold uppercase tracking-widest text-foreground/80">{{ t('library.creator.fileWrite.formatLimits') }}</p>

      <div class="grid gap-3 sm:grid-cols-2">
        <div class="space-y-3 rounded-lg border border-border bg-card p-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-sm font-medium text-foreground">{{ t('library.creator.fileWrite.epub.title') }}</p>
              <p class="mt-1 text-xs text-muted-foreground">{{ t('library.creator.fileWrite.epub.hint') }}</p>
            </div>
            <ToggleSwitch
              :model-value="fileWriteEpubEnabled"
              :aria-label="t('library.creator.fileWrite.epub.toggleAria')"
              @update:model-value="handleEpubToggle"
            />
          </div>
          <label v-if="fileWriteEpubEnabled" for="epub-max-size" class="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            {{ t('library.creator.fileWrite.maxFileSizeMb') }}
            <input
              id="epub-max-size"
              type="number"
              :value="fileWriteEpubMaxFileSizeMb"
              min="1"
              max="10000"
              step="1"
              class="w-24 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              @input="onEpubMaxSizeInput"
            />
          </label>
        </div>

        <div class="space-y-3 rounded-lg border border-border bg-card p-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-sm font-medium text-foreground">{{ t('library.creator.fileWrite.pdf.title') }}</p>
              <p class="mt-1 text-xs text-muted-foreground">{{ t('library.creator.fileWrite.pdf.hint') }}</p>
            </div>
            <ToggleSwitch
              :model-value="fileWritePdfEnabled"
              :aria-label="t('library.creator.fileWrite.pdf.toggleAria')"
              @update:model-value="handlePdfToggle"
            />
          </div>
          <label v-if="fileWritePdfEnabled" for="pdf-max-size" class="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            {{ t('library.creator.fileWrite.maxFileSizeMb') }}
            <input
              id="pdf-max-size"
              type="number"
              :value="fileWritePdfMaxFileSizeMb"
              min="1"
              max="10000"
              step="1"
              class="w-24 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              @input="onPdfMaxSizeInput"
            />
          </label>
        </div>

        <div class="space-y-3 rounded-lg border border-border bg-card p-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-sm font-medium text-foreground">{{ t('library.creator.fileWrite.cbx.title') }}</p>
              <p class="mt-1 text-xs text-muted-foreground">{{ t('library.creator.fileWrite.cbx.hint') }}</p>
            </div>
            <ToggleSwitch
              :model-value="fileWriteCbxEnabled"
              :aria-label="t('library.creator.fileWrite.cbx.toggleAria')"
              @update:model-value="handleCbxToggle"
            />
          </div>
          <label v-if="fileWriteCbxEnabled" for="cbx-max-size" class="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            {{ t('library.creator.fileWrite.maxFileSizeMb') }}
            <input
              id="cbx-max-size"
              type="number"
              :value="fileWriteCbxMaxFileSizeMb"
              min="1"
              max="10000"
              step="1"
              class="w-24 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              @input="onCbxMaxSizeInput"
            />
          </label>
        </div>

        <div v-if="fileWriteWriteCover" class="space-y-3 rounded-lg border border-border bg-card p-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-sm font-medium text-foreground">{{ t('library.creator.fileWrite.audio.title') }}</p>
              <p class="mt-1 text-xs text-muted-foreground">{{ t('library.creator.fileWrite.audio.hint') }}</p>
            </div>
            <ToggleSwitch
              :model-value="fileWriteAudioEnabled"
              :aria-label="t('library.creator.fileWrite.audio.toggleAria')"
              @update:model-value="handleAudioToggle"
            />
          </div>
          <label v-if="fileWriteAudioEnabled" for="audio-max-size" class="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            {{ t('library.creator.fileWrite.maxFileSizeMb') }}
            <input
              id="audio-max-size"
              type="number"
              :value="fileWriteAudioMaxFileSizeMb"
              min="1"
              max="10000"
              step="1"
              class="w-24 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              @input="onAudioMaxSizeInput"
            />
          </label>
        </div>
      </div>
    </template>
  </div>
</template>
