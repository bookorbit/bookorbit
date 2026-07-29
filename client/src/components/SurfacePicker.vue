<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { SURFACE_OPACITY_MAX, SURFACE_OPACITY_MIN } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { useThemeStore } from '@/stores/theme'

const { t } = useI18n()
const themeStore = useThemeStore()

function handleSurfaceOpacityInput(event: Event) {
  themeStore.setSurfaceOpacity(Number((event.target as HTMLInputElement).value))
}
</script>

<template>
  <div class="flex items-center gap-2">
    <input
      id="shell-surface-opacity"
      :value="themeStore.surfaceOpacity"
      type="range"
      :min="SURFACE_OPACITY_MIN"
      :max="SURFACE_OPACITY_MAX"
      step="1"
      class="w-full accent-primary cursor-pointer"
      :aria-label="t('components.appHeader.surfaceOpacity')"
      :aria-valuetext="t('components.appHeader.surfaceOpacityValue', { value: formatNumber(themeStore.surfaceOpacity) })"
      @input="handleSurfaceOpacityInput"
    />
    <span class="w-10 shrink-0 text-right text-[13px] tabular-nums text-muted-foreground">
      {{ t('components.appHeader.surfaceOpacityValue', { value: formatNumber(themeStore.surfaceOpacity) }) }}
    </span>
  </div>
</template>
