<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, X } from '@lucide/vue'
import { BOOK_REQUEST_SELECT_ALL_LIMIT } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/i18n/formatters'
import { isDestructiveAction, type BulkActionState, type RequestAction } from '../requestSelection'

/**
 * The strip above the list. Idle it states the total; with rows ticked it becomes the selection
 * bar in the same place and at the same height, so the table never moves. On a wide screen every
 * bulk action sits here; narrower, the actions dock at the bottom instead and this keeps the count.
 */
const props = defineProps<{
  total: number
  selectedCount: number
  mode: 'page' | 'matching'
  truncated: boolean
  offerSelectAll: boolean
  selectingAll: boolean
  pageSelection: 'none' | 'some' | 'all'
  actions: BulkActionState[]
  busy: boolean
}>()

const emit = defineEmits<{
  'toggle-select-page': []
  'select-all-matching': []
  clear: []
  run: [action: RequestAction]
}>()

const { t } = useI18n()

const hasSelection = computed(() => props.selectedCount > 0)
const selectAllCount = computed(() => Math.min(props.total, BOOK_REQUEST_SELECT_ALL_LIMIT))

const summary = computed(() => {
  if (!hasSelection.value) return t('bookRequests.bulkBar.total', { count: props.total })
  if (props.mode === 'matching' && props.truncated) return t('bookRequests.bulkBar.firstSelected', { count: props.selectedCount })
  if (props.mode === 'matching' && props.selectedCount >= props.total) return t('bookRequests.bulkBar.allSelected', { count: props.selectedCount })
  return t('bookRequests.bulkBar.selected', { count: props.selectedCount })
})

function buttonVariant(entry: BulkActionState) {
  if (entry.action === 'approve') return 'default'
  return isDestructiveAction(entry.action) ? 'destructive-outline' : 'outline'
}

function handleTogglePage() {
  emit('toggle-select-page')
}

function handleSelectAll() {
  emit('select-all-matching')
}

function handleClear() {
  emit('clear')
}

function handleRun(action: RequestAction) {
  emit('run', action)
}
</script>

<template>
  <div
    class="sticky -top-(--shell-gap) z-20 flex h-12 items-center gap-2 border-b border-border px-3"
    :class="hasSelection ? 'bg-[color-mix(in_oklab,var(--primary)_8%,var(--card))]' : 'bg-card'"
    role="region"
    :aria-label="t('bookRequests.bulkBar.label')"
  >
    <!-- The table header has its own page checkbox; the cards below `xl` have none, so this is it. -->
    <input
      type="checkbox"
      class="block size-4 shrink-0 cursor-pointer rounded-xs border-border accent-primary xl:hidden"
      :checked="pageSelection === 'all'"
      :indeterminate.prop="pageSelection === 'some'"
      :aria-label="t('bookRequests.table.selectPage')"
      @change="handleTogglePage"
    />

    <p
      class="min-w-0 truncate text-[13px] tabular-nums"
      :class="hasSelection ? 'font-semibold text-foreground' : 'text-muted-foreground'"
      aria-live="polite"
    >
      {{ summary }}
    </p>

    <button
      v-if="offerSelectAll"
      type="button"
      class="inline-flex shrink-0 items-center gap-1.5 rounded-sm px-1 text-[13px] font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
      :disabled="selectingAll"
      @click="handleSelectAll"
    >
      <Loader2 v-if="selectingAll" :size="13" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
      {{ selectingAll ? t('bookRequests.bulkBar.selecting') : t('bookRequests.bulkBar.selectAll', { count: selectAllCount }) }}
    </button>
    <span
      v-if="hasSelection && mode === 'matching' && truncated"
      class="hidden truncate text-xs text-muted-foreground 2xl:inline"
      :title="t('bookRequests.bulkBar.truncatedHint', { limit: formatNumber(BOOK_REQUEST_SELECT_ALL_LIMIT) })"
    >
      {{ t('bookRequests.bulkBar.truncatedHint', { limit: formatNumber(BOOK_REQUEST_SELECT_ALL_LIMIT) }) }}
    </span>

    <div class="flex-1" />

    <div v-if="hasSelection" class="hidden items-center gap-1.5 xl:flex">
      <span
        v-for="entry in actions"
        :key="entry.action"
        class="inline-flex"
        :title="entry.rows === 0 ? t(`bookRequests.bulkBar.why.${entry.action}`) : undefined"
      >
        <Button
          :variant="buttonVariant(entry)"
          size="sm"
          class="h-8 gap-1.5 px-2.5 text-[13px]"
          :disabled="entry.rows === 0 || busy"
          @click="handleRun(entry.action)"
        >
          {{ t(`bookRequests.bulkBar.action.${entry.action}`) }}
          <span
            class="min-w-4 rounded-xs px-1 text-center text-xs tabular-nums"
            :class="entry.action === 'approve' ? 'bg-primary-foreground/20' : 'bg-foreground/8'"
          >
            {{ formatNumber(entry.rows) }}
          </span>
          <span v-if="entry.rows === 0" class="sr-only">{{ t(`bookRequests.bulkBar.why.${entry.action}`) }}</span>
        </Button>
      </span>
    </div>

    <Button v-if="hasSelection" variant="ghost" size="icon-sm" class="shrink-0" :aria-label="t('bookRequests.bulkBar.clear')" @click="handleClear">
      <X :size="16" aria-hidden="true" />
    </Button>
  </div>
</template>
