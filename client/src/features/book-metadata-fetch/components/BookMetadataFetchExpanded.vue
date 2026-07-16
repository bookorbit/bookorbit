<script setup lang="ts">
import { ref } from 'vue'
import { X, Play, Square, AlertTriangle } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { BookMetadataFetchStatusEvent } from '@bookorbit/types'
import { useI18n } from 'vue-i18n'
import { useBookMetadataFetchActions } from '../composables/useBookMetadataFetchActions'

const { t } = useI18n()

const props = defineProps<{
  status: BookMetadataFetchStatusEvent
}>()
const emit = defineEmits<{
  close: []
  openReport: []
}>()

const { pause, resume, cancelPending } = useBookMetadataFetchActions()

const acting = ref(false)
const confirmingCancel = ref(false)

async function handlePause() {
  if (acting.value) return
  acting.value = true
  try {
    await pause()
  } catch {
    toast.error(t('bookMetadataFetch.toast.failedToPause'))
  } finally {
    acting.value = false
  }
}

async function handleResume() {
  if (acting.value) return
  acting.value = true
  try {
    await resume()
  } catch {
    toast.error(t('bookMetadataFetch.toast.failedToResume'))
  } finally {
    acting.value = false
  }
}

async function handleCancelConfirm() {
  if (acting.value) return
  acting.value = true
  confirmingCancel.value = false
  try {
    await cancelPending()
  } catch {
    toast.error(t('bookMetadataFetch.toast.failedToCancel'))
  } finally {
    acting.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-3 p-3 min-w-[220px]">
    <div class="flex items-center justify-between">
      <span class="text-sm font-medium text-violet-500">{{ t('bookMetadataFetch.book.title') }}</span>
      <button class="text-muted-foreground hover:text-foreground" @click="emit('close')">
        <X :size="14" />
      </button>
    </div>

    <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
      <span class="text-muted-foreground">{{ t('bookMetadataFetch.stats.queued') }}</span>
      <span class="text-right font-medium">{{ props.status.queued }}</span>
      <span class="text-muted-foreground">{{ t('bookMetadataFetch.stats.processing') }}</span>
      <span class="text-right font-medium">{{ props.status.processing }}</span>
      <span class="text-muted-foreground">{{ t('bookMetadataFetch.stats.failed') }}</span>
      <span class="text-right font-medium" :class="props.status.failed > 0 ? 'text-destructive' : ''">{{ props.status.failed }}</span>
    </div>

    <div v-if="!confirmingCancel" class="flex gap-2">
      <button
        v-if="!props.status.paused && (props.status.queued > 0 || props.status.processing > 0)"
        :disabled="acting"
        class="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-muted disabled:opacity-50"
        @click="handlePause"
      >
        <Square :size="12" />
        {{ t('bookMetadataFetch.actions.pause') }}
      </button>
      <button
        v-if="props.status.paused && (props.status.queued > 0 || props.status.processing > 0)"
        :disabled="acting"
        class="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-muted disabled:opacity-50"
        @click="handleResume"
      >
        <Play :size="12" />
        {{ t('bookMetadataFetch.actions.resume') }}
      </button>
      <button
        v-if="props.status.queued > 0"
        :disabled="acting"
        class="px-2 py-1 text-xs rounded border border-border hover:bg-muted text-destructive disabled:opacity-50"
        @click="confirmingCancel = true"
      >
        {{ t('bookMetadataFetch.actions.cancelQueued') }}
      </button>
    </div>

    <div v-else class="flex flex-col gap-1.5">
      <div class="flex items-center gap-1 text-xs text-muted-foreground">
        <AlertTriangle :size="11" class="text-amber-500 shrink-0" />
        {{ t('bookMetadataFetch.cancel.processingWillFinish') }}
      </div>
      <div class="flex gap-1.5">
        <button
          :disabled="acting"
          class="px-2 py-1 text-xs rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          @click="handleCancelConfirm"
        >
          {{ t('bookMetadataFetch.cancel.confirm') }}
        </button>
        <button class="px-2 py-1 text-xs rounded border border-border hover:bg-muted" @click="confirmingCancel = false">
          {{ t('bookMetadataFetch.cancel.keepRunning') }}
        </button>
      </div>
    </div>

    <button v-if="props.status.failed > 0" class="text-xs text-violet-500 hover:underline text-left" @click="emit('openReport')">
      {{ t('bookMetadataFetch.viewFailed', { count: props.status.failed }, props.status.failed) }}
    </button>
  </div>
</template>
