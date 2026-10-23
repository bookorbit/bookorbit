<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Upload, RotateCw, Loader2, Pause, Play } from '@lucide/vue'
import { Permission } from '@bookorbit/types'
import { api } from '@/lib/api'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { SUPPORTED_FORMATS_ACCEPT, useBookDockUpload } from '../composables/useBookDockUpload'

const props = defineProps<{ paused: boolean }>()

const emit = defineEmits<{
  pause: []
  pauseError: []
  resume: []
  resumeError: []
  rescan: []
  rescanError: []
}>()

const { t } = useI18n()
const { isUploading, addFiles } = useBookDockUpload()
const { hasPermission } = usePermissions()

const fileInput = ref<HTMLInputElement | null>(null)
const rescanning = ref(false)
const processingStateChanging = ref(false)

const canManageBookDock = computed(() => hasPermission(Permission.ManageBookDock))

function openFilePicker() {
  fileInput.value?.click()
}

function onFilesSelected(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.length) {
    addFiles(input.files)
    input.value = ''
  }
}

async function rescan() {
  if (props.paused || rescanning.value) return
  rescanning.value = true
  try {
    const res = await api('/api/v1/book-dock/rescan', { method: 'POST' })
    if (res.ok) emit('rescan')
    else emit('rescanError')
  } catch {
    emit('rescanError')
  } finally {
    rescanning.value = false
  }
}

async function toggleProcessingState() {
  if (processingStateChanging.value) return
  processingStateChanging.value = true
  const wasPaused = props.paused
  try {
    const res = await api(wasPaused ? '/api/v1/book-dock/resume' : '/api/v1/book-dock/pause', { method: 'POST' })
    if (res.ok) {
      if (wasPaused) emit('resume')
      else emit('pause')
    } else if (wasPaused) {
      emit('resumeError')
    } else {
      emit('pauseError')
    }
  } catch {
    if (wasPaused) emit('resumeError')
    else emit('pauseError')
  } finally {
    processingStateChanging.value = false
  }
}
</script>

<template>
  <div class="flex items-center gap-2">
    <input ref="fileInput" type="file" :accept="SUPPORTED_FORMATS_ACCEPT" multiple class="hidden" @change="onFilesSelected" />

    <button
      v-if="canManageBookDock"
      type="button"
      data-testid="book-dock-processing-toggle"
      class="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition-all active:scale-95 disabled:opacity-60 disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :disabled="processingStateChanging"
      @click="toggleProcessingState"
    >
      <Loader2 v-if="processingStateChanging" class="size-3.5 animate-spin" />
      <Play v-else-if="props.paused" class="size-3.5" />
      <Pause v-else class="size-3.5" />
      {{ props.paused ? t('bookDock.layout.resume') : t('bookDock.layout.pause') }}
    </button>

    <button
      v-if="canManageBookDock"
      type="button"
      data-testid="book-dock-rescan"
      class="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition-all active:scale-95 disabled:opacity-60 disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :disabled="rescanning || props.paused"
      @click="rescan"
    >
      <RotateCw class="size-3.5" :class="rescanning ? 'animate-spin' : ''" />
      {{ t('bookDock.rescan') }}
    </button>

    <button
      type="button"
      data-testid="book-dock-upload"
      class="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      @click="openFilePicker"
    >
      <Loader2 v-if="isUploading" class="size-3.5 animate-spin" />
      <Upload v-else class="size-3.5" />
      {{ t('bookDock.uploadAction') }}
    </button>
  </div>
</template>
