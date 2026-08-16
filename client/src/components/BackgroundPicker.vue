<script setup lang="ts">
import { BACKGROUND_OPTIONS, useThemeStore } from '@/stores/theme'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const themeStore = useThemeStore()
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
          :aria-label="opt.label"
          @click="themeStore.setBackground(opt.id)"
        >
          <div
            class="w-full overflow-hidden ring-2 transition-all"
            :class="[
              props.touch ? 'h-10 rounded-md' : 'h-8 rounded',
              themeStore.background === opt.id ? 'ring-primary' : 'ring-border hover:ring-muted-foreground/40',
            ]"
          >
            <div class="w-full h-full bg-background pattern-preview" :class="opt.cssClass" />
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent>{{ opt.label }}</TooltipContent>
    </Tooltip>
  </div>
</template>
