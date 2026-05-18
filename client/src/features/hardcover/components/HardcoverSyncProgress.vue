<script setup lang="ts">
import { computed } from 'vue'
import { RefreshCw, XCircle, Loader2 } from 'lucide-vue-next'
import { useHardcoverSync } from '../composables/useHardcoverSync'
import { useHardcoverSettings } from '../composables/useHardcoverSettings'

const { activeSyncStatus, syncing, isSyncing, syncProgress, pendingSummary, loadingPending, startSync, cancelSync } = useHardcoverSync()
const { settings } = useHardcoverSettings()

const progressLabel = computed(() => {
  const s = activeSyncStatus.value
  if (!s) return ''
  return `${s.syncedBooks} / ${s.totalBooks} books`
})

const hasPending = computed(() => pendingSummary.value.pendingBooks > 0)
const syncButtonDisabled = computed(() => syncing.value || loadingPending.value || !hasPending.value)
const syncButtonLabel = computed(() => (hasPending.value ? `Sync now (${pendingSummary.value.pendingBooks})` : 'Sync now'))

const lastSyncedLabel = computed(() => {
  const iso = settings.value?.lastSyncedAt
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  return `${days} day${days === 1 ? '' : 's'} ago`
})
</script>

<template>
  <div class="border border-border rounded-lg bg-card px-4 py-4 md:px-5 md:py-5 shadow-xs space-y-4">
    <div class="flex items-center justify-between gap-4">
      <div>
        <p class="font-medium text-sm">Manual sync</p>
        <p class="text-xs text-muted-foreground mt-0.5">Push all your reading data to Hardcover now.</p>
        <p v-if="!isSyncing" class="text-xs text-muted-foreground mt-1">
          <template v-if="loadingPending">Checking pending items...</template>
          <template v-else-if="hasPending">{{ pendingSummary.pendingBooks }} pending of {{ pendingSummary.totalBooks }} books.</template>
          <template v-else-if="pendingSummary.totalBooks === 0">No eligible books to sync.</template>
          <template v-else>All books are already synced.</template>
        </p>
        <p v-if="lastSyncedLabel && !isSyncing" class="text-xs text-muted-foreground mt-0.5">Last synced: {{ lastSyncedLabel }}</p>
      </div>

      <div class="flex items-center gap-2">
        <button
          v-if="!isSyncing"
          type="button"
          :disabled="syncButtonDisabled"
          class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          @click="startSync"
        >
          <Loader2 v-if="syncing" class="size-3.5 animate-spin" />
          <RefreshCw v-else class="size-3.5" />
          {{ syncButtonLabel }}
        </button>
        <button
          v-else
          type="button"
          class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
          @click="cancelSync"
        >
          <XCircle class="size-3.5" />
          Cancel
        </button>
      </div>
    </div>

    <div v-if="isSyncing" class="space-y-1.5">
      <div class="flex justify-between text-xs text-muted-foreground">
        <span>Syncing...</span>
        <span>{{ progressLabel }}</span>
      </div>
      <div class="h-1.5 rounded-full bg-muted overflow-hidden">
        <div class="h-full rounded-full bg-primary transition-all duration-300" :style="{ width: `${syncProgress}%` }" />
      </div>
    </div>
  </div>
</template>
