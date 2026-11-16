<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, CircleMinus, CircleX, History, Loader2 } from '@lucide/vue'
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

/**
 * Nothing to say until a request has been sent somewhere more than once. Not shown merely because
 * it is loading: most requests have no earlier attempt, and a box that appears to say "loading"
 * and then vanishes is a flash on every request opened.
 */
const show = computed(() => failed.value || earlier.value.length > 0)

watch(
  () => [props.request.id, props.request.download?.id, props.request.status] as const,
  ([id]) => {
    reset()
    void fetchAttempts(id)
  },
  { immediate: true },
)

/**
 * A refused attempt never reached a client, which is what the missing key means. Calling that
 * "download failed" would say something that did not happen: nothing was ever downloaded.
 */
function outcomeText(attempt: BookRequestDownloadItem): string {
  if (attempt.status === 'failed' && attempt.clientKey === null) return t('bookRequests.attempts.refused')
  return t(`bookRequests.download.status.${attempt.status}`)
}

function isRefusal(attempt: BookRequestDownloadItem): boolean {
  return attempt.status === 'failed'
}

function facts(attempt: BookRequestDownloadItem): string[] {
  const parts = [outcomeText(attempt), attempt.indexerName ?? t('bookRequests.attempts.handPicked')]
  if (attempt.releaseSizeBytes !== null) parts.push(formatBytes(attempt.releaseSizeBytes))
  parts.push(formatDate(new Date(attempt.createdAt), { dateStyle: 'medium', timeStyle: 'short' }))
  return parts
}
</script>

<template>
  <details v-if="show" :key="request.id" class="group mt-3">
    <summary
      class="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-sm text-xs text-foreground hover:underline hover:underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden"
    >
      <History :size="13" aria-hidden="true" />
      <span>{{ failed ? t('bookRequests.attempts.title') : t('bookRequests.attempts.summary', { count: earlier.length }) }}</span>
      <ChevronDown :size="13" class="transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
    </summary>

    <div v-if="loading" class="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      {{ t('bookRequests.attempts.loading') }}
    </div>

    <p v-else-if="failed" role="alert" class="mt-2 text-xs text-destructive">{{ t('bookRequests.attempts.loadFailed') }}</p>

    <ul v-else>
      <li v-for="attempt in earlier" :key="attempt.id" class="mt-2 flex gap-2 ps-0.5">
        <CircleX v-if="isRefusal(attempt)" :size="14" class="mt-0.5 flex-none text-destructive" aria-hidden="true" />
        <CircleMinus v-else :size="14" class="mt-0.5 flex-none text-muted-foreground" aria-hidden="true" />
        <div class="min-w-0">
          <p class="text-[13px] [overflow-wrap:anywhere] text-foreground">{{ attempt.releaseTitle }}</p>
          <p class="mt-0.5 text-xs text-muted-foreground">
            <template v-for="(fact, index) in facts(attempt)" :key="index">
              <span v-if="index > 0" aria-hidden="true"> · </span>
              <span>{{ fact }}</span>
            </template>
          </p>
          <p v-if="attempt.errorMessage" class="mt-0.5 text-xs [overflow-wrap:anywhere] text-muted-foreground">{{ attempt.errorMessage }}</p>
        </div>
      </li>
    </ul>
  </details>
</template>
