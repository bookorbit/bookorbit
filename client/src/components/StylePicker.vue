<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { THEME_STYLES, type ThemeStyleDefinition } from '@/lib/theme-styles'
import { useThemeStore } from '@/stores/theme'

const { t } = useI18n()
const themeStore = useThemeStore()
const props = withDefaults(defineProps<{ touch?: boolean }>(), {
  touch: false,
})

function selectStyle(style: ThemeStyleDefinition) {
  themeStore.setStyle(style.id)
}
</script>

<template>
  <div class="flex items-center rounded-md border border-border bg-muted/50 p-1" :class="props.touch ? 'w-full gap-0.5' : 'w-fit gap-1'">
    <button
      v-for="style in THEME_STYLES"
      :key="style.id"
      type="button"
      class="rounded font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :class="[
        props.touch ? 'h-9 min-w-0 flex-1 px-1.5 text-xs' : 'px-2.5 py-1 text-[10px]',
        themeStore.style === style.id ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
      ]"
      :aria-pressed="themeStore.style === style.id"
      :title="t(style.descriptionKey)"
      @click="selectStyle(style)"
    >
      {{ t(style.labelKey) }}
    </button>
  </div>
</template>
