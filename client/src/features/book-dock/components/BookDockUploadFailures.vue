<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertCircle, RotateCw, X } from '@lucide/vue'
import { useBookDockUpload } from '../composables/useBookDockUpload'
import { describeUploadFailure, isRetryableUploadFailure } from '../lib/upload-failure'

const { t } = useI18n()
const { failures, retryFailure, dismissFailure, dismissAllFailures } = useBookDockUpload()

const rows = computed(() =>
  failures.value.map((item) => {
    const reason = item.failure ? describeUploadFailure(item.failure) : { key: 'bookDock.uploadFailures.reason.network' }
    return {
      id: item.id,
      name: item.file.name,
      reason: 'text' in reason ? reason.text : t(reason.key, reason.params ?? {}),
      retryable: item.failure ? isRetryableUploadFailure(item.failure) : false,
    }
  }),
)

function handleRetry(id: string) {
  retryFailure(id)
}

function handleDismiss(id: string) {
  dismissFailure(id)
}
</script>

<template>
  <section
    v-if="rows.length > 0"
    aria-labelledby="book-dock-upload-failures-heading"
    data-testid="book-dock-upload-failures"
    class="overflow-hidden rounded-xl border border-destructive/30 bg-destructive/5"
  >
    <div class="flex items-center gap-2 px-4 py-2.5">
      <AlertCircle class="size-4 shrink-0 text-destructive" aria-hidden="true" />
      <h2 id="book-dock-upload-failures-heading" class="min-w-0 flex-1 text-sm font-medium text-foreground">
        <span role="alert">{{ t('bookDock.uploadFailures.heading', { count: rows.length }) }}</span>
      </h2>
      <button
        v-if="rows.length > 1"
        type="button"
        data-testid="book-dock-upload-failures-dismiss-all"
        class="h-7 shrink-0 rounded-lg px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        @click="dismissAllFailures"
      >
        {{ t('bookDock.uploadFailures.dismissAll') }}
      </button>
    </div>
    <ul class="max-h-64 divide-y divide-destructive/15 overflow-y-auto border-t border-destructive/20">
      <li v-for="row in rows" :key="row.id" class="flex items-center gap-3 px-4 py-2">
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm text-foreground" :title="row.name">{{ row.name }}</p>
          <p class="text-xs text-destructive">{{ row.reason }}</p>
        </div>
        <button
          v-if="row.retryable"
          type="button"
          class="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :title="t('bookDock.uploadFailures.retry', { name: row.name })"
          :aria-label="t('bookDock.uploadFailures.retry', { name: row.name })"
          @click="handleRetry(row.id)"
        >
          <RotateCw class="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :title="t('bookDock.uploadFailures.dismiss', { name: row.name })"
          :aria-label="t('bookDock.uploadFailures.dismiss', { name: row.name })"
          @click="handleDismiss(row.id)"
        >
          <X class="size-3.5" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </section>
</template>
