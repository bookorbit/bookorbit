<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ExternalLink, Loader2, MoreHorizontal, RefreshCw, Trash2 } from '@lucide/vue'
import type { AuthorSummary, TableDensity } from '@bookorbit/types'
import { formatNumber, formatRelativeFromNow } from '@/i18n/formatters'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import AuthorPortrait from './AuthorPortrait.vue'
import { hasInformativeSortName } from '../lib/author-identity'

const props = withDefaults(
  defineProps<{
    author: AuthorSummary
    density?: TableDensity
    maxBookCount?: number
    selectionMode?: boolean
    selected?: boolean
    canRefresh?: boolean
    canDelete?: boolean
    refreshing?: boolean
    deleting?: boolean
    coverFallback?: boolean
  }>(),
  { density: 'comfortable', maxBookCount: 1, coverFallback: true },
)

const emit = defineEmits<{
  open: [authorId: number]
  select: [event: MouseEvent]
  refresh: [authorId: number]
  delete: [authorId: number]
}>()

const { t } = useI18n()

/** Row height and portrait scale move together, so the portrait never crowds the row. */
const METRICS: Record<TableDensity, { row: number; portrait: number }> = {
  compact: { row: 32, portrait: 24 },
  comfortable: { row: 38, portrait: 30 },
  roomy: { row: 46, portrait: 34 },
}
const metrics = computed(() => METRICS[props.density] ?? METRICS.comfortable)
const busySpinnerSize = computed(() => Math.round(metrics.value.portrait * 0.5))

const showSortName = computed(() => hasInformativeSortName(props.author))

const lastAdded = computed(() => (props.author.lastAddedAt ? formatRelativeFromNow(new Date(props.author.lastAddedAt)) : ''))

const bookCountLabel = computed(() => formatNumber(props.author.bookCount))

/**
 * The bar only appears above one book. In a real library the overwhelming majority of
 * authors have exactly one, and a stub bar on every one of those rows reads as a
 * rendering fault rather than as data. Square-rooted so the long tail stays visible
 * next to an outlier with a hundred titles.
 */
const barWidth = computed(() => {
  if (props.author.bookCount <= 1) return 0
  const max = Math.max(props.maxBookCount, props.author.bookCount, 2)
  return Math.max(12, Math.round(Math.sqrt(props.author.bookCount / max) * 100))
})

const secondaryLine = computed(() => {
  const parts: string[] = []
  if (showSortName.value && props.author.sortName) parts.push(props.author.sortName)
  parts.push(t('author.index.bookCount', { count: props.author.bookCount }))
  if (lastAdded.value) parts.push(lastAdded.value)
  return parts.join(' · ')
})

const accessibleLabel = computed(() => t('author.index.rowLabel', { name: props.author.name, count: props.author.bookCount }))

const menuOpen = ref(false)
const busy = computed(() => Boolean(props.refreshing || props.deleting))
const busyLabel = computed(() =>
  props.deleting ? t('author.index.deleting', { name: props.author.name }) : t('author.index.refreshing', { name: props.author.name }),
)

function handleActivate(event: MouseEvent) {
  if (props.selectionMode || event.metaKey || event.ctrlKey || event.shiftKey) {
    emit('select', event)
    return
  }
  emit('open', props.author.id)
}

function handleRefresh() {
  if (!props.canRefresh || props.refreshing) return
  emit('refresh', props.author.id)
}

function handleDelete() {
  if (!props.canDelete || props.deleting) return
  emit('delete', props.author.id)
}
</script>

