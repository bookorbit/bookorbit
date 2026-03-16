<script setup lang="ts">
import { ref } from 'vue'
import { X, Play, Square, AlertTriangle } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { AuthorEnrichmentStatusEvent } from '@projectx/types'
import { useAuthorEnrichmentActions } from '@/features/settings/composables/useAuthorEnrichmentActions'

const props = defineProps<{
  status: AuthorEnrichmentStatusEvent
}>()
const emit = defineEmits<{
  close: []
  openReport: []
}>()

const { pause, resume, cancelPending } = useAuthorEnrichmentActions()

const acting = ref(false)
const confirmingCancel = ref(false)

async function handlePause() {
  if (acting.value) return
  acting.value = true
  try {
    await pause()
  } catch {
    toast.error('Failed to pause')
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
    toast.error('Failed to resume')
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
    toast.error('Failed to cancel')
  } finally {
    acting.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-3 p-3 min-w-[220px]">
    <div class="flex items-center justify-between">
      <span class="text-sm font-medium text-emerald-500">Author Enrichment</span>
      <button class="text-muted-foreground hover:text-foreground" @click="emit('close')">
        <X :size="14" />
      </button>
    </div>

    <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
      <span class="text-muted-foreground">Queued</span>
      <span class="text-right font-medium">{{ props.status.queued }}</span>
      <span class="text-muted-foreground">Processing</span>
      <span class="text-right font-medium">{{ props.status.processing }}</span>
      <template v-if="props.status.rateLimited > 0">
        <span class="text-muted-foreground">Rate limited</span>
        <span class="text-right font-medium text-amber-500">{{ props.status.rateLimited }}</span>
      </template>
      <span class="text-muted-foreground">Failed</span>
      <span class="text-right font-medium" :class="props.status.failed > 0 ? 'text-destructive' : ''">{{ props.status.failed }}</span>
    </div>

    <div v-if="!confirmingCancel" class="flex gap-2">
      <button
        v-if="!props.status.paused && (props.status.queued > 0 || props.status.processing > 0 || props.status.rateLimited > 0)"
        :disabled="acting"
        class="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-muted disabled:opacity-50"
        @click="handlePause"
      >
        <Square :size="12" />
        Pause
      </button>
      <button
        v-if="props.status.paused && (props.status.queued > 0 || props.status.processing > 0 || props.status.rateLimited > 0)"
        :disabled="acting"
        class="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-muted disabled:opacity-50"
        @click="handleResume"
      >
        <Play :size="12" />
        Resume
      </button>
      <button
        v-if="props.status.queued > 0 || props.status.rateLimited > 0"
        :disabled="acting"
        class="px-2 py-1 text-xs rounded border border-border hover:bg-muted text-destructive disabled:opacity-50"
        @click="confirmingCancel = true"
      >
        Cancel queued
      </button>
    </div>

    <div v-else class="flex flex-col gap-1.5">
      <div class="flex items-center gap-1 text-xs text-muted-foreground">
        <AlertTriangle :size="11" class="text-amber-500 shrink-0" />
        Currently processing items will finish.
      </div>
      <div class="flex gap-1.5">
        <button
          :disabled="acting"
          class="px-2 py-1 text-xs rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          @click="handleCancelConfirm"
        >
          Confirm cancel
        </button>
        <button class="px-2 py-1 text-xs rounded border border-border hover:bg-muted" @click="confirmingCancel = false">Keep running</button>
      </div>
    </div>

    <button v-if="props.status.failed > 0" class="text-xs text-emerald-500 hover:underline text-left" @click="emit('openReport')">
      View {{ props.status.failed }} failed
    </button>
  </div>
</template>
