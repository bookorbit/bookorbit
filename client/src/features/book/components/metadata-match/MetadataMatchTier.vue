<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MatchTier } from '../../lib/metadata-match'

const props = defineProps<{ tier: MatchTier }>()

const { t } = useI18n()

const label = computed(() => t(`book.detail.editMetadata.match.tier.${props.tier}`))
const FILLED: Record<MatchTier, number> = { strong: 3, possible: 2, weak: 1 }
const FILL_CLASS: Record<MatchTier, string> = { strong: 'bg-success', possible: 'bg-warning', weak: 'bg-muted-foreground' }
const HEIGHTS = ['h-[5px]', 'h-[8.5px]', 'h-3']

function barClass(index: number): string {
  return `${HEIGHTS[index]} ${index < FILLED[props.tier] ? FILL_CLASS[props.tier] : 'bg-border'}`
}
</script>

<template>
  <span class="inline-flex h-3 shrink-0 items-end gap-0.5" role="img" :aria-label="label" :title="label">
    <span v-for="(_, index) in HEIGHTS" :key="index" class="w-[3px] rounded-[1px]" :class="barClass(index)" />
  </span>
</template>
