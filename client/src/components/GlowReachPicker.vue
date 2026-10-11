<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { GLOW_REACH_MAX, GLOW_REACH_MIN } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { useThemeStore } from '@/stores/theme'

const { t } = useI18n()
const themeStore = useThemeStore()

const valueLabel = computed(() =>
  themeStore.glowReach === 0
    ? t('settings.appearance.theme.topGlow.off')
    : t('settings.appearance.theme.topGlow.value', { value: formatNumber(themeStore.glowReach) }),
)

function handleGlowReachInput(event: Event) {
  themeStore.setGlowReach(Number((event.target as HTMLInputElement).value))
}
</script>

<template>
  <div class="flex items-center gap-2">
    <input
      :value="themeStore.glowReach"
      type="range"
      :min="GLOW_REACH_MIN"
      :max="GLOW_REACH_MAX"
      step="10"
      class="w-full accent-primary cursor-pointer"
      :aria-label="t('settings.appearance.theme.topGlow.label')"
      :aria-valuetext="valueLabel"
      @input="handleGlowReachInput"
    />
    <span class="w-11 shrink-0 text-right text-[13px] tabular-nums text-muted-foreground">{{ valueLabel }}</span>
  </div>
</template>
