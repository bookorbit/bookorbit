<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, TriangleAlert } from '@lucide/vue'
import type { ReadAloudJobEvent } from '@bookorbit/types'
import { formatDateTime, formatRelativeFromNow } from '@/i18n/formatters'
import { eventText, stageLabelKey } from '../lib/read-aloud'

const props = defineProps<{ events: ReadAloudJobEvent[]; loading: boolean; failed: boolean }>()
const emit = defineEmits<{ retry: [] }>()

const { t, te } = useI18n()

/** Newest first: the question the log answers is "what is it doing now", then "what happened before". */
const rows = computed(() => {
  const now = Date.now()
  return [...props.events].reverse().map((event) => {
    const at = new Date(event.at)
    const valid = !Number.isNaN(at.getTime())
    const { text, detail } = eventText(event, t, te)
    return {
      id: event.id,
      at: event.at,
      relative: valid ? formatRelativeFromNow(at, now) : '',
      absolute: valid ? formatDateTime(at) : '',
      level: event.level,
      stage: event.stage ? t(stageLabelKey(event.stage)) : null,
      message: text,
      detail,
    }
  })
})

function handleRetry(): void {
  emit('retry')
}
</script>

<template>
  <div class="rounded-lg border border-border">
    <p v-if="loading" class="px-3 py-2.5 text-[12.5px] text-muted-foreground" role="status">{{ t('book.detail.files.readAloud.log.loading') }}</p>
    <p v-else-if="failed && rows.length === 0" class="flex flex-wrap items-center gap-2 px-3 py-2.5 text-[12.5px] text-muted-foreground">
      {{ t('book.detail.files.readAloud.log.loadFailed') }}
      <button
        type="button"
        class="rounded font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click="handleRetry"
      >
        {{ t('book.detail.files.readAloud.log.tryAgain') }}
      </button>
    </p>
    <p v-else-if="rows.length === 0" class="px-3 py-2.5 text-[12.5px] text-muted-foreground">{{ t('book.detail.files.readAloud.log.empty') }}</p>
    <ol v-else class="max-h-64 overflow-y-auto" :aria-label="t('book.detail.files.readAloud.log.heading')">
      <li v-for="row in rows" :key="row.id" class="flex gap-3 border-b border-border px-3 py-2 last:border-b-0">
        <time :datetime="row.at" :title="row.absolute" class="w-24 shrink-0 text-[12px] tabular-nums text-muted-foreground">{{ row.relative }}</time>
        <div class="min-w-0 flex-1">
          <p class="break-words text-[12.5px] text-foreground">
            <span v-if="row.level === 'warn'" class="me-1 inline-flex items-center gap-1 font-semibold">
              <TriangleAlert class="size-3.5 shrink-0 text-warning" aria-hidden="true" />
              {{ t('book.detail.files.readAloud.log.warn') }}
            </span>
            <span v-else-if="row.level === 'error'" class="me-1 inline-flex items-center gap-1 font-semibold">
              <CircleAlert class="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
              {{ t('book.detail.files.readAloud.log.error') }}
            </span>
            {{ row.message }}
          </p>
          <p v-if="row.detail" class="mt-0.5 break-words font-mono text-[11.5px] text-muted-foreground">{{ row.detail }}</p>
          <p v-if="row.stage" class="mt-0.5 text-[11.5px] text-muted-foreground">{{ row.stage }}</p>
        </div>
      </li>
    </ol>
  </div>
</template>
