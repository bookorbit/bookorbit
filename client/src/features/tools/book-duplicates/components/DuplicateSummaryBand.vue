<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BOOK_DUPLICATE_MATCH_REASONS, type BookDuplicateGroup, type BookDuplicateMatchReason } from '@bookorbit/types'

import { formatBytes } from '@/lib/formatting'
import { formatNumber } from '@/i18n/formatters'

const props = defineProps<{
  groups: BookDuplicateGroup[]
  totalGroups: number
  totalExtraCopies: number | null
  totalReclaimableBytes: number | null
  activeReason: BookDuplicateMatchReason | undefined
}>()

const emit = defineEmits<{ filter: [reason: BookDuplicateMatchReason | undefined] }>()

const { t } = useI18n()

const REASON_COLORS: Record<BookDuplicateMatchReason, string> = {
  file_hash: 'var(--pill-success)',
  isbn: 'var(--pill-info)',
  exact_metadata: 'var(--pill-source-indigo)',
  fuzzy_metadata: 'var(--pill-warning)',
}

/** Counts describe the loaded page; the totals beside them describe the whole scan. */
const reasonCounts = computed<Record<BookDuplicateMatchReason, number>>(() => {
  const counts = { file_hash: 0, isbn: 0, exact_metadata: 0, fuzzy_metadata: 0 }
  for (const group of props.groups) for (const reason of group.reasons) counts[reason] += 1
  return counts
})

const reasons = BOOK_DUPLICATE_MATCH_REASONS

function handleFilter(reason: BookDuplicateMatchReason): void {
  emit('filter', props.activeReason === reason ? undefined : reason)
}

function handleClear(): void {
  emit('filter', undefined)
}
</script>

<template>
  <div class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
    <p class="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[13px] text-muted-foreground" aria-live="polite">
      <span class="text-[15px] font-bold tabular-nums text-foreground">{{ formatNumber(totalGroups) }}</span>
      <span>{{ t('tools.bookDuplicates.summary.groups', totalGroups) }}</span>
      <template v-if="totalExtraCopies !== null">
        <span aria-hidden="true">&middot;</span>
        <span class="text-[15px] font-bold tabular-nums text-foreground">{{ formatNumber(totalExtraCopies) }}</span>
        <span>{{ t('tools.bookDuplicates.summary.extraCopies', totalExtraCopies) }}</span>
      </template>
      <template v-if="totalReclaimableBytes !== null">
        <span aria-hidden="true">&middot;</span>
        <span class="text-[15px] font-bold tabular-nums text-[var(--pill-success)]">{{ formatBytes(totalReclaimableBytes) }}</span>
        <span>{{ t('tools.bookDuplicates.summary.reclaimable') }}</span>
      </template>
    </p>

    <div class="flex flex-wrap items-center gap-1.5 sm:ms-auto" role="group" :aria-label="t('tools.bookDuplicates.filter')">
      <button
        v-if="activeReason"
        type="button"
        class="inline-flex h-[26px] items-center rounded-full px-2.5 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        @click="handleClear"
      >
        {{ t('tools.bookDuplicates.allReasons') }}
      </button>
      <button
        v-for="reason in reasons"
        :key="reason"
        type="button"
        class="inline-flex h-[26px] items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        :class="
          activeReason === reason
            ? 'border-primary/40 bg-primary/14 text-foreground'
            : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
        "
        :aria-pressed="activeReason === reason"
        @click="handleFilter(reason)"
      >
        <span class="size-1.5 rounded-full" :style="{ backgroundColor: REASON_COLORS[reason] }" aria-hidden="true" />
        {{ t(`tools.bookDuplicates.confidence.${reason}`) }}
        <span class="min-w-[18px] rounded-full bg-muted px-1.5 text-center text-[11px] font-bold tabular-nums text-muted-foreground">
          {{ formatNumber(reasonCounts[reason]) }}
        </span>
      </button>
    </div>
  </div>
</template>
