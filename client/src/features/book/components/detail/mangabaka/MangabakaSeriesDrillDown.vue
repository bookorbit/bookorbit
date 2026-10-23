<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronUp, AlertCircle, RefreshCw } from '@lucide/vue'
import type { MangabakaCollectionSummary, MetadataCandidate } from '@bookorbit/types'
import type { MangabakaDrillDown } from '../../../composables/useMangabakaDrillDown'
import MangabakaVolumeCard from './MangabakaVolumeCard.vue'

const props = defineProps<{
  seriesCandidate: MetadataCandidate
  drillDown: MangabakaDrillDown
}>()

const emit = defineEmits<{ select: [MetadataCandidate] }>()

const { t } = useI18n()
const providerId = computed(() => props.seriesCandidate.providerId)
const seriesId = computed(() => Number(props.seriesCandidate.providerId))
const isExpanded = computed(() => props.drillDown.isSeriesExpanded(providerId.value))
const isLoading = computed(() => props.drillDown.isLoadingSeries(providerId.value))
const collections = computed(() => props.drillDown.collectionsBySeries.value.get(providerId.value) ?? [])
const seriesError = computed(() => props.drillDown.seriesErrors.value.get(providerId.value))

function handleToggleSeries() {
  props.drillDown.expandSeries(providerId.value, seriesId.value)
}

function handleToggleCollection(collection: MangabakaCollectionSummary) {
  props.drillDown.expandCollection(providerId.value, collection.id, seriesId.value)
}

function handleRetrySeries() {
  props.drillDown.retrySeries(providerId.value, seriesId.value)
}

function handleRetryCollection(collection: MangabakaCollectionSummary) {
  props.drillDown.retryCollection(providerId.value, collection.id, seriesId.value)
}

function handleSelectVolume(candidate: MetadataCandidate) {
  emit('select', candidate)
}

function isCollectionExpanded(collection: MangabakaCollectionSummary) {
  return props.drillDown.isCollectionExpanded(providerId.value, collection.id)
}

function isCollectionLoading(collection: MangabakaCollectionSummary) {
  return props.drillDown.isLoadingCollection(providerId.value, collection.id)
}

function collectionWorks(collection: MangabakaCollectionSummary) {
  return props.drillDown.worksByCollection.value.get(collection.id) ?? []
}

function collectionError(collection: MangabakaCollectionSummary) {
  return props.drillDown.collectionErrors.value.get(collection.id)
}

function collectionTotalCount(collection: MangabakaCollectionSummary): number {
  return collection.countMain + collection.countExtra + collection.countOther
}

function isHighlightedVolume(candidate: MetadataCandidate): boolean {
  const highlighted = props.drillDown.highlightedVolume.value
  if (highlighted == null || candidate.seriesIndex == null) return false
  return Number(candidate.seriesIndex) === highlighted
}

