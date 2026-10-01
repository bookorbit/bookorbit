<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronUp, RefreshCw, RotateCcw, ScanSearch, TriangleAlert } from '@lucide/vue'
import type { MetadataCandidate, MetadataProviderInfo, MetadataProviderKey, MetadataProviderSearchOutcome } from '@bookorbit/types'
import { candidateKey, type MatchGroups } from '../../lib/metadata-match'
import type { DifferenceSummary } from '../../lib/metadata-diff-fields'
import MetadataMatchQuery, { type MetadataQuery } from './MetadataMatchQuery.vue'
import MetadataMatchSources from './MetadataMatchSources.vue'
import MetadataMatchResultRow from './MetadataMatchResultRow.vue'

const props = defineProps<{
  searchDefaults: { title?: string; author?: string; isbn?: string }
  providers: MetadataProviderInfo[]
  selectedProviders: MetadataProviderKey[]
  providerCounts: Partial<Record<MetadataProviderKey, number>>
  interruptedProviders: { provider: MetadataProviderKey; outcome: MetadataProviderSearchOutcome }[]
  retryingProviders: MetadataProviderKey[]
  isStreaming: boolean
  hasSearched: boolean
  groups: MatchGroups
  summaries: Map<string, DifferenceSummary>
  selectedKey: string | null
  stagedByCandidate: Map<string, number>
  coverRatio: string
}>()

const emit = defineEmits<{
  search: [MetadataQuery]
  toggleProvider: [MetadataProviderKey]
  selectAll: []
  selectFieldRules: []
  retryProvider: [MetadataProviderKey]
  select: [MetadataCandidate]
}>()

const { t } = useI18n()
const query = ref<InstanceType<typeof MetadataMatchQuery> | null>(null)
const otherBooksOpen = defineModel<boolean>('otherBooksOpen', { default: false })

const INTERRUPTION_KEYS: Record<MetadataProviderSearchOutcome, string> = {
  timeout: 'book.detail.editMetadata.searchPanel.providerTimedOut',
  throttled: 'book.detail.editMetadata.searchPanel.providerThrottled',
  failed: 'book.detail.editMetadata.searchPanel.providerFailed',
}

const total = computed(() => props.groups.strong.length + props.groups.possible.length + props.groups.weak.length)
const interruptions = computed(() =>
  props.interruptedProviders
    .filter((entry) => !props.retryingProviders.includes(entry.provider))
    .map(({ provider, outcome }) => {
      const label = props.providers.find((p) => p.key === provider)?.label ?? provider
      return { provider, label, message: t(INTERRUPTION_KEYS[outcome], { provider: label }) }
    }),
)
const noResults = computed(() => props.hasSearched && !props.isStreaming && total.value === 0 && !props.retryingProviders.length)
const sourceCount = computed(() => props.selectedProviders.length || props.providers.length)

const SUMMARY_NONE: DifferenceSummary = { fills: 0, changes: 0 }

function summaryOf(candidate: MetadataCandidate): DifferenceSummary {
  return props.summaries.get(candidateKey(candidate)) ?? SUMMARY_NONE
}

function stagedOf(candidate: MetadataCandidate): number {
  return props.stagedByCandidate.get(candidateKey(candidate)) ?? 0
}

function isSelected(candidate: MetadataCandidate): boolean {
  return props.selectedKey === candidateKey(candidate)
}

function handleSearch(value: MetadataQuery) {
  emit('search', value)
}

function handleSearchTitleOnly() {
  emit('search', { title: props.searchDefaults.title ?? '', author: '', isbn: '' })
}

function handleUseBookDetails() {
  emit('search', { title: props.searchDefaults.title ?? '', author: props.searchDefaults.author ?? '', isbn: props.searchDefaults.isbn ?? '' })
}

function handleToggle(key: MetadataProviderKey) {
  emit('toggleProvider', key)
}

function handleSelectAll() {
  emit('selectAll')
}

function handleSelectFieldRules() {
  emit('selectFieldRules')
}

function handleRetry(provider: MetadataProviderKey) {
  emit('retryProvider', provider)
}

function handleSelect(candidate: MetadataCandidate) {
  emit('select', candidate)
}

function toggleOtherBooks() {
  otherBooksOpen.value = !otherBooksOpen.value
}

function focusQuery() {
  query.value?.focusTitle()
}

defineExpose({ focusQuery })
</script>

