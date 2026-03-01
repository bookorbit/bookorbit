<script setup lang="ts">
import { BACKGROUND_OPTIONS, useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()
</script>

<template>
  <div class="grid grid-cols-4 gap-2">
    <button
      v-for="opt in BACKGROUND_OPTIONS"
      :key="opt.id"
      type="button"
      class="flex flex-col items-center gap-1 cursor-pointer focus:outline-none"
      @click="themeStore.setBackground(opt.id)"
    >
      <div
        class="w-full h-9 rounded overflow-hidden ring-2 transition-all"
        :class="themeStore.background === opt.id ? 'ring-primary' : 'ring-border hover:ring-muted-foreground/40'"
      >
        <div class="w-full h-full bg-background" :class="opt.cssClass" />
      </div>
      <span
        class="text-[10px] font-medium transition-colors leading-none"
        :class="themeStore.background === opt.id ? 'text-primary' : 'text-muted-foreground'"
        >{{ opt.label }}</span
      >
    </button>
  </div>
</template>
