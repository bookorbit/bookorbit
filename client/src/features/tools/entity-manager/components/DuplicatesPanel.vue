<script setup lang="ts">
import { computed, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { CheckCircle2, Search, Sparkles } from '@lucide/vue'
import type { DismissedPairInfo, DuplicateCluster } from '@bookorbit/types'

import DuplicateClusterList from './DuplicateClusterList.vue'
import DuplicateCompare from './DuplicateCompare.vue'
import DismissedPairsSection from './DismissedPairsSection.vue'
import { useDuplicateReview } from '../composables/useDuplicateReview'

const props = defineProps<{
  clusters: DuplicateCluster[]
  page: number
  totalPages: number
  scanning: boolean
  hasScanned: boolean
  scanError: string | null
  operationLoading: boolean
  dismissedPairs: DismissedPairInfo[]
  dismissedLoading: boolean
  showDismissed: boolean
}>()

const emit = defineEmits<{
  'update:page': [value: number]
  merge: [targetId: number | string, sourceIds: (number | string)[], writeFiles: boolean]
  dismissEntity: [cluster: DuplicateCluster, entityId: number | string]
  dismissPair: [idA: number | string, idB: number | string]
  dismissCluster: [cluster: DuplicateCluster]
  undismiss: [idA: number | string, idB: number | string]
  toggleDismissed: []
}>()

const { t } = useI18n()

const { activeKey, activeCluster, selectCluster, clearSelection } = useDuplicateReview(toRef(props, 'clusters'))

const showEmptyState = computed(() => !props.scanning && props.clusters.length === 0 && props.scanError === null)

function handleUpdatePage(value: number): void {
  emit('update:page', value)
}

function handleMerge(targetId: number | string, sourceIds: (number | string)[], writeFiles: boolean): void {
  emit('merge', targetId, sourceIds, writeFiles)
}

function handleDismissEntity(entityId: number | string): void {
  if (!activeCluster.value) return
  emit('dismissEntity', activeCluster.value, entityId)
}

function handleDismissPair(idA: number | string, idB: number | string): void {
  emit('dismissPair', idA, idB)
}

function handleDismissCluster(): void {
  if (!activeCluster.value) return
  emit('dismissCluster', activeCluster.value)
}

function handleUndismiss(idA: number | string, idB: number | string): void {
  emit('undismiss', idA, idB)
}

function handleToggleDismissed(): void {
  emit('toggleDismissed')
}
</script>

<template>
  <div class="flex h-full flex-col">
    <p v-if="scanError" class="flex-none rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
      {{ scanError }}
    </p>

    <!-- Empty states -->
    <div
      v-else-if="showEmptyState"
      class="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-border bg-card p-10 text-center"
    >
      <div class="rounded-full p-4" :class="hasScanned ? 'bg-[var(--pill-success)]/12' : 'bg-muted'">
        <CheckCircle2 v-if="hasScanned" :size="28" class="text-[var(--pill-success)]" aria-hidden="true" />
        <Search v-else :size="28" class="text-muted-foreground" aria-hidden="true" />
      </div>
      <div class="space-y-1">
        <p class="text-sm font-semibold text-foreground">
          {{ hasScanned ? t('tools.entityManager.duplicates.noneFoundTitle') : t('tools.entityManager.duplicates.emptyTitle') }}
        </p>
        <p class="max-w-sm text-xs text-muted-foreground">
          {{ hasScanned ? t('tools.entityManager.duplicates.noneFoundDescription') : t('tools.entityManager.duplicates.emptyDescription') }}
        </p>
      </div>
    </div>

    <!-- Split review view -->
    <div v-else class="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
      <div class="min-h-0 w-full flex-col border-border md:w-72 md:shrink-0 md:border-e lg:w-80" :class="activeCluster ? 'hidden md:flex' : 'flex'">
        <DuplicateClusterList
          :clusters="clusters"
          :active-key="activeKey"
          :page="page"
          :total-pages="totalPages"
          @select="selectCluster"
          @update:page="handleUpdatePage"
        />
      </div>

      <DuplicateCompare
        v-if="activeCluster"
        :key="activeKey ?? ''"
        :cluster="activeCluster"
        :operation-loading="operationLoading"
        @merge="handleMerge"
        @dismiss-entity="handleDismissEntity"
        @dismiss-pair="handleDismissPair"
        @dismiss-cluster="handleDismissCluster"
        @back="clearSelection"
      />

      <div v-else class="hidden min-h-0 flex-1 flex-col items-center justify-center gap-3 p-10 text-center md:flex">
        <div class="rounded-full bg-muted p-3">
          <Sparkles :size="22" class="text-muted-foreground" aria-hidden="true" />
        </div>
        <div class="space-y-1">
          <p class="text-sm font-semibold text-foreground">{{ t('tools.entityManager.duplicates.selectPromptTitle') }}</p>
          <p class="max-w-xs text-xs text-muted-foreground">{{ t('tools.entityManager.duplicates.selectPromptDescription') }}</p>
        </div>
      </div>
    </div>

    <!-- Dismissed pairs -->
    <div class="flex-none pt-3">
      <button
        type="button"
        class="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-expanded="showDismissed"
        @click="handleToggleDismissed"
      >
        {{ showDismissed ? t('tools.entityManager.dismissed.hidePairs') : t('tools.entityManager.dismissed.showPairs') }}
        <template v-if="!showDismissed && dismissedPairs.length > 0"> ({{ dismissedPairs.length }})</template>
      </button>
      <div v-if="showDismissed" class="mt-2 max-h-52 overflow-y-auto">
        <DismissedPairsSection :pairs="dismissedPairs" :loading="dismissedLoading" @undismiss="handleUndismiss" />
      </div>
    </div>
  </div>
</template>
