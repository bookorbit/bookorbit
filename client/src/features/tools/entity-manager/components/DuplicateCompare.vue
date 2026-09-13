<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Check, GitMerge, UserMinus, X } from '@lucide/vue'
import type { ClusterEntity, DuplicateCluster } from '@bookorbit/types'
import { metadataScoreColor } from '@/lib/metadata-score-color'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'

import { clusterKey } from '../utils/duplicate-cluster'

const props = defineProps<{
  cluster: DuplicateCluster
  operationLoading: boolean
}>()

const emit = defineEmits<{
  merge: [targetId: number | string, sourceIds: (number | string)[], writeFiles: boolean]
  dismissEntity: [entityId: number | string]
  dismissPair: [idA: number | string, idB: number | string]
  dismissCluster: []
  back: []
}>()

const { t } = useI18n()

const writeFiles = ref(false)
const selectedTargetId = ref<number | string>(props.cluster.suggestedTargetId)

watch(
  () => clusterKey(props.cluster),
  () => {
    selectedTargetId.value = props.cluster.suggestedTargetId
  },
)

const sortedEntities = computed(() => [...props.cluster.entities].sort((a, b) => b.bookCount - a.bookCount))
const sourceIds = computed(() => props.cluster.entities.filter((entity) => entity.id !== selectedTargetId.value).map((entity) => entity.id))
const similarityPercent = computed(() => Math.round(props.cluster.averageSimilarity * 100))

const similarityStyle = computed<Record<string, string>>(() => {
  const color = metadataScoreColor(similarityPercent.value)
  return { color, backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)` }
})

function entityName(id: number | string): string {
  return props.cluster.entities.find((entity) => entity.id === id)?.name ?? t('tools.entityManager.unknown')
}

function pairPercent(similarity: number): number {
  return Math.round(similarity * 100)
}

function pairStyle(similarity: number): Record<string, string> {
  const color = metadataScoreColor(pairPercent(similarity))
  return { color, backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)` }
}

function handleSelectTarget(entity: ClusterEntity): void {
  selectedTargetId.value = entity.id
}

function handleDismissEntity(id: number | string): void {
  emit('dismissEntity', id)
}

function handleDismissPair(idA: number | string, idB: number | string): void {
  emit('dismissPair', idA, idB)
}

function handleDismissCluster(): void {
  emit('dismissCluster')
}

function handleMerge(): void {
  emit('merge', selectedTargetId.value, sourceIds.value, writeFiles.value)
}

