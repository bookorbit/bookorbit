<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronDown, ChevronUp, UserMinus, X } from '@lucide/vue'
import type { DuplicateCluster, EntityTypeCapabilities } from '@bookorbit/types'

const { t } = useI18n()

const props = defineProps<{
  cluster: DuplicateCluster
  capabilities: EntityTypeCapabilities
  operationLoading: boolean
}>()

const emit = defineEmits<{
  merge: [targetId: number | string, sourceIds: (number | string)[], writeFiles: boolean]
  dismissEntity: [entityId: number | string]
  dismissPair: [idA: number | string, idB: number | string]
}>()

const expanded = ref(false)
const writeFiles = ref(false)
const selectedTargetId = ref<number | string>(props.cluster.suggestedTargetId)

const sortedEntities = computed(() => [...props.cluster.entities].sort((a, b) => b.bookCount - a.bookCount))

const primaryEntityName = computed(() => sortedEntities.value[0]?.name || t('tools.entityManager.unknown'))
const otherCount = computed(() => sortedEntities.value.length - 1)

const sourceIds = computed(() => props.cluster.entities.filter((e) => e.id !== selectedTargetId.value).map((e) => e.id))

function getSimilarityColorClass(similarity: number): string {
  const pct = similarity * 100
  if (pct >= 90) return 'bg-green-500/10 text-green-600 dark:text-green-400'
  if (pct >= 75) return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  if (pct >= 60) return 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
  if (pct >= 40) return 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
  return 'bg-red-500/10 text-red-600 dark:text-red-400'
}

function handleMerge(): void {
  emit('merge', selectedTargetId.value, sourceIds.value, writeFiles.value)
}

function handleDismissEntity(id: number | string): void {
  emit('dismissEntity', id)
}

function handleDismissPair(idA: number | string, idB: number | string): void {
  emit('dismissPair', idA, idB)
}

function handleSelectTarget(id: number | string): void {
  selectedTargetId.value = id
}

function toggleExpanded(): void {
  expanded.value = !expanded.value
}
</script>

<template>
  <div class="rounded-lg border border-border bg-card/60 overflow-hidden">
    <div class="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors" @click="toggleExpanded">
      <div class="flex items-center gap-3 min-w-0">
        <span class="text-sm font-medium truncate">
          {{ primaryEntityName }}
          <span v-if="otherCount > 0" class="text-muted-foreground font-normal">
            {{ t('tools.entityManager.duplicates.plusOthers', { count: otherCount }, otherCount) }}</span
          >
        </span>
        <span class="text-xs px-2 py-0.5 rounded-full shrink-0 transition-colors" :class="getSimilarityColorClass(cluster.averageSimilarity)">
          {{ t('tools.entityManager.duplicates.percentSimilar', { percent: (cluster.averageSimilarity * 100).toFixed(0) }) }}
        </span>
      </div>
      <component :is="expanded ? ChevronUp : ChevronDown" class="h-4 w-4 text-muted-foreground shrink-0" />
    </div>

    <div v-if="expanded" class="border-t border-border px-4 py-3 space-y-3">
      <div class="space-y-2">
        <p class="text-xs text-muted-foreground font-medium uppercase tracking-wider">{{ t('tools.entityManager.selectTargetToKeep') }}</p>
        <div
          v-for="entity in sortedEntities"
          :key="String(entity.id)"
          class="flex items-center gap-3 px-3 py-2 rounded-md border transition-colors cursor-pointer"
          :class="selectedTargetId === entity.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30'"
          @click="handleSelectTarget(entity.id)"
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium truncate">{{ entity.name }}</span>
              <Check v-if="selectedTargetId === entity.id" class="h-4 w-4 text-primary shrink-0" />
            </div>
            <div class="flex items-center gap-2 mt-0.5">
              <span class="text-xs text-muted-foreground">{{
                t('tools.entityManager.bookCount', { count: entity.bookCount }, entity.bookCount)
              }}</span>
              <span v-if="entity.sortName" class="text-xs text-muted-foreground">{{
                t('tools.entityManager.sortPrefix', { sortName: entity.sortName })
              }}</span>
            </div>
            <div v-if="entity.bookTitles.length > 0" class="mt-1">
              <span class="text-xs text-muted-foreground">{{ entity.bookTitles.slice(0, 3).join(', ') }}</span>
            </div>
          </div>
          <button
            class="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
            :title="t('tools.entityManager.duplicates.dismissEntityTitle')"
            @click.stop="handleDismissEntity(entity.id)"
          >
            <UserMinus class="h-4 w-4" />
          </button>
        </div>
      </div>

      <div v-if="cluster.pairDetails.length > 0" class="space-y-1">
        <p class="text-xs text-muted-foreground font-medium uppercase tracking-wider">{{ t('tools.entityManager.duplicates.pairDetails') }}</p>
        <div v-for="(pair, idx) in cluster.pairDetails" :key="idx" class="flex items-center gap-2 text-xs px-2 py-1 rounded bg-muted/30">
          <span class="flex-1 text-muted-foreground truncate">
            {{ cluster.entities.find((e) => e.id === pair.idA)?.name }} <span class="text-foreground/50">&harr;</span>
            {{ cluster.entities.find((e) => e.id === pair.idB)?.name }}
          </span>
          <span class="font-mono shrink-0 px-1.5 py-0.5 rounded-sm" :class="getSimilarityColorClass(pair.similarity)">
            {{ (pair.similarity * 100).toFixed(0) }}%
          </span>
          <button
            class="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-0.5 rounded"
            :title="t('tools.entityManager.duplicates.dismissPairTitle')"
            @click.stop="handleDismissPair(pair.idA, pair.idB)"
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div class="flex items-center justify-between pt-2 border-t border-border/50">
        <label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input v-model="writeFiles" type="checkbox" class="rounded accent-primary" />
          {{ t('tools.entityManager.writeToFiles') }}
        </label>
        <button
          class="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none transition-colors"
          :disabled="operationLoading || sourceIds.length === 0"
          @click="handleMerge"
        >
          {{ t('tools.entityManager.mergeIntoTarget', { count: sourceIds.length }) }}
        </button>
      </div>
    </div>
  </div>
</template>