watch(
  () => props.drillDown.highlightedVolume.value,
  async (volume) => {
    if (volume == null) return
    if (!isExpanded.value) {
      await props.drillDown.expandSeries(providerId.value, seriesId.value)
    }
    for (const collection of collections.value) {
      if (isCollectionExpanded(collection)) {
        if (collectionWorks(collection).some((work) => work.seriesIndex != null && Number(work.seriesIndex) === volume)) return
      } else {
        await props.drillDown.expandCollection(providerId.value, collection.id, seriesId.value)
        if (collectionWorks(collection).some((work) => work.seriesIndex != null && Number(work.seriesIndex) === volume)) return
      }
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="rounded-xl border border-border bg-card overflow-hidden">
    <button
      type="button"
      class="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      :aria-expanded="isExpanded"
      :aria-controls="'series-panel-' + seriesCandidate.providerId"
      @click="handleToggleSeries"
    >
      <span class="min-w-0 flex-1 flex items-baseline gap-2">
        <h3 class="text-sm font-semibold text-foreground truncate">{{ seriesCandidate.title }}</h3>
        <span class="shrink-0 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
          {{ t('book.detail.editMetadata.mangabakaDrillDown.seriesLabel') }}
        </span>
      </span>
      <span class="flex items-center gap-2 shrink-0">
        <span class="text-xs text-muted-foreground">{{ t('book.detail.editMetadata.mangabakaDrillDown.browseVolumes') }}</span>
        <component :is="isExpanded ? ChevronUp : ChevronDown" class="size-4 text-muted-foreground" />
      </span>
    </button>

    <div v-if="isExpanded" :id="'series-panel-' + seriesCandidate.providerId" class="border-t border-border px-3 pb-3" aria-live="polite">
      <div v-if="isLoading" aria-busy="true" class="py-3 space-y-2">
        <div v-for="i in 2" :key="i" class="rounded-lg border border-border/40 bg-card animate-pulse px-3 py-2.5">
          <div class="flex items-center justify-between">
            <div class="flex items-baseline gap-2">
              <div class="h-4 w-40 rounded bg-muted" />
              <div class="h-3 w-16 rounded bg-muted" />
            </div>
            <div class="h-4 w-4 rounded bg-muted" />
          </div>
        </div>
        <p class="text-center text-sm text-muted-foreground">
          {{ t('book.detail.editMetadata.mangabakaDrillDown.loadingCollections') }}
        </p>
      </div>

      <div v-else-if="seriesError" class="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-3 mt-3" role="alert">
        <div class="flex items-start gap-2">
          <AlertCircle class="size-4 text-destructive shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0">
            <p class="text-sm text-destructive">{{ seriesError }}</p>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 mt-2 text-xs font-medium text-destructive hover:text-destructive transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
              @click="handleRetrySeries"
            >
              <RefreshCw class="size-3.5" />
              {{ t('book.detail.editMetadata.mangabakaDrillDown.retry') }}
            </button>
          </div>
        </div>
      </div>

      <div v-else-if="!collections.length" class="py-6 text-center text-sm text-muted-foreground">
        {{ t('book.detail.editMetadata.mangabakaDrillDown.noCollections') }}
      </div>

      <div v-else class="space-y-2 pt-2">
        <div v-for="collection in collections" :key="collection.id" class="rounded-lg border border-border/60 overflow-hidden">
          <button
            type="button"
            class="w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            :aria-expanded="isCollectionExpanded(collection)"
            :aria-controls="'collection-panel-' + collection.id"
            @click="handleToggleCollection(collection)"
          >
            <span class="min-w-0 flex-1 flex flex-col gap-0.5">
              <h4 class="text-sm font-medium text-foreground">{{ collection.title }}</h4>
              <span class="flex items-center gap-1.5 flex-wrap">
                <span
                  class="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase"
                  :title="collection.languageDisplay"
                >
                  {{ collection.language }}
                </span>
                <span v-if="collection.publisher" class="text-[10px] text-muted-foreground">
                  {{ collection.publisher }}
                </span>
                <span
                  v-if="collection.medium"
                  class="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase"
                >
                  {{ collection.medium }}
                </span>
                <span class="text-[10px] text-muted-foreground tabular-nums">
                  {{ t('book.detail.editMetadata.mangabakaDrillDown.totalVolumeLabel', { n: collectionTotalCount(collection) }) }}
                </span>
              </span>
            </span>
            <component :is="isCollectionExpanded(collection) ? ChevronUp : ChevronDown" class="size-4 text-muted-foreground shrink-0" />
          </button>

          <div
            v-if="isCollectionExpanded(collection)"
            :id="'collection-panel-' + collection.id"
            class="border-t border-border/60 bg-muted/20 px-2 py-2"
            aria-live="polite"
          >
            <div v-if="isCollectionLoading(collection)" aria-busy="true" class="py-2">
              <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
                <div v-for="i in 6" :key="i" class="flex flex-col items-center gap-1.5 p-2 rounded-xl border border-border/40 bg-card animate-pulse">
                  <div class="rounded-lg bg-muted" :style="{ width: '60px', aspectRatio: '2/3' }" />
                  <div class="w-full flex flex-col gap-0.5">
                    <div class="h-3 w-8 rounded bg-muted" />
                    <div class="h-2.5 w-full rounded bg-muted" />
                  </div>
                </div>
              </div>
              <p class="mt-2 text-center text-xs text-muted-foreground">
                {{ t('book.detail.editMetadata.mangabakaDrillDown.loadingVolumes') }}
              </p>
            </div>

            <div v-else-if="collectionError(collection)" class="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-3" role="alert">
              <div class="flex items-start gap-2">
                <AlertCircle class="size-4 text-destructive shrink-0 mt-0.5" />
                <div class="flex-1 min-w-0">
                  <p class="text-sm text-destructive">{{ collectionError(collection) }}</p>
                  <button
                    type="button"
                    class="inline-flex items-center gap-1.5 mt-2 text-xs font-medium text-destructive hover:text-destructive transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
                    @click="handleRetryCollection(collection)"
                  >
                    <RefreshCw class="size-3.5" />
                    {{ t('book.detail.editMetadata.mangabakaDrillDown.retry') }}
                  </button>
                </div>
              </div>
            </div>

            <div v-else-if="!collectionWorks(collection).length" class="py-4 text-center text-xs text-muted-foreground">
              {{ t('book.detail.editMetadata.mangabakaDrillDown.noVolumes') }}
            </div>

            <div v-else class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2" role="list">
              <MangabakaVolumeCard
                v-for="work in collectionWorks(collection)"
                :key="work.providerId"
                role="listitem"
                :series-name="seriesCandidate.title"
                :candidate="work"
                :is-highlighted="isHighlightedVolume(work)"
                @select="handleSelectVolume"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