<template>
  <div
    class="group/row relative isolate flex items-center rounded-lg transition-colors"
    :class="[selected ? 'bg-primary/10' : 'hover:bg-muted/60', busy ? 'opacity-70' : '']"
    :aria-busy="busy ? 'true' : undefined"
    :style="{ minHeight: `${metrics.row}px` }"
  >
    <!-- Stretched primary action: keeps the whole row clickable without nesting the
         menu button inside another button, which is invalid and breaks keyboard order. -->
    <button
      type="button"
      class="absolute inset-0 z-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
      :aria-label="accessibleLabel"
      :aria-pressed="selectionMode ? selected : undefined"
      @click="handleActivate"
    />

    <div
      class="pointer-events-none relative z-10 flex w-full min-w-0 items-center gap-2.5 px-2 py-1 @container/row sm:gap-3"
      :style="{ minHeight: `${metrics.row}px` }"
    >
      <span
        v-if="selectionMode"
        class="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors"
        :class="selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-transparent'"
      >
        <Check :size="11" />
      </span>

      <span class="relative shrink-0 overflow-hidden rounded-lg" :style="{ width: `${metrics.portrait}px`, height: `${metrics.portrait}px` }">
        <AuthorPortrait :author="author" :show-source-badge="false" :cover-fallback="coverFallback" />
        <span v-if="busy" class="absolute inset-0 grid place-items-center bg-black/55" role="status" :aria-label="busyLabel">
          <Loader2 :size="busySpinnerSize" class="animate-spin text-white" />
        </span>
      </span>

      <span class="flex min-w-0 flex-1 flex-col gap-px @[34rem]/page:flex-row @[34rem]/page:items-baseline @[34rem]/page:gap-2">
        <span class="truncate text-sm font-semibold text-foreground @[34rem]/page:shrink @[34rem]/page:text-[13.5px]">
          {{ author.name }}
        </span>
        <span v-if="showSortName && author.sortName" class="hidden min-w-0 shrink-[60] truncate text-xs text-muted-foreground @[34rem]/page:inline">
          {{ author.sortName }}
        </span>
        <span class="truncate text-xs text-muted-foreground @[34rem]/page:hidden">{{ secondaryLine }}</span>
      </span>

      <span class="hidden shrink-0 items-center gap-3 @[34rem]/page:flex">
        <!-- nowrap and wide enough for the longest relative form: "19 hours ago"
             wrapping to a second line silently grows the row and breaks the
             baseline every other row in the column is aligned to. -->
        <span
          v-if="lastAdded"
          class="hidden w-[5.5rem] shrink-0 truncate whitespace-nowrap text-right text-xs text-muted-foreground @[24rem]/row:inline"
        >
          {{ lastAdded }}
        </span>
        <span class="flex shrink-0 items-center gap-2">
          <span class="hidden h-[3px] w-[26px] overflow-hidden rounded-full @[17rem]/row:block" :class="barWidth ? 'bg-border' : 'bg-transparent'">
            <span v-if="barWidth" class="block h-full rounded-full bg-primary" :style="{ width: `${barWidth}%` }" />
          </span>
          <span
            class="min-w-[1.1rem] text-right text-xs font-semibold tabular-nums"
            :class="author.bookCount > 1 ? 'text-foreground' : 'text-muted-foreground'"
          >
            {{ bookCountLabel }}
          </span>
        </span>
      </span>
    </div>

    <!-- Overlaid rather than given a column of its own: the menu costs the name no
         width, and it never appears in selection mode where the row click owns the tap. -->
    <DropdownMenu v-if="!selectionMode" v-model:open="menuOpen">
      <DropdownMenuTrigger as-child>
        <button
          type="button"
          class="absolute right-1.5 top-1/2 z-20 size-6 -translate-y-1/2 place-items-center rounded-md border border-border bg-card text-muted-foreground shadow-xs transition-colors hover:text-foreground focus-visible:grid group-focus-within/row:grid group-hover/row:grid"
          :class="busy || menuOpen ? 'grid' : 'hidden'"
          :aria-label="t('author.index.actionsFor', { name: author.name })"
          @click.stop
        >
          <MoreHorizontal :size="13" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem @click="emit('open', author.id)">
          <ExternalLink class="mr-2 h-4 w-4" />
          {{ t('author.card.viewDetails') }}
        </DropdownMenuItem>
        <DropdownMenuItem :disabled="!canRefresh || refreshing" @click="handleRefresh">
          <Loader2 v-if="refreshing" class="mr-2 h-4 w-4 animate-spin" />
          <RefreshCw v-else class="mr-2 h-4 w-4" />
          {{ t('author.card.refreshMetadata') }}
        </DropdownMenuItem>
        <DropdownMenuItem
          :disabled="!canDelete || deleting"
          :class="canDelete ? 'text-destructive focus:text-destructive' : ''"
          @click="handleDelete"
        >
          <Loader2 v-if="deleting" class="mr-2 h-4 w-4 animate-spin" />
          <Trash2 v-else class="mr-2 h-4 w-4" />
          {{ t('author.card.deleteAuthor') }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
