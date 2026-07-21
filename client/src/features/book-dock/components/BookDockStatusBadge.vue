<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2 } from '@lucide/vue'
import type { BookDockFileStatus } from '@bookorbit/types'

defineProps<{ status: BookDockFileStatus }>()

const { t } = useI18n()

const styles: Record<BookDockFileStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  extracting: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  fetching: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  ready: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  error: 'bg-red-500/15 text-red-600 dark:text-red-400',
}

const labels = computed<Record<BookDockFileStatus, string>>(() => ({
  pending: t('bookDock.status.pending'),
  extracting: t('bookDock.status.extracting'),
  fetching: t('bookDock.status.fetching'),
  ready: t('bookDock.status.ready'),
  error: t('bookDock.status.error'),
}))
</script>

<template>
  <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" :class="styles[status]">
    <Loader2 v-if="status === 'extracting' || status === 'fetching'" class="size-2.5 animate-spin" />
    {{ labels[status] }}
  </span>
</template>
