<script setup lang="ts">
import { Monitor, Moon, Sun } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'

const { t } = useI18n()
const themeStore = useThemeStore()

function handleLightTheme() {
  themeStore.setTheme('light')
}

function handleDarkTheme() {
  themeStore.setTheme('dark')
}

function handleSystemTheme() {
  themeStore.setTheme('system')
}
</script>

<template>
  <div class="flex items-center gap-1 p-1 rounded-md border border-border bg-muted/50 w-fit">
    <button
      class="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :class="themeStore.theme === 'light' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
      @click="handleLightTheme"
    >
      <Sun :size="12" /> {{ t('components.themePicker.light') }}
    </button>
    <button
      class="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :class="themeStore.theme === 'dark' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
      @click="handleDarkTheme"
    >
      <Moon :size="12" /> {{ t('components.themePicker.dark') }}
    </button>
    <button
      class="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :class="themeStore.theme === 'system' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
      @click="handleSystemTheme"
    >
      <Monitor :size="12" /> {{ t('components.themePicker.system') }}
    </button>
  </div>
</template>
