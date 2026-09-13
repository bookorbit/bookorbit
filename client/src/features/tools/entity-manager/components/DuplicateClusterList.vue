<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight } from '@lucide/vue'
import type { DuplicateCluster } from '@bookorbit/types'
import { metadataScoreColor } from '@/lib/metadata-score-color'

import { clusterKey } from '../utils/duplicate-cluster'

const props = defineProps<{
  clusters: DuplicateCluster[]
  activeKey: string | null
  page: number
  totalPages: number
}>()

const emit = defineEmits<{
  select: [key: string]
  'update:page': [value: number]
}>()

const { t } = useI18n()

function keyOf(cluster: DuplicateCluster): string {
  return clusterKey(cluster)
}

function primaryName(cluster: DuplicateCluster): string {
  return [...cluster.entities].sort((a, b) => b.bookCount - a.bookCount)[0]?.name ?? t('tools.entityManager.unknown')
}

function otherCount(cluster: DuplicateCluster): number {
  return cluster.entities.length - 1
}

function similarityPercent(cluster: DuplicateCluster): number {
  return Math.round(cluster.averageSimilarity * 100)
}

function similarityStyle(cluster: DuplicateCluster): Record<string, string> {
  const color = metadataScoreColor(similarityPercent(cluster))
  return { color, backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)` }
}

function handleSelect(cluster: DuplicateCluster): void {
  emit('select', keyOf(cluster))
}

function handlePrevPage(): void {
  emit('update:page', props.page - 1)
}

function handleNextPage(): void {
  emit('update:page', props.page + 1)
}
</script>

<template>
  <div class="flex min-h-0 flex-col">
    <ul class="min-h-0 flex-1 divide-y divide-border overflow-y-auto" :aria-label="t('tools.entityManager.duplicates.groupsLabel')">
      <li v-for="cluster in clusters" :key="keyOf(cluster)">
        <button
          type="button"
          class="relative flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          :class="activeKey === keyOf(cluster) ? 'bg-accent' : ''"
          :aria-current="activeKey === keyOf(cluster) ? 'true' : undefined"
          @click="handleSelect(cluster)"
        >
          <span v-if="activeKey === keyOf(cluster)" class="absolute inset-y-0 start-0 w-0.5 bg-primary" aria-hidden="true" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium text-foreground">{{ primaryName(cluster) }}</span>
            <span class="block truncate text-xs text-muted-foreground">
              {{ t('tools.entityManager.duplicates.plusOthers', { count: otherCount(cluster) }) }}
            </span>
          </span>
          <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums" :style="similarityStyle(cluster)">
            {{ similarityPercent(cluster) }}%
          </span>
        </button>
      </li>
    </ul>

    <div v-if="totalPages > 1" class="flex flex-none items-center justify-between gap-2 border-t border-border px-3 py-2">
      <button
        type="button"
        class="grid size-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :disabled="page <= 1"
        :aria-label="t('tools.entityManager.browse.previousPage')"
        @click="handlePrevPage"
      >
        <ChevronLeft :size="14" aria-hidden="true" />
      </button>
      <span class="text-xs text-muted-foreground tabular-nums">{{ page }} / {{ totalPages }}</span>
      <button
        type="button"
        class="grid size-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :disabled="page >= totalPages"
        :aria-label="t('tools.entityManager.browse.nextPage')"
        @click="handleNextPage"
      >
        <ChevronRight :size="14" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
