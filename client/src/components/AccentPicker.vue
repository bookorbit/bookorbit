<script setup lang="ts">
import { ACCENT_VIVID, ACCENT_PASTEL, useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()
</script>

<template>
  <div class="space-y-1.5">
    <div class="flex items-center gap-0.5">
      <button
        v-for="opt in ACCENT_VIVID"
        :key="opt.id"
        @click="themeStore.setAccent(opt.id)"
        :title="opt.label"
        class="w-3.5 h-3.5 rounded-full transition-transform hover:scale-125 focus:outline-none shrink-0"
        :style="{
          backgroundColor: opt.color,
          outline: themeStore.accent === opt.id ? `2px solid ${opt.color}` : 'none',
          outlineOffset: '2px',
          transform: themeStore.accent === opt.id ? 'scale(1.25)' : '',
        }"
      />
    </div>
    <div class="flex items-center gap-0.5">
      <button
        v-for="opt in ACCENT_PASTEL"
        :key="opt.id"
        @click="themeStore.setAccent(opt.id)"
        :title="opt.label"
        class="w-3.5 h-3.5 rounded-full transition-transform hover:scale-125 focus:outline-none shrink-0"
        :style="{
          backgroundColor: opt.color,
          outline: themeStore.accent === opt.id ? `2px solid ${opt.color}` : 'none',
          outlineOffset: '2px',
          transform: themeStore.accent === opt.id ? 'scale(1.25)' : '',
        }"
      />
    </div>
  </div>
</template>
