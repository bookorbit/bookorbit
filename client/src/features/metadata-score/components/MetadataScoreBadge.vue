<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatNumber } from '@/i18n/formatters'
import { metadataScoreColor } from '@/lib/metadata-score-color'

const props = defineProps<{
  score: number | null
}>()

const { t } = useI18n()

const display = computed(() => (props.score === null ? null : Math.round(Math.min(100, Math.max(0, props.score)))))
const scoreColor = computed(() => (display.value === null ? undefined : metadataScoreColor(display.value)))
</script>

<template>
  <!-- Labelled and without a percent sign, so the score never reads as reading progress. -->
  <button
    v-if="display !== null"
    type="button"
    class="group -my-1 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    :aria-label="t('metadataScore.chipAria', { score: formatNumber(display) })"
  >
    <span
      class="text-[10px] leading-none font-semibold uppercase tracking-wider text-muted-foreground transition-colors group-hover:text-foreground group-focus-visible:text-foreground"
      >{{ t('metadataScore.chipLabel') }}</span
    >
    <span class="text-xs leading-none font-bold tabular-nums" :style="{ color: scoreColor }">{{ formatNumber(display) }}</span>
  </button>
</template>
