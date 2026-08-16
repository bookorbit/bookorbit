<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { formatNumber } from '@/i18n/formatters'
import { useThemeStore } from '@/stores/theme'

const { t } = useI18n()
const themeStore = useThemeStore()

function handleSurfaceBrightnessInput(event: Event) {
  themeStore.setBrightness(Number((event.target as HTMLInputElement).value))
}
</script>

<template>
  <div class="flex items-center gap-2">
    <input
      :value="themeStore.brightness"
      type="range"
      min="0"
      max="100"
      step="5"
      class="w-full accent-primary cursor-pointer"
      :aria-label="t('settings.appearance.theme.surfaceBrightness.label')"
      :aria-valuetext="t('components.appHeader.surfaceBrightnessValue', { value: formatNumber(themeStore.brightness) })"
      @input="handleSurfaceBrightnessInput"
    />
    <span class="w-10 shrink-0 text-right text-[13px] tabular-nums text-muted-foreground">
      {{ t('components.appHeader.surfaceBrightnessValue', { value: formatNumber(themeStore.brightness) }) }}
    </span>
  </div>
</template>
