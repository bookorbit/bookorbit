<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { UserFont } from '@bookorbit/types'
import { fontVariantLabel } from '@/features/reader/shared/lib/font-variants'
import { styleGrid, type StyleGridCell } from '../lib/font-style-grid'

/**
 * Which styles a family really has: nine weight columns, upright over italic. A square is a static
 * file, a bar is a variable axis with a dot for each style it offers, and an empty slot is a style
 * the browser would have to fake.
 */
const props = defineProps<{
  fonts: readonly UserFont[]
  /** What the grid says, for assistive technology, which cannot read the shape. */
  label: string
}>()

const { t } = useI18n()

const CELL = 10
const GAP = 3

const rows = computed(() => styleGrid(props.fonts))

function barStyle(from: number, to: number) {
  const step = CELL + GAP
  return { insetInlineStart: `${from * step}px`, width: `${(to - from) * step + CELL}px` }
}

function cellTitle(entry: StyleGridCell): string {
  return entry.variant ? `${fontVariantLabel(entry.variant, t)} · ${entry.weight}` : String(entry.weight)
}
</script>

<template>
  <div role="img" :aria-label="label" class="inline-grid grid-cols-[auto_auto] items-center gap-x-1.5 gap-y-1">
    <template v-for="row in rows" :key="row.style">
      <span
        aria-hidden="true"
        class="w-4 text-center font-serif text-[11px] leading-none font-semibold text-muted-foreground"
        :class="row.style === 'italic' ? 'italic' : ''"
        >a</span
      >
      <span class="relative grid h-2.5 grid-cols-[repeat(9,10px)] gap-[3px]">
        <span
          v-for="range in row.ranges"
          :key="`${range.from}-${range.to}`"
          class="absolute top-0 h-full rounded-full bg-primary/20 ring-1 ring-primary/45 ring-inset"
          :style="barStyle(range.from, range.to)"
        />
        <span v-for="entry in row.cells" :key="entry.weight" class="relative grid place-items-center" :title="cellTitle(entry)">
          <span v-if="entry.state === 'static'" class="size-full rounded-[2.5px] bg-primary" />
          <span v-else-if="entry.state === 'range'" class="size-1 rounded-full bg-primary" />
          <span v-else class="size-0.5 rounded-full bg-foreground/25" />
        </span>
      </span>
    </template>
  </div>
</template>
