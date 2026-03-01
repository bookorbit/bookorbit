<script setup lang="ts">
import { useThemeStore } from '@/stores/theme'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const themeStore = useThemeStore()

const shapes = [
  { id: 'sharp' as const, rx: '1' },
  { id: 'default' as const, rx: '4' },
  { id: 'rounded' as const, rx: '9' },
  { id: 'pill' as const, rx: '999' },
]
</script>

<template>
  <div class="flex items-center gap-1">
    <Tooltip v-for="s in shapes" :key="s.id">
      <TooltipTrigger as-child>
        <button
          class="w-4 h-4 border-2 transition-colors focus:outline-none"
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
