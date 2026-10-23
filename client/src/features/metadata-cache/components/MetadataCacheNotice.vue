<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { History } from '@lucide/vue'
import { formatRelativeTimeFromNow } from '@/i18n/formatters'
import type { MetadataCacheSummary } from '../lib/metadata-cache'
import SearchFreshButton from './SearchFreshButton.vue'

const props = defineProps<{
  summary: MetadataCacheSummary
  busy?: boolean
}>()

const emit = defineEmits<{ searchFresh: [] }>()

const { t } = useI18n()

const when = computed(() => {
  const fetchedAt = props.summary.oldestFetchedAt
  const time = fetchedAt ? Date.parse(fetchedAt) : Number.NaN
  return Number.isFinite(time) ? formatRelativeTimeFromNow(time, { smallestUnit: 'minute' }) : null
})

const message = computed(() => {
  if (props.summary.staleCount > 0) {
    return when.value ? t('metadataCache.notice.someStale', { when: when.value }) : t('metadataCache.notice.someStaleUndated')
  }
  return when.value ? t('metadataCache.notice.someCached', { when: when.value }) : t('metadataCache.notice.someCachedUndated')
})

function handleSearchFresh() {
  emit('searchFresh')
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" data-testid="metadata-cache-notice">
    <History class="size-3.5 shrink-0" aria-hidden="true" />
    <span role="status" class="min-w-0 flex-1 [overflow-wrap:anywhere]">{{ message }}</span>
    <SearchFreshButton :busy="busy" @search-fresh="handleSearchFresh" />
  </div>
</template>
