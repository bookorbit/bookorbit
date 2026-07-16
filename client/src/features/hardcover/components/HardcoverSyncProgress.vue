<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertCircle, RefreshCw, XCircle, Loader2 } from '@lucide/vue'
import { useHardcoverSync } from '../composables/useHardcoverSync'
import { useHardcoverSettings } from '../composables/useHardcoverSettings'

const { t } = useI18n()

const { activeSyncStatus, syncing, isSyncing, syncProgress, pendingSummary, loadingPending, error, startSync, cancelSync } = useHardcoverSync()
const { settings } = useHardcoverSettings()

const progressLabel = computed(() => {
  const s = activeSyncStatus.value
  if (!s) return ''
  return t('hardcover.sync.progressCount', { synced: s.syncedBooks, total: s.totalBooks })
})

const hasPending = computed(() => pendingSummary.value.pendingBooks > 0)
const syncScopeLabel = computed(() =>
  settings.value?.bookSyncMode === 'selected_only' ? t('hardcover.sync.scope.selected') : t('hardcover.sync.scope.eligible'),
)
const syncUnavailableReason = computed(() => {
  switch (settings.value?.disabledReason) {
    case 'permission_denied':
      return t('hardcover.sync.unavailable.permissionDenied')
    case 'user_disabled':
      return t('hardcover.sync.unavailable.userDisabled')
    default:
      return null
  }
})
const syncButtonDisabled = computed(() => syncing.value || loadingPending.value || !hasPending.value || syncUnavailableReason.value !== null)
const syncButtonLabel = computed(() => {
  if (syncUnavailableReason.value) return t('hardcover.sync.button.unavailable')
  return hasPending.value ? t('hardcover.sync.button.syncNowCount', { count: pendingSummary.value.pendingBooks }) : t('hardcover.sync.button.syncNow')
})

const lastSyncedLabel = computed(() => {
  const iso = settings.value?.lastSyncedAt
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (minutes < 1) return t('hardcover.sync.lastSynced.justNow')
  if (minutes < 60) return t('hardcover.sync.lastSynced.minutesAgo', { count: minutes })
  if (hours < 24) return t('hardcover.sync.lastSynced.hoursAgo', { count: hours }, hours)
  return t('hardcover.sync.lastSynced.daysAgo', { count: days }, days)
})
</script>

<template>
  <div class="border border-border rounded-lg bg-card px-4 py-4 md:px-5 md:py-5 shadow-xs space-y-4">
    <div class="flex items-center justify-between gap-4">
      <div>
        <p class="font-medium text-sm">{{ t('hardcover.sync.title') }}</p>
        <p class="text-xs text-muted-foreground mt-0.5">{{ t('hardcover.sync.description', { scope: syncScopeLabel }) }}</p>
        <p v-if="!isSyncing" class="text-xs text-muted-foreground mt-1">
          <template v-if="loadingPending">{{ t('hardcover.sync.checkingPending') }}</template>
          <template v-else-if="hasPending">
            {{ t('hardcover.sync.pendingOf', { pending: pendingSummary.pendingBooks, total: pendingSummary.totalBooks }) }}
            <span v-if="syncUnavailableReason">{{ syncUnavailableReason }}</span>
          </template>
          <template v-else-if="syncUnavailableReason">{{ syncUnavailableReason }}</template>
          <template v-else-if="pendingSummary.totalBooks === 0">{{ t('hardcover.sync.noBooksInScope') }}</template>
          <template v-else>{{ t('hardcover.sync.allSynced') }}</template>
        </p>
        <p v-if="lastSyncedLabel && !isSyncing" class="text-xs text-muted-foreground mt-0.5">
          {{ syncUnavailableReason ? t('hardcover.sync.lastSuccessfulSync') : t('hardcover.sync.lastSyncedLabel') }}: {{ lastSyncedLabel }}
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
          {{ t('common.cancel') }}
        </button>
      </div>
    </div>

    <div v-if="isSyncing" class="space-y-1.5">
      <div class="flex justify-between text-xs text-muted-foreground">
        <span>{{ t('hardcover.sync.syncing') }}</span>
        <span>{{ progressLabel }}</span>
      </div>
      <div class="h-1.5 rounded-full bg-muted overflow-hidden">
        <div class="h-full rounded-full bg-primary transition-all duration-300" :style="{ width: `${syncProgress}%` }" />
      </div>
    </div>
  </div>
</template>
