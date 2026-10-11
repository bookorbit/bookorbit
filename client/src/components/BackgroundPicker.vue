<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { BACKGROUND_OPTIONS, useThemeStore } from '@/stores/theme'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const themeStore = useThemeStore()
const { t } = useI18n()
const props = withDefaults(defineProps<{ touch?: boolean }>(), {
  touch: false,
})
</script>

<template>
  <div class="grid" :class="props.touch ? 'grid-cols-4 gap-2' : 'grid-cols-5 gap-2'">
    <Tooltip v-for="opt in BACKGROUND_OPTIONS" :key="opt.id">
      <TooltipTrigger as-child>
        <button
          type="button"
          class="flex flex-col items-center cursor-pointer rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="t(opt.labelKey)"
          :aria-pressed="themeStore.background === opt.id"
          @click="themeStore.setBackground(opt.id)"
        >
          <div
            class="w-full overflow-hidden ring-2 transition-all"
            :class="[
              props.touch ? 'h-10 rounded-md' : 'h-8 rounded-xs',
              themeStore.background === opt.id ? 'ring-primary' : 'ring-border hover:ring-muted-foreground/40',
            ]"
          >
            <div class="w-full h-full bg-background pattern-preview" :class="opt.cssClass" />
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent>{{ t(opt.labelKey) }}</TooltipContent>
    </Tooltip>
  </div>
</template>
