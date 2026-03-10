<script setup lang="ts">
import { useThemeStore } from '@/stores/theme'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const themeStore = useThemeStore()

const shapes = [
  { id: 'sharp' as const, rx: '0' },
  { id: 'default' as const, rx: '3' },
  { id: 'rounded' as const, rx: '8' },
  { id: 'pill' as const, rx: '99' },
]
</script>

<template>
  <div class="flex items-center gap-1.5">
    <Tooltip v-for="s in shapes" :key="s.id">
      <TooltipTrigger as-child>
        <button
          class="w-8 h-5 border-2 transition-colors focus:outline-none"
          :style="{
            borderRadius: `${s.rx}px`,
            borderColor: themeStore.radius === s.id ? 'var(--primary)' : 'var(--muted-foreground)',
            opacity: themeStore.radius === s.id ? '1' : '0.5',
          }"
          @click="themeStore.setRadius(s.id)"
        />
      </TooltipTrigger>
      <TooltipContent>{{ s.id }}</TooltipContent>
    </Tooltip>
  </div>
</template>
