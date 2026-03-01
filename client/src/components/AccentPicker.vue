<script setup lang="ts">
import { ACCENT_VIVID, ACCENT_PASTEL, useThemeStore } from '@/stores/theme'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const themeStore = useThemeStore()
</script>

<template>
  <div class="space-y-1.5">
    <div class="flex items-center gap-0.5">
      <Tooltip v-for="opt in ACCENT_VIVID" :key="opt.id">
        <TooltipTrigger as-child>
          <button
            class="w-3.5 h-3.5 rounded-full transition-transform hover:scale-125 focus:outline-none shrink-0"
            :style="{
              backgroundColor: opt.color,
              outline: themeStore.accent === opt.id ? `2px solid ${opt.color}` : 'none',
              outlineOffset: '2px',
              transform: themeStore.accent === opt.id ? 'scale(1.25)' : '',
            }"
            @click="themeStore.setAccent(opt.id)"
          />
        </TooltipTrigger>
        <TooltipContent>{{ opt.label }}</TooltipContent>
      </Tooltip>
    </div>
    <div class="flex items-center gap-0.5">
      <Tooltip v-for="opt in ACCENT_PASTEL" :key="opt.id">
        <TooltipTrigger as-child>
          <button
            class="w-3.5 h-3.5 rounded-full transition-transform hover:scale-125 focus:outline-none shrink-0"
            :style="{
              backgroundColor: opt.color,
              outline: themeStore.accent === opt.id ? `2px solid ${opt.color}` : 'none',
              outlineOffset: '2px',
              transform: themeStore.accent === opt.id ? 'scale(1.25)' : '',
            }"
            @click="themeStore.setAccent(opt.id)"
          />
        </TooltipTrigger>
        <TooltipContent>{{ opt.label }}</TooltipContent>
      </Tooltip>
    </div>
  </div>
</template>
