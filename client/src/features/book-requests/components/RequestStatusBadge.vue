<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, TriangleAlert } from '@lucide/vue'
import type { BookRequestStatus } from '@bookorbit/types'

const props = defineProps<{ status: BookRequestStatus }>()

const { t } = useI18n()

/**
 * Eleven statuses across five tones. Status is spelled out in text beside the colour, and the two
 * terminal tones carry an icon as well, so nothing here is signalled by colour alone.
 */
const TONES = {
  waiting: 'border-warning/40 bg-warning/10 text-warning',
  progress: 'border-info/40 bg-info/10 text-info',
  done: 'border-success/40 bg-success/10 text-success',
  failed: 'border-destructive/40 bg-destructive/10 text-destructive',
  stopped: 'border-border bg-muted text-muted-foreground',
} as const

type Tone = keyof typeof TONES

const STATUS_TONES: Record<BookRequestStatus, Tone> = {
  pending: 'waiting',
  approved: 'progress',
  searching: 'progress',
  grabbed: 'progress',
  downloading: 'progress',
  importing: 'progress',
  needs_review: 'waiting',
  available: 'done',
  rejected: 'failed',
  failed: 'failed',
  cancelled: 'stopped',
}

const tone = computed(() => STATUS_TONES[props.status] ?? 'stopped')
const label = computed(() => t(`bookRequests.status.${props.status}`))
</script>

<template>
  <span
    class="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap"
    :class="TONES[tone]"
  >
    <Check v-if="tone === 'done'" :size="12" :stroke-width="2.5" aria-hidden="true" />
    <TriangleAlert v-else-if="tone === 'failed'" :size="12" aria-hidden="true" />
    <span v-else class="size-1.5 rounded-full bg-current" aria-hidden="true" />
    {{ label }}
  </span>
</template>
