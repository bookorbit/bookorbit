<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { History, TriangleAlert } from '@lucide/vue'
import type { MetadataCandidateCacheInfo } from '@bookorbit/types'
import { formatRelativeTimeFromNow } from '@/i18n/formatters'

const props = defineProps<{ info: MetadataCandidateCacheInfo }>()

const { t } = useI18n()

const when = computed(() => {
  const time = Date.parse(props.info.fetchedAt)
  return Number.isFinite(time) ? formatRelativeTimeFromNow(time, { smallestUnit: 'minute' }) : null
})
const label = computed(() => (props.info.stale ? t('metadataCache.badge.stale') : t('metadataCache.badge.cached')))
const description = computed(() => {
  if (props.info.stale) return when.value ? t('metadataCache.badge.staleHint', { when: when.value }) : t('metadataCache.badge.staleHintUndated')
  return when.value ? t('metadataCache.badge.cachedHint', { when: when.value }) : t('metadataCache.badge.cachedHintUndated')
})
</script>

<template>
  <span
    class="inline-flex h-[18px] items-center gap-1 rounded-md px-1.5 text-[10.5px] font-semibold"
    :class="info.stale ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground'"
    :title="description"
    data-testid="metadata-cache-badge"
    :data-stale="info.stale ? 'true' : 'false'"
  >
    <TriangleAlert v-if="info.stale" class="size-2.5" aria-hidden="true" />
    <History v-else class="size-2.5" aria-hidden="true" />
    <span aria-hidden="true">{{ label }}</span>
    <span class="sr-only">{{ description }}</span>
  </span>
</template>
