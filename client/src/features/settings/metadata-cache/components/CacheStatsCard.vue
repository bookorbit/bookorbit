<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, RefreshCw } from '@lucide/vue'
import type { MetadataCacheNamespace, MetadataCacheProviderInfo, MetadataCacheStats } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { formatNumber, formatPercent, formatRelativeTimeFromNow } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import { cacheHitRate, cacheRequestsAvoided } from '../lib/cache-settings'

const props = defineProps<{
  stats: MetadataCacheStats | null
  providers: MetadataCacheProviderInfo[]
  loading: boolean
  failed: boolean
}>()

const emit = defineEmits<{ refresh: [] }>()

const { t } = useI18n()

const NAMESPACE_LABEL_KEYS: Record<MetadataCacheNamespace, string> = {
  book: 'settings.metadata.searchCache.providers.books',
  author: 'settings.metadata.searchCache.providers.authors',
}

const usedFraction = computed(() => {
  const stats = props.stats
  if (!stats || stats.maxStorageBytes <= 0) return 0
  return Math.min(1, stats.payloadBytes / stats.maxStorageBytes)
})

const metrics = computed(() => {
  const stats = props.stats
  if (!stats) return []
  const rate = cacheHitRate(stats.counters)
  const oldest = stats.oldestFetchedAt ? Date.parse(stats.oldestFetchedAt) : Number.NaN
  return [
    { id: 'entries', label: t('settings.metadata.searchCache.stats.entries'), value: formatNumber(stats.entries) },
    { id: 'disk', label: t('settings.metadata.searchCache.stats.diskSize'), value: formatBytes(stats.relationBytes) },
    {
      id: 'hitRate',
      label: t('settings.metadata.searchCache.stats.hitRate'),
      value: rate === null ? t('settings.metadata.searchCache.stats.none') : formatPercent(rate),
    },
    { id: 'avoided', label: t('settings.metadata.searchCache.stats.requestsAvoided'), value: formatNumber(cacheRequestsAvoided(stats.counters)) },
    { id: 'fallbacks', label: t('settings.metadata.searchCache.stats.fallbacks'), value: formatNumber(stats.counters.fallbacks) },
    { id: 'skipped', label: t('settings.metadata.searchCache.stats.skippedWrites'), value: formatNumber(stats.counters.skippedWrites) },
    {
      id: 'oldest',
      label: t('settings.metadata.searchCache.stats.oldest'),
      value: Number.isFinite(oldest) ? formatRelativeTimeFromNow(oldest, { smallestUnit: 'minute' }) : t('settings.metadata.searchCache.stats.none'),
    },
  ]
})

const providerLabels = computed(() => new Map(props.providers.map((provider) => [`${provider.namespace}:${provider.provider}`, provider.label])))

const providerRows = computed(() =>
  [...(props.stats?.providers ?? [])]
    .sort((a, b) => b.payloadBytes - a.payloadBytes || b.entries - a.entries)
    .map((row) => ({
      key: `${row.namespace}:${row.provider}`,
      label: providerLabels.value.get(`${row.namespace}:${row.provider}`) ?? row.provider,
      namespace: t(NAMESPACE_LABEL_KEYS[row.namespace]),
      entries: formatNumber(row.entries),
      emptyEntries: formatNumber(row.emptyEntries),
      size: formatBytes(row.payloadBytes),
    })),
)

function handleRefresh() {
  emit('refresh')
}
</script>

<template>
  <section class="settings-card" aria-labelledby="metadata-cache-stats-title" :aria-busy="loading ? 'true' : undefined">
    <div class="settings-card-header">
      <h3 id="metadata-cache-stats-title" class="settings-card-title">{{ t('settings.metadata.searchCache.stats.title') }}</h3>
      <Button variant="ghost" size="sm" type="button" :disabled="loading" @click="handleRefresh">
        <Loader2 v-if="loading" class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <RefreshCw v-else class="size-3.5" aria-hidden="true" />
        {{ t('settings.metadata.searchCache.stats.refresh') }}
      </Button>
    </div>

    <p v-if="failed && !stats" role="alert" class="bg-card px-4 py-4 text-sm text-destructive md:px-5">
      {{ t('settings.metadata.searchCache.stats.loadFailed') }}
    </p>
    <p v-else-if="!stats" class="bg-card px-4 py-4 text-sm text-muted-foreground md:px-5">{{ t('common.loading') }}</p>

    <template v-else>
      <div class="flex flex-col gap-2 bg-card px-4 py-3.5 md:px-5">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <span class="settings-label">{{ t('settings.metadata.searchCache.stats.storage') }}</span>
          <span class="text-sm tabular-nums text-foreground">
            {{
              t('settings.metadata.searchCache.stats.storageUsed', {
                used: formatBytes(stats.payloadBytes),
                budget: formatBytes(stats.maxStorageBytes),
              })
            }}
          </span>
        </div>
        <div class="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div class="h-full rounded-full" :class="usedFraction >= 0.9 ? 'bg-warning' : 'bg-primary'" :style="{ width: `${usedFraction * 100}%` }" />
        </div>
        <p class="settings-hint">{{ t('settings.metadata.searchCache.stats.storageHint') }}</p>
      </div>

      <dl class="grid grid-cols-2 gap-x-4 gap-y-3 bg-card px-4 py-3.5 sm:grid-cols-3 md:grid-cols-4 md:px-5">
        <div v-for="metric in metrics" :key="metric.id" class="min-w-0" :data-testid="`cache-stat-${metric.id}`">
          <dt class="text-xs text-muted-foreground">{{ metric.label }}</dt>
          <dd class="settings-value">{{ metric.value }}</dd>
        </div>
      </dl>

      <div class="bg-card px-4 py-3.5 md:px-5">
        <p class="mb-2 text-xs text-muted-foreground">{{ t('settings.metadata.searchCache.stats.countersHint') }}</p>
        <div v-if="providerRows.length" class="overflow-x-auto">
          <table class="w-full min-w-[28rem] text-sm">
            <caption class="sr-only">
              {{
                t('settings.metadata.searchCache.stats.perProvider')
              }}
            </caption>
            <thead>
              <tr class="border-b border-border text-start text-xs text-muted-foreground">
                <th scope="col" class="py-1.5 pe-3 text-start font-medium">{{ t('settings.metadata.searchCache.stats.provider') }}</th>
                <th scope="col" class="py-1.5 pe-3 text-start font-medium">{{ t('settings.metadata.searchCache.stats.kind') }}</th>
                <th scope="col" class="py-1.5 pe-3 text-end font-medium">{{ t('settings.metadata.searchCache.stats.entries') }}</th>
                <th scope="col" class="py-1.5 pe-3 text-end font-medium">{{ t('settings.metadata.searchCache.stats.emptyEntries') }}</th>
                <th scope="col" class="py-1.5 text-end font-medium">{{ t('settings.metadata.searchCache.stats.size') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in providerRows" :key="row.key" class="border-b border-border last:border-b-0">
                <th scope="row" class="py-1.5 pe-3 text-start font-medium text-foreground">{{ row.label }}</th>
                <td class="py-1.5 pe-3 text-muted-foreground">{{ row.namespace }}</td>
                <td class="py-1.5 pe-3 text-end tabular-nums text-foreground">{{ row.entries }}</td>
                <td class="py-1.5 pe-3 text-end tabular-nums text-foreground">{{ row.emptyEntries }}</td>
                <td class="py-1.5 text-end tabular-nums text-foreground">{{ row.size }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="text-sm text-muted-foreground">{{ t('settings.metadata.searchCache.stats.empty') }}</p>
      </div>
    </template>
  </section>
</template>