<template>
  <aside class="flex min-h-0 flex-col bg-card/50" :aria-label="t('book.detail.editMetadata.match.results.label')">
    <div class="grid gap-3 border-b border-border/60 px-3.5 pt-3.5 pb-3">
      <MetadataMatchQuery ref="query" :defaults="searchDefaults" :busy="isStreaming" @search="handleSearch" />
      <MetadataMatchSources
        v-if="providers.length"
        :providers="providers"
        :selected-providers="selectedProviders"
        :provider-counts="providerCounts"
        :interrupted-providers="interruptedProviders"
        :retrying-providers="retryingProviders"
        :is-streaming="isStreaming"
        @toggle="handleToggle"
        @select-all="handleSelectAll"
        @select-field-rules="handleSelectFieldRules"
      />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-4" data-match-results>
      <p v-if="!hasSearched" class="px-3 py-10 text-center text-sm text-muted-foreground">{{ t('book.detail.editMetadata.match.results.prompt') }}</p>

      <div
        v-else-if="noResults"
        role="status"
        class="mx-2 mt-4 grid justify-items-center gap-2.5 rounded-xl border border-dashed border-border px-3 py-6 text-center"
      >
        <span class="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground"
          ><ScanSearch class="size-[18px]" aria-hidden="true"
        /></span>
        <p class="text-[13px] font-semibold">{{ t('book.detail.editMetadata.match.results.noMatches') }}</p>
        <p class="max-w-[36ch] text-xs text-muted-foreground">
          {{ t('book.detail.editMetadata.match.results.noMatchesHint', { count: sourceCount }) }}
        </p>
        <div v-for="entry in interruptions" :key="entry.provider" class="text-xs text-muted-foreground">{{ entry.message }}</div>
        <div class="flex flex-wrap justify-center gap-1.5">
          <button
            type="button"
            class="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11.5px] font-medium hover:bg-muted"
            @click="handleUseBookDetails"
          >
            <RotateCcw class="size-3" aria-hidden="true" />{{ t('book.detail.editMetadata.match.query.useBookDetails') }}
          </button>
          <button
            type="button"
            class="inline-flex h-6 items-center rounded-md border border-border bg-background px-2 text-[11.5px] font-medium hover:bg-muted"
            @click="handleSearchTitleOnly"
          >
            {{ t('book.detail.editMetadata.match.results.searchTitleOnly') }}
          </button>
        </div>
      </div>

      <template v-else>
        <template v-if="groups.strong.length">
          <h3 class="flex items-center gap-2 px-2 pt-3 pb-1.5 text-[10.5px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
            {{ t('book.detail.editMetadata.match.results.best')
            }}<span class="text-[11px] font-semibold tracking-normal tabular-nums">{{ groups.strong.length }}</span>
          </h3>
          <MetadataMatchResultRow
            v-for="match in groups.strong"
            :key="candidateKey(match.candidate)"
            :candidate="match.candidate"
            :assessment="match.assessment"
            :summary="summaryOf(match.candidate)"
            :providers="providers"
            :selected="isSelected(match.candidate)"
            :staged-count="stagedOf(match.candidate)"
            :cover-ratio="coverRatio"
            @select="handleSelect"
          />
        </template>

        <template v-if="groups.possible.length">
          <h3 class="flex items-center gap-2 px-2 pt-3 pb-1.5 text-[10.5px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
            {{ t('book.detail.editMetadata.match.results.otherEditions')
            }}<span class="text-[11px] font-semibold tracking-normal tabular-nums">{{ groups.possible.length }}</span>
          </h3>
          <MetadataMatchResultRow
            v-for="match in groups.possible"
            :key="candidateKey(match.candidate)"
            :candidate="match.candidate"
            :assessment="match.assessment"
            :summary="summaryOf(match.candidate)"
            :providers="providers"
            :selected="isSelected(match.candidate)"
            :staged-count="stagedOf(match.candidate)"
            :cover-ratio="coverRatio"
            @select="handleSelect"
          />
        </template>

        <template v-if="isStreaming">
          <h3 class="px-2 pt-3 pb-1.5 text-[10.5px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
            {{ t('book.detail.editMetadata.match.results.stillSearching') }}
          </h3>
          <div v-for="n in total ? 2 : 5" :key="n" class="grid grid-cols-[2.875rem_minmax(0,1fr)] gap-2.5 p-2" aria-hidden="true">
            <span class="block w-full animate-pulse rounded-[5px] bg-muted motion-reduce:animate-none" :style="{ aspectRatio: coverRatio }" />
            <span class="grid content-start gap-1.5 pt-1">
              <span class="h-3 w-4/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              <span class="h-2.5 w-3/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              <span class="h-4 w-2/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            </span>
          </div>
        </template>

        <div
          v-for="entry in interruptions"
          :key="entry.provider"
          role="status"
          class="mx-2 my-2 grid grid-cols-[1rem_minmax(0,1fr)] gap-2 rounded-lg border border-dashed border-warning/50 px-2.5 py-2 text-xs"
        >
          <TriangleAlert class="mt-0.5 size-3.5 text-warning" aria-hidden="true" />
          <span>
            <span class="font-semibold">{{ entry.message }}</span>
            {{ t('book.detail.editMetadata.match.results.mayBeMissing') }}
            <button
              type="button"
              class="mt-1.5 flex h-6 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11.5px] font-medium hover:bg-muted"
              @click="handleRetry(entry.provider)"
            >
              <RefreshCw class="size-3" aria-hidden="true" />{{ t('book.detail.editMetadata.match.results.retry', { provider: entry.label }) }}
            </button>
          </span>
        </div>

        <template v-if="groups.weak.length">
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-lg px-2 pt-3 pb-1.5 text-start hover:bg-muted"
            :aria-expanded="otherBooksOpen"
            @click="toggleOtherBooks"
          >
            <span class="text-[10.5px] font-bold tracking-[0.12em] text-muted-foreground uppercase">{{
              t('book.detail.editMetadata.match.results.otherBooks')
            }}</span>
            <span class="text-[11px] font-semibold text-muted-foreground tabular-nums">{{ groups.weak.length }}</span>
            <span class="flex-1" />
            <ChevronUp v-if="otherBooksOpen" class="size-3.5 text-foreground" aria-hidden="true" />
            <ChevronDown v-else class="size-3.5 text-foreground" aria-hidden="true" />
          </button>
          <template v-if="otherBooksOpen">
            <MetadataMatchResultRow
              v-for="match in groups.weak"
              :key="candidateKey(match.candidate)"
              :candidate="match.candidate"
              :assessment="match.assessment"
              :summary="summaryOf(match.candidate)"
              :providers="providers"
              :selected="isSelected(match.candidate)"
              :staged-count="stagedOf(match.candidate)"
              :cover-ratio="coverRatio"
              @select="handleSelect"
            />
          </template>
        </template>
      </template>
    </div>
  </aside>
</template>
