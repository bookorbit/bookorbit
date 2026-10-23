<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Check } from '@lucide/vue'
import { ACCENT_ROWS, useThemeStore } from '@/stores/theme'
import type { AccentOption } from '@/lib/theme-accent-meta'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const themeStore = useThemeStore()
const { t } = useI18n()
const props = withDefaults(defineProps<{ touch?: boolean }>(), {
  touch: false,
})
const accentOptions = ACCENT_ROWS.flat()

const TOUCH_COLUMNS = 8

/** ACCENT_ROWS alternates a vivid row with its pastel row; split each pair of rows into
 *  eight-wide blocks so every pastel still sits directly under its vivid. */
const touchBlocks = (() => {
  const blocks: AccentOption[][] = []
  for (let row = 0; row + 1 < ACCENT_ROWS.length; row += 2) {
    const vivid = ACCENT_ROWS[row] ?? []
    const pastel = ACCENT_ROWS[row + 1] ?? []
    for (let start = 0; start < vivid.length; start += TOUCH_COLUMNS) {
      blocks.push([...vivid.slice(start, start + TOUCH_COLUMNS), ...pastel.slice(start, start + TOUCH_COLUMNS)])
    }
  }
  return blocks
})()
</script>

<template>
  <!-- Phones get eight columns, so each block is eight vivid accents with their pastels right below. -->
  <div v-if="props.touch" class="space-y-2">
    <div v-for="(block, blockIndex) in touchBlocks" :key="blockIndex" class="grid grid-cols-8 gap-0.5">
      <Tooltip v-for="opt in block" :key="opt.id">
        <TooltipTrigger as-child>
          <button
            type="button"
            class="flex h-8 w-full items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :class="themeStore.accent === opt.id ? 'bg-muted ring-2 ring-primary' : 'hover:bg-muted/60'"
            :aria-label="t(opt.labelKey)"
            :aria-pressed="themeStore.accent === opt.id"
            @click="themeStore.setAccent(opt.id)"
          >
            <span class="block size-5 rounded-full" :class="opt.swatchClass" :style="{ backgroundColor: opt.color }" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ t(opt.labelKey) }}</TooltipContent>
      </Tooltip>
    </div>
  </div>
  <!-- Fixed 16px cells keep the grid the same width wherever it sits; the pick shows a check, not a
       growing ring, so it never covers its neighbours. -->
  <div v-else class="grid grid-cols-[repeat(16,1rem)] justify-between gap-x-0.5 gap-y-1.5">
    <Tooltip v-for="opt in accentOptions" :key="opt.id">
      <TooltipTrigger as-child>
        <button
          type="button"
          class="flex size-4 items-center justify-center rounded-full transition-transform hover:scale-115 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          :class="opt.swatchClass"
          :aria-label="t(opt.labelKey)"
          :aria-pressed="themeStore.accent === opt.id"
          :style="{ backgroundColor: opt.color }"
          @click="themeStore.setAccent(opt.id)"
        >
          <Check v-if="themeStore.accent === opt.id" :size="11" :stroke-width="3.5" class="text-primary-foreground" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{{ t(opt.labelKey) }}</TooltipContent>
    </Tooltip>
  </div>
</template>
