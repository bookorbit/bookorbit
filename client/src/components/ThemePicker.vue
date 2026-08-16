<script setup lang="ts">
import { Monitor, Moon, Sun } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'

const { t } = useI18n()
const themeStore = useThemeStore()
const props = withDefaults(defineProps<{ touch?: boolean }>(), {
  touch: false,
})

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
  <div class="flex items-center rounded-md border border-border bg-muted/50 p-1" :class="props.touch ? 'w-full gap-0.5' : 'w-fit gap-1'">
    <button
      type="button"
      class="flex items-center gap-1.5 rounded font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :class="[
        props.touch ? 'h-9 min-w-0 flex-1 justify-center px-1.5 text-xs' : 'px-2.5 py-1 text-[10px]',
        themeStore.theme === 'light' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
      ]"
      @click="handleLightTheme"
    >
      <Sun :size="12" /> {{ t('components.themePicker.light') }}
    </button>
    <button
      type="button"
      class="flex items-center gap-1.5 rounded font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :class="[
        props.touch ? 'h-9 min-w-0 flex-1 justify-center px-1.5 text-xs' : 'px-2.5 py-1 text-[10px]',
        themeStore.theme === 'dark' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
      ]"
      @click="handleDarkTheme"
    >
      <Moon :size="12" /> {{ t('components.themePicker.dark') }}
    </button>
    <button
      type="button"
      class="flex items-center gap-1.5 rounded font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :class="[
        props.touch ? 'h-9 min-w-0 flex-1 justify-center px-1.5 text-xs' : 'px-2.5 py-1 text-[10px]',
        themeStore.theme === 'system' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
      ]"
      @click="handleSystemTheme"
    >
      <Monitor :size="12" /> {{ t('components.themePicker.system') }}
    </button>
  </div>
</template>
