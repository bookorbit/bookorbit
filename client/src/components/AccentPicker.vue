<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ACCENT_ROWS, useThemeStore } from '@/stores/theme'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const themeStore = useThemeStore()
const { t } = useI18n()
</script>

<template>
  <div class="space-y-1.5">
    <div v-for="(row, rowIndex) in ACCENT_ROWS" :key="rowIndex" class="flex items-center gap-0.5">
      <Tooltip v-for="opt in row" :key="opt.id">
        <TooltipTrigger as-child>
          <button
            class="w-3.5 h-3.5 rounded-full transition-transform hover:scale-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card shrink-0"
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
