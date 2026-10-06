<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MetadataCandidate } from '@bookorbit/types'
import { useMangabakaDrillDown } from '../../../composables/useMangabakaDrillDown'
import MangabakaSeriesDrillDown from './MangabakaSeriesDrillDown.vue'

const props = defineProps<{
  candidates: MetadataCandidate[]
  queryTitle?: string
}>()

const emit = defineEmits<{ select: [MetadataCandidate] }>()

const { t } = useI18n()
const drillDown = useMangabakaDrillDown()

const mangabakaResults = computed(() => props.candidates.filter((candidate) => candidate.provider === 'mangabaka'))
const topMangabakaSeries = computed(() => mangabakaResults.value.slice(0, 3))

watch(
  () => props.queryTitle,
  (title) => {
    drillDown.highlightedVolume.value = parseVolumeNumber(title)
  },
  { immediate: true },
)

watch(
  () => props.candidates,
  () => {
    // When a new search replaces the candidate list, drop stale expansion state so
    // series/collection panels from a previous query do not linger.
    drillDown.reset()
  },
)

function parseVolumeNumber(title: string | undefined): number | null {
  const match = (title ?? '').match(/(?:vol\.?|volume|t)\s*(\d{1,3})/i)
  if (match && match[1]) return parseInt(match[1], 10)
  return null
}

function handleSelectVolume(candidate: MetadataCandidate) {
  emit('select', candidate)
}
</script>

<template>
  <div v-if="topMangabakaSeries.length" class="border-t border-border mt-4 pt-4">
    <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
      {{ t('book.detail.editMetadata.mangabakaDrillDown.sectionTitle') }}
    </p>
    <div class="space-y-2">
      <MangabakaSeriesDrillDown
        v-for="candidate in topMangabakaSeries"
        :key="candidate.providerId"
        :series-candidate="candidate"
        :drill-down="drillDown"
        @select="handleSelectVolume"
      />
    </div>
  </div>
</template>
