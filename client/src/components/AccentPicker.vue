<script setup lang="ts">
import { ACCENT_OPTIONS, useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()
</script>

<template>
  <div class="flex items-center gap-1">
    <button
      v-for="opt in ACCENT_OPTIONS"
      :key="opt.id"
      @click="themeStore.setAccent(opt.id)"
      :title="opt.label"
      class="w-4 h-4 rounded-full transition-transform hover:scale-110 focus:outline-none"
      :style="{
        backgroundColor: opt.color,
        outline: themeStore.accent === opt.id ? `2px solid ${opt.color}` : 'none',
        outlineOffset: '2px',
        transform: themeStore.accent === opt.id ? 'scale(1.2)' : '',
      }"
    />
  </div>
</template>
