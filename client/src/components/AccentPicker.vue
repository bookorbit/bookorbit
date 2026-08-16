<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ACCENT_ROWS, useThemeStore } from '@/stores/theme'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const themeStore = useThemeStore()
const { t } = useI18n()
const props = withDefaults(defineProps<{ touch?: boolean }>(), {
  touch: false,
})
const accentOptions = ACCENT_ROWS.flat()
</script>

<template>
  <div v-if="props.touch" class="grid grid-cols-10 gap-0.5">
    <Tooltip v-for="opt in accentOptions" :key="opt.id">
      <TooltipTrigger as-child>
        <button
          type="button"
          class="flex aspect-square w-full items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="themeStore.accent === opt.id ? 'bg-muted ring-2 ring-primary' : 'hover:bg-muted/60'"
          :aria-label="t(opt.labelKey)"
          @click="themeStore.setAccent(opt.id)"
        >
          <span class="block size-5 rounded-full" :class="opt.swatchClass" :style="{ backgroundColor: opt.color }" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{{ t(opt.labelKey) }}</TooltipContent>
    </Tooltip>
  </div>
  <div v-else class="space-y-1.5">
    <div v-for="(row, rowIndex) in ACCENT_ROWS" :key="rowIndex" class="flex items-center gap-0.5">
      <Tooltip v-for="opt in row" :key="opt.id">
        <TooltipTrigger as-child>
          <button
            type="button"
            class="w-3.5 h-3.5 rounded-full transition-transform hover:scale-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card shrink-0"
            :class="opt.swatchClass"
            :aria-label="t(opt.labelKey)"
            :style="{
              backgroundColor: opt.color,
              outline: themeStore.accent === opt.id ? `2px solid ${opt.color}` : 'none',
              outlineOffset: '2px',
              transform: themeStore.accent === opt.id ? 'scale(1.25)' : '',
            }"
            @click="themeStore.setAccent(opt.id)"
          />
        </TooltipTrigger>
        <TooltipContent>{{ t(opt.labelKey) }}</TooltipContent>
      </Tooltip>
    </div>
  </div>
</template>
