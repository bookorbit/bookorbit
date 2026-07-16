<script setup lang="ts">
import { computed } from 'vue'
import { AlertCircle, RefreshCw, XCircle, Loader2 } from '@lucide/vue'
import { useStorygraphSync } from '../composables/useStorygraphSync'
import { useStorygraphSettings } from '../composables/useStorygraphSettings'

const {
  activeSyncStatus,
  lastRunSummary,
  syncFailures,
  syncing,
  isSyncing,
  syncProgress,
  pendingSummary,
  loadingPending,
  error,
  startSync,
  cancelSync,
} = useStorygraphSync()
const { settings } = useStorygraphSettings()

const progressLabel = computed(() => {
  const s = activeSyncStatus.value
  if (!s) return ''
  return `${s.processedBooks} / ${s.totalBooks} books`
})

const liveCountsLabel = computed(() => {
  const s = activeSyncStatus.value
  if (!s) return ''
  const parts = [`${s.syncedBooks} synced`]
  if (s.skippedBooks > 0) parts.push(`${s.skippedBooks} skipped`)
  return parts.join(' · ')
})

const lastRunLabel = computed(() => {
  const s = lastRunSummary.value
  if (!s) return null
  const verb = s.status === 'cancelled' ? 'Last run cancelled' : 'Last run'
  return `${verb}: ${s.syncedBooks} synced · ${s.skippedBooks} skipped · ${s.failedBooks} failed`
})

const failureLabel = (error: string): string => {
  switch (error) {
    case 'no_match':
      return 'No StoryGraph match found'
    case 'storygraph_session_expired':
      return 'StoryGraph session expired, re-paste your cookies'
    default:
      return error.startsWith('status_update_failed') ? 'StoryGraph rejected the status update' : error
  }
}

const hasPending = computed(() => pendingSummary.value.pendingBooks > 0)
const syncScopeLabel = computed(() => (settings.value?.bookSyncMode === 'selected_only' ? 'selected books' : 'eligible books'))
const syncUnavailableReason = computed(() => {
  switch (settings.value?.disabledReason) {
    case 'permission_denied':
      return 'You do not have permission to use StoryGraph sync.'
    case 'user_disabled':
      return 'Sync is paused in your StoryGraph settings.'
    default:
      return null
  }
})
const syncButtonDisabled = computed(() => syncing.value || loadingPending.value || !hasPending.value || syncUnavailableReason.value !== null)
const syncButtonLabel = computed(() => {
  if (syncUnavailableReason.value) return 'Sync unavailable'
  return hasPending.value ? `Sync now (${pendingSummary.value.pendingBooks})` : 'Sync now'
})

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
        <p class="text-xs text-muted-foreground mt-0.5">Push your {{ syncScopeLabel }} to StoryGraph now.</p>
        <p v-if="!isSyncing" class="text-xs text-muted-foreground mt-1">
          <template v-if="loadingPending">Checking pending items...</template>
          <template v-else-if="hasPending">
            {{ pendingSummary.pendingBooks }} pending of {{ pendingSummary.totalBooks }} books.
            <span v-if="syncUnavailableReason">{{ syncUnavailableReason }}</span>
          </template>
          <template v-else-if="syncUnavailableReason">{{ syncUnavailableReason }}</template>
          <template v-else-if="pendingSummary.totalBooks === 0">No books in sync scope.</template>
          <template v-else>All books are already synced.</template>
        </p>
        <p v-if="lastSyncedLabel && !isSyncing" class="text-xs text-muted-foreground mt-0.5">
          {{ syncUnavailableReason ? 'Last successful sync' : 'Last synced' }}: {{ lastSyncedLabel }}
        </p>
        <p v-if="error && !isSyncing" class="flex items-center gap-1 text-xs text-destructive mt-1">
          <AlertCircle class="size-3.5" />
          {{ error }}
        </p>
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
        <span>
          Syncing... {{ liveCountsLabel }}
          <span v-if="activeSyncStatus && activeSyncStatus.failedBooks > 0" class="text-destructive"
            >· {{ activeSyncStatus.failedBooks }} failed</span
          >
        </span>
        <span>{{ progressLabel }}</span>
      </div>
      <div class="h-1.5 rounded-full bg-muted overflow-hidden">
        <div class="h-full rounded-full bg-primary transition-all duration-300" :style="{ width: `${syncProgress}%` }" />
      </div>
    </div>

    <p v-if="lastRunLabel && !isSyncing" class="text-xs text-muted-foreground">
      {{ lastRunLabel }}
    </p>

    <div v-if="syncFailures.length > 0 && !isSyncing" class="space-y-1.5 pt-2 border-t border-border">
      <p class="flex items-center gap-1.5 text-xs font-medium text-destructive">
        <AlertCircle class="size-3.5 shrink-0" />
        {{ syncFailures.length }} book{{ syncFailures.length === 1 ? '' : 's' }} failed to sync
      </p>
      <ul class="space-y-1">
        <li v-for="failure in syncFailures" :key="failure.bookId" class="text-xs text-muted-foreground">
          <span class="text-foreground">{{ failure.title }}</span>
          <span v-if="failure.authorName"> - {{ failure.authorName }}</span>
          <span class="text-destructive"> · {{ failureLabel(failure.syncError) }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
