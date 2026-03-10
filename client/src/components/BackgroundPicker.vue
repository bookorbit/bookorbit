<script setup lang="ts">
import { BACKGROUND_OPTIONS, useThemeStore } from '@/stores/theme'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const themeStore = useThemeStore()
</script>

<template>
  <div class="grid grid-cols-5 gap-2">
    <Tooltip v-for="opt in BACKGROUND_OPTIONS" :key="opt.id">
      <TooltipTrigger as-child>
        <button type="button" class="flex flex-col items-center cursor-pointer focus:outline-none" @click="themeStore.setBackground(opt.id)">
          <div
            class="w-full h-8 rounded overflow-hidden ring-2 transition-all"
            :class="themeStore.background === opt.id ? 'ring-primary' : 'ring-border hover:ring-muted-foreground/40'"
          >
            <div class="w-full h-full bg-background pattern-preview" :class="opt.cssClass" />
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent>{{ opt.label }}</TooltipContent>
    </Tooltip>
  </div>
</template>
