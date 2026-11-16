<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BookDockHoldReason } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { HOLD_REASON_ORDER, HOLD_TONE_CLASS, holdReasonLabel, holdStyle } from '../lib/hold-reason'

const props = defineProps<{
  /** Held files per reason in the dock being shown. */
  counts: Partial<Record<BookDockHoldReason, number>>
  current: BookDockHoldReason | null
}>()

const emit = defineEmits<{ select: [BookDockHoldReason | null] }>()

const { t } = useI18n()

const total = computed(() => Object.values(props.counts).reduce((sum, count) => sum + (count ?? 0), 0))

const reasons = computed(() =>
  HOLD_REASON_ORDER.filter((reason) => (props.counts[reason] ?? 0) > 0 || reason === props.current).map((reason) => ({
    reason,
    label: holdReasonLabel(reason, t),
    count: props.counts[reason] ?? 0,
    dot: HOLD_TONE_CLASS[holdStyle(reason).tone].dot,
  })),
)

function selectAny() {
  emit('select', null)
}

function select(reason: BookDockHoldReason) {
  emit('select', reason)
}
</script>

<template>
  <div
    role="group"
    :aria-label="t('bookDock.hold.rowLabel')"
    data-testid="book-dock-reason-row"
    class="flex flex-wrap items-center gap-1.5 border-b border-border bg-muted/20 px-3 py-2"
  >
    <span class="me-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase" aria-hidden="true">{{ t('bookDock.hold.why') }}</span>
    <button
      type="button"
      data-testid="book-dock-reason-any"
      :aria-pressed="props.current === null"
      class="reason-chip inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary"
      @click="selectAny"
    >
      <span class="size-[7px] shrink-0 rounded-full bg-foreground" aria-hidden="true" />
      {{ t('bookDock.hold.anyReason') }}
      <span class="reason-count font-semibold tabular-nums">{{ formatNumber(total) }}</span>
    </button>
    <button
      v-for="item in reasons"
      :key="item.reason"
      type="button"
      :data-testid="`book-dock-reason-${item.reason}`"
      :aria-pressed="props.current === item.reason"
      class="reason-chip inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary"
      @click="select(item.reason)"
    >
      <span class="size-[7px] shrink-0 rounded-full" :class="item.dot" aria-hidden="true" />
      {{ item.label }}
      <span class="reason-count font-semibold tabular-nums">{{ formatNumber(item.count) }}</span>
    </button>
  </div>
</template>

<style scoped>
.reason-chip .reason-count {
  color: var(--muted-foreground);
}
.reason-chip[aria-pressed='true'] .reason-count {
  color: var(--primary);
}
</style>
