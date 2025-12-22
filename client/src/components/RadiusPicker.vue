<script setup lang="ts">
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()

const shapes = [
  { id: 'sharp' as const,   rx: '1' },
  { id: 'default' as const, rx: '4' },
  { id: 'rounded' as const, rx: '9' },
]
</script>

<template>
  <div class="flex items-center gap-1">
    <button
      v-for="s in shapes"
      :key="s.id"
      @click="themeStore.setRadius(s.id)"
      :title="s.id"
      class="w-4 h-4 border-2 transition-colors focus:outline-none"
      :style="{
        borderRadius: `${s.rx}px`,
        borderColor: themeStore.radius === s.id ? 'var(--primary)' : 'var(--muted-foreground)',
        opacity: themeStore.radius === s.id ? '1' : '0.5',
      }"
    />
  </div>
</template>