function handleBack(): void {
  emit('back')
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex flex-none items-center gap-3 border-b border-border px-5 py-3">
      <button
        type="button"
        class="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
        :aria-label="t('tools.entityManager.duplicates.backToList')"
        @click="handleBack"
      >
        <ArrowLeft :size="16" aria-hidden="true" />
      </button>
      <p id="duplicate-compare-hint" class="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
        {{ t('tools.entityManager.duplicates.chooseTargetHint') }}
      </p>
      <span class="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums" :style="similarityStyle">
        {{ t('tools.entityManager.duplicates.percentSimilar', { percent: similarityPercent }) }}
      </span>
    </div>

    <div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
      <fieldset class="grid gap-3 sm:grid-cols-2" aria-labelledby="duplicate-compare-hint">
        <div v-for="entity in sortedEntities" :key="String(entity.id)" class="relative">
          <label
            class="flex h-full cursor-pointer flex-col rounded-xl border p-4 pe-11 transition-colors focus-within:ring-2 focus-within:ring-ring"
            :class="selectedTargetId === entity.id ? 'border-primary bg-primary/8' : 'border-border bg-card hover:bg-accent'"
          >
            <input
              type="radio"
              class="sr-only"
              name="duplicate-merge-target"
              :checked="selectedTargetId === entity.id"
              @change="handleSelectTarget(entity)"
            />
            <span
              class="text-[10.5px] font-bold uppercase tracking-wider"
              :class="selectedTargetId === entity.id ? 'text-primary' : 'text-muted-foreground'"
            >
              {{ selectedTargetId === entity.id ? t('tools.entityManager.duplicates.keepThisOne') : t('tools.entityManager.duplicates.mergeAway') }}
            </span>

            <span class="mt-1 flex items-center gap-2">
              <span class="truncate text-[15px] font-semibold text-foreground">{{ entity.name }}</span>
              <Check v-if="selectedTargetId === entity.id" :size="15" class="shrink-0 text-primary" aria-hidden="true" />
            </span>
            <span class="mt-0.5 block text-xs text-muted-foreground">
              {{ t('tools.entityManager.bookCount', { count: entity.bookCount }) }}
              <template v-if="entity.sortName"> {{ t('tools.entityManager.sortPrefix', { sortName: entity.sortName }) }}</template>
            </span>

            <span v-if="entity.bookTitles.length > 0" class="mt-3 block">
              <span v-for="title in entity.bookTitles" :key="title" class="block truncate text-xs text-muted-foreground">
                {{ title }}
              </span>
            </span>
            <span v-else class="mt-3 block text-xs text-[var(--pill-warning)]">{{ t('tools.entityManager.duplicates.noBookTitles') }}</span>
          </label>

          <button
            type="button"
            class="absolute end-3 top-3 grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :aria-label="t('tools.entityManager.duplicates.dismissEntityTitle')"
            :title="t('tools.entityManager.duplicates.dismissEntityTitle')"
            @click="handleDismissEntity(entity.id)"
          >
            <UserMinus :size="13" aria-hidden="true" />
          </button>
        </div>
      </fieldset>

      <section v-if="cluster.pairDetails.length > 1">
        <h3 class="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
          {{ t('tools.entityManager.duplicates.pairDetails') }}
        </h3>
        <ul class="space-y-1">
          <li
            v-for="pair in cluster.pairDetails"
            :key="`${pair.idA}-${pair.idB}`"
            class="flex items-center gap-2 rounded-md bg-secondary px-2.5 py-1.5"
          >
            <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground"> {{ entityName(pair.idA) }} &harr; {{ entityName(pair.idB) }} </span>
            <span class="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums" :style="pairStyle(pair.similarity)">
              {{ pairPercent(pair.similarity) }}%
            </span>
            <button
              type="button"
              class="grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-label="t('tools.entityManager.duplicates.dismissPairTitle')"
              :title="t('tools.entityManager.duplicates.dismissPairTitle')"
              @click="handleDismissPair(pair.idA, pair.idB)"
            >
              <X :size="12" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </section>
    </div>

    <div class="flex flex-none flex-wrap items-center gap-3 border-t border-border bg-secondary px-5 py-3">
      <span class="flex items-center gap-2">
        <ToggleSwitch v-model="writeFiles" aria-labelledby="duplicate-write-files" />
        <span id="duplicate-write-files" class="text-xs text-muted-foreground">{{ t('tools.entityManager.writeToFiles') }}</span>
      </span>
      <p class="text-xs text-muted-foreground">{{ t('tools.entityManager.duplicates.willBeMerged', { count: sourceIds.length }) }}</p>
      <div class="ms-auto flex items-center gap-2">
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-semibold text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :disabled="operationLoading"
          :title="t('tools.entityManager.duplicates.notAMatchTitle')"
          @click="handleDismissCluster"
        >
          <X :size="14" aria-hidden="true" />
          {{ t('tools.entityManager.duplicates.notAMatch') }}
        </button>
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :disabled="operationLoading || sourceIds.length === 0"
          @click="handleMerge"
        >
          <GitMerge :size="14" aria-hidden="true" />
          {{ t('tools.entityManager.mergeIntoTarget', { count: sourceIds.length }) }}
        </button>
      </div>
    </div>
  </div>
</template>
