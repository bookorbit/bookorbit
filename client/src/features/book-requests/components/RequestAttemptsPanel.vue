<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Globe, Loader2, Magnet } from '@lucide/vue'
import type { BookRequestDownloadItem, BookRequestItem } from '@bookorbit/types'
import { formatDate } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import { useRequestAttempts } from '../composables/useRequestAttempts'

const props = defineProps<{
  request: BookRequestItem
  /** Moderating the queue, which decides whether the admin or the self-fulfil endpoint serves this. */
  canManage: boolean
}>()

const { t } = useI18n()
const { attempts, loading, failed, fetchAttempts, reset } = useRequestAttempts(() => props.canManage)

/**
 * Everything except the attempt the transfer section is already showing. Matched by id rather
 * than dropped by position, so a request whose newest attempt is not the one on the row keeps it.
 */
const earlier = computed(() => attempts.value.filter((attempt) => attempt.id !== props.request.download?.id))

/** Nothing to say until a request has been sent somewhere more than once. */
const show = computed(() => loading.value || failed.value || earlier.value.length > 0)

watch(
  () => [props.request.id, props.request.download?.id, props.request.status] as const,
  ([id]) => {
    reset()
    void fetchAttempts(id)
  },
  { immediate: true },
)

/**
 * A refused attempt never reached a client, which is what the missing hash means. Calling that
 * "download failed" would say something that did not happen: nothing was ever downloaded.
 */
function outcomeText(attempt: BookRequestDownloadItem): string {
  if (attempt.status === 'failed' && attempt.clientHash === null) return t('bookRequests.attempts.refused')
  return t(`bookRequests.download.status.${attempt.status}`)
}

function isRefusal(attempt: BookRequestDownloadItem): boolean {
  return attempt.status === 'failed'
}

function seedsBack(attempt: BookRequestDownloadItem): boolean {
  return attempt.source !== 'direct_url'
}

function facts(attempt: BookRequestDownloadItem): string[] {
  const parts = [attempt.indexerName ?? t('bookRequests.attempts.handPicked')]
  if (attempt.releaseSizeBytes !== null) parts.push(formatBytes(attempt.releaseSizeBytes))
  parts.push(formatDate(new Date(attempt.createdAt), { dateStyle: 'medium', timeStyle: 'short' }))
  return parts
}
</script>

<template>
  <section v-if="show" class="rounded-lg border border-border bg-card p-4" :aria-label="t('bookRequests.attempts.title')">
    <h3 class="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{{ t('bookRequests.attempts.title') }}</h3>

    <div v-if="loading" class="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 class="size-4 animate-spin" aria-hidden="true" />
      {{ t('bookRequests.attempts.loading') }}
    </div>

    <p v-else-if="failed" role="alert" class="text-sm text-destructive">{{ t('bookRequests.attempts.loadFailed') }}</p>

    <ul v-else class="space-y-2.5">
      <li v-for="attempt in earlier" :key="attempt.id" class="text-sm">
        <p class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            class="inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-xs font-medium"
            :class="isRefusal(attempt) ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-border text-muted-foreground'"
          >
            <Magnet v-if="seedsBack(attempt)" :size="11" aria-hidden="true" />
            <Globe v-else :size="11" aria-hidden="true" />
            {{ outcomeText(attempt) }}
          </span>
          <span class="min-w-0 flex-1 truncate text-foreground">{{ attempt.releaseTitle }}</span>
        </p>

        <p class="mt-0.5 text-xs text-muted-foreground">
          <template v-for="(fact, index) in facts(attempt)" :key="fact">
            <span v-if="index > 0" aria-hidden="true"> · </span>
            <span>{{ fact }}</span>
          </template>
        </p>

        <p v-if="attempt.errorMessage" class="mt-0.5 text-xs text-destructive">{{ attempt.errorMessage }}</p>
      </li>
    </ul>
  </section>
</template>
