<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDate as formatLocaleDate } from '@/i18n/formatters'
import { colorLabel } from '@/features/annotations/lib/filter-options'
import { HIGHLIGHT_GROUP_MODES, type HighlightGroup, type HighlightGroupMode } from '@/features/book/lib/highlight-groups'

const props = defineProps<{ groups: HighlightGroup[]; activeKey: string | null }>()
const mode = defineModel<HighlightGroupMode>('mode', { required: true })
const emit = defineEmits<{ select: [HighlightGroup] }>()

const { t } = useI18n()

const MODE_LABELS = computed<Record<HighlightGroupMode, string>>(() => ({
  chapter: t('book.detail.highlights.index.byChapter'),
  colour: t('book.detail.highlights.index.byColour'),
  day: t('book.detail.highlights.index.byDay'),
}))

const rows = computed(() =>
  props.groups.map((group) => ({
    group,
    label: label(group),
    swatches: swatches(group),
  })),
)

function label(group: HighlightGroup): string {
  if (group.label == null) return t('book.detail.highlights.uncategorized')
  if (group.mode === 'colour') return colorLabel(group.label)
  if (group.mode === 'day') {
    const date = new Date(`${group.label}T00:00:00`)
    return Number.isNaN(date.getTime()) ? group.label : formatLocaleDate(date, { month: 'short', day: 'numeric' })
  }
  return group.label
}

/** Up to seven ticks showing what the group is made of, biggest share first. */
function swatches(group: HighlightGroup): string[] {
  const out: string[] = []
  for (const entry of group.colours) {
    const share = Math.max(1, Math.round((entry.count / Math.max(1, group.total)) * 7))
    for (let i = 0; i < share && out.length < 7; i += 1) out.push(entry.color)
  }
  return out
}

function handleSelect(group: HighlightGroup) {
  emit('select', group)
}
</script>

<template>
  <section
    class="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
    :aria-label="t('book.detail.highlights.index.title')"
  >
    <header class="flex h-[34px] flex-none items-center gap-2 border-b border-border px-3">
      <h2 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{{ t('book.detail.highlights.index.title') }}</h2>
      <div class="ml-auto flex items-center gap-2">
        <label class="sr-only" for="highlights-group">{{ t('book.detail.highlights.index.groupBy') }}</label>
        <select
          id="highlights-group"
          v-model="mode"
          class="h-6 rounded-md border border-border bg-muted/50 px-1.5 text-[11px] font-medium text-muted-foreground transition-colors pointer-coarse:h-9 focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option v-for="option in HIGHLIGHT_GROUP_MODES" :key="option" :value="option">{{ MODE_LABELS[option] }}</option>
        </select>
        <span class="text-[11px] tabular-nums text-muted-foreground">{{ groups.length }}</span>
      </div>
    </header>

    <div
      class="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1.5 [mask-image:linear-gradient(to_bottom,#000_calc(100%-13px),transparent)] [scrollbar-gutter:stable]"
    >
      <button
        v-for="row in rows"
        :key="row.group.key"
        type="button"
        class="grid h-[26px] w-full grid-cols-[minmax(0,min-content)_minmax(0,1fr)_auto_20px] items-center gap-1.5 rounded-md px-1.5 text-left transition-colors pointer-coarse:h-9 hover:bg-muted"
        :class="activeKey === row.group.key ? 'bg-primary/12' : ''"
        :aria-pressed="activeKey === row.group.key"
        @click="() => handleSelect(row.group)"
      >
        <span class="text-right text-[10px] tabular-nums text-muted-foreground">{{ row.group.index ?? '' }}</span>
        <span class="flex min-w-0 items-center gap-1.5">
          <span v-if="row.group.colour" class="size-2.5 shrink-0 rounded-[3px]" :style="{ background: row.group.colour }" aria-hidden="true" />
          <span class="truncate text-[11px] leading-4 text-foreground">{{ row.label }}</span>
        </span>
        <span class="flex h-[5px] items-center gap-px" aria-hidden="true">
          <i v-for="(hex, i) in row.swatches" :key="`${hex}-${i}`" class="block h-[5px] w-1 rounded-[1px]" :style="{ background: hex }" />
        </span>
        <span class="text-right text-[10.5px] font-bold tabular-nums text-muted-foreground">{{ row.group.total }}</span>
      </button>
    </div>
  </section>
</template>
