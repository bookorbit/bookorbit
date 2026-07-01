<script setup lang="ts">
import { Moon, Sun } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'

const { t } = useI18n()
const themeStore = useThemeStore()
</script>

<template>
  <div class="flex items-center gap-1 p-1 rounded-md border border-border bg-muted/50 w-fit">
    <button
      class="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-medium transition-colors focus:outline-none"
      :class="themeStore.theme === 'light' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
      @click="themeStore.theme = 'light'"
    >
      <Sun :size="12" /> {{ t('components.themePicker.light') }}
    </button>
    <button
      class="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-medium transition-colors focus:outline-none"
      :class="themeStore.theme === 'dark' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
      @click="themeStore.theme = 'dark'"
    >
      <Moon :size="12" /> {{ t('components.themePicker.dark') }}
    </button>
  </div>
</template>
