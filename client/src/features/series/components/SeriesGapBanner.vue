<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertCircle } from '@lucide/vue'
import type { SeriesUnitCounts } from '@bookorbit/types'
import { seriesGapTokens } from '../lib/series-unit-label'

const { t } = useI18n()

const props = defineProps<{
  gaps: number[]
  /** Missing chapter or issue numbers, which run on their own number line. */
  chapterGaps?: number[]
  unitCounts?: SeriesUnitCounts | null
}>()

const tokens = computed(() => seriesGapTokens(t, props.gaps, props.chapterGaps ?? [], props.unitCounts))
const gapsLabel = computed(() => tokens.value.join(', '))
</script>

<template>
  <div v-if="tokens.length > 0" class="flex items-start gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
    <AlertCircle :size="16" class="mt-0.5 shrink-0 text-muted-foreground" />
    <p class="text-xs text-muted-foreground">
      <span class="font-medium">{{ t('series.gaps.label') }}</span> {{ gapsLabel }}
    </p>
  </div>
</template>
