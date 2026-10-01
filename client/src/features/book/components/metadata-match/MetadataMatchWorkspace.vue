<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  BookMetadataLockField,
  CoverMedium,
  MetadataCandidate,
  MetadataProviderInfo,
  MetadataProviderKey,
  MetadataProviderSearchOutcome,
  MetadataSource,
  ProviderIds,
} from '@bookorbit/types'
import {
  coverLooksBroken,
  useMetadataDiff,
  type CoverChoice,
  type FieldDecision,
  type MetadataDiffApply,
  type StagedChange,
} from '../../composables/useMetadataDiff'
import { useSecondCoverRow, type SecondCoverInput } from '../../composables/useSecondCoverRow'
import { useCoverShapes } from '../../composables/useCoverShapes'
import { coverFit, coverLockField } from '../../lib/cover-slots'
import { summarizeDifferences, type DiffFieldKey } from '../../lib/metadata-diff-fields'
import { candidateKey, groupMatches, rankMatches, type MatchSubject } from '../../lib/metadata-match'
import { toDisplayCoverUrl } from '../../lib/metadata-fetch'
import MetadataMatchRail from './MetadataMatchRail.vue'
import MetadataMatchCompare, { type CoverCardModel, type RowFilter } from './MetadataMatchCompare.vue'
import MetadataMatchFooter from './MetadataMatchFooter.vue'
import type { MetadataQuery } from './MetadataMatchQuery.vue'

const props = defineProps<{
  current: MetadataSource
  providerIds?: ProviderIds
  lockedFields?: BookMetadataLockField[]
  currentCoverUrl?: string
  /** The slot the main cover fills. */
  coverMedium: CoverMedium
  /** Providers in the order the main slot's cover rule ranks them. */
  coverPriority?: MetadataProviderKey[]
  /** The other medium's cover, for a book that has both; fed by its own search. */
  secondCover?: SecondCoverInput | null
  searchDefaults: { title?: string; author?: string; isbn?: string }
  providers: MetadataProviderInfo[]
  results: MetadataCandidate[]
  providerCounts: Partial<Record<MetadataProviderKey, number>>
  selectedProviders: MetadataProviderKey[]
  interruptedProviders: { provider: MetadataProviderKey; outcome: MetadataProviderSearchOutcome }[]
  retryingProviders?: MetadataProviderKey[]
  providerOrder?: MetadataProviderKey[]
  isStreaming: boolean
  hasSearched: boolean
  /** One result to compare with no search, like metadata fetched earlier. Hides the results rail. */
  fixedCandidate?: MetadataCandidate | null
  /** What Apply does, when it does more than fill a form. */
  applyHint?: string
}>()

const emit = defineEmits<{
  search: [MetadataQuery]
  toggleProvider: [MetadataProviderKey]
  selectAll: []
  selectFieldRules: []
  retryProvider: [MetadataProviderKey]
  apply: [MetadataDiffApply]
  cancel: []
}>()

const { t } = useI18n()

const rail = ref<InstanceType<typeof MetadataMatchRail> | null>(null)
const root = ref<HTMLElement | null>(null)
const screen = ref<'matches' | 'compare'>(props.fixedCandidate ? 'compare' : 'matches')
const filter = ref<RowFilter>('diff')
const otherBooksOpen = ref(false)
const selectedKey = ref<string | null>(null)

const subject = computed<MatchSubject>(() => ({
  title: props.current.title,
  authors: props.current.authors,
  isbn13: props.current.isbn13,
  isbn10: props.current.isbn10,
  seriesName: props.current.seriesName,
  seriesIndex: props.current.seriesIndex,
  providerIds: props.providerIds,
}))
const pool = computed<MetadataCandidate[]>(() => (props.fixedCandidate ? [props.fixedCandidate] : props.results))
const ranked = computed(() => rankMatches(pool.value, subject.value, props.providerOrder ?? []))
const groups = computed(() => groupMatches(ranked.value))
const assessments = computed(() => new Map(ranked.value.map((match) => [candidateKey(match.candidate), match.assessment])))
const summaries = computed(
  () => new Map(pool.value.map((candidate) => [candidateKey(candidate), summarizeDifferences(props.current, candidate, props.providerIds)])),
)
const navList = computed(() =>
  [...groups.value.strong, ...groups.value.possible, ...(otherBooksOpen.value ? groups.value.weak : [])].map((match) => match.candidate),
)
const selected = computed(() => pool.value.find((candidate) => candidateKey(candidate) === selectedKey.value) ?? null)
const selectedAssessment = computed(() => (selectedKey.value ? (assessments.value.get(selectedKey.value) ?? null) : null))
/** Likely matches only: other books' values and covers would be noise beside this book's. */
const alternatives = computed(() => [...groups.value.strong, ...groups.value.possible].map((match) => match.candidate))
const coverRatio = computed(() => (props.coverMedium === 'audio' ? '1/1' : '2/3'))
/** A fixed result can come from no search provider, like the automatic fetch; it still needs a name. */
const knownProviders = computed<MetadataProviderInfo[]>(() => {
  const fixed = props.fixedCandidate
  if (!fixed || props.providers.some((provider) => provider.key === fixed.provider)) return props.providers
  return [...props.providers, { key: fixed.provider, label: t('book.detail.editMetadata.match.results.fetched'), identifiable: false }]
})

/** Set once someone picks a result or stages a value, so a better match arriving later never pulls the view away. */
const settled = ref(false)

// The best match opens as soon as one arrives. Until someone settles on it, a better one that arrives later replaces it.
watch(
  [ranked, () => props.isStreaming, () => props.fixedCandidate],
  () => {
    if (props.fixedCandidate) {
      selectedKey.value = candidateKey(props.fixedCandidate)
      return
    }
    if (selected.value && settled.value) return
    const best = groups.value.strong[0] ?? (props.isStreaming && !selected.value ? undefined : ranked.value[0])
    if (best) selectedKey.value = candidateKey(best.candidate)
    else if (!selected.value) selectedKey.value = null
  },
  { immediate: true },
)
watch(
  () => props.hasSearched && props.isStreaming,
  (started) => {
    if (started && !diff.hasCopied.value) settled.value = false
  },
)

const { shapeOf, sizeOf } = useCoverShapes(() => [
  ...alternatives.value,
  ...(selected.value ? [selected.value] : []),
  ...(props.secondCover?.candidates ?? []),
])

const diff = useMetadataDiff({
  current: () => props.current,
  active: selected,
  alternatives,
  providers: knownProviders,
  currentCoverUrl: () => props.currentCoverUrl,
  providerIds: () => props.providerIds,
  lockedFields: () => props.lockedFields,
  coverMedium: () => props.coverMedium,
  coverPriority: () => props.coverPriority,
  coverLabelKey: () =>
    props.secondCover ? `book.detail.editMetadata.diff.fields.${props.coverMedium === 'audio' ? 'audioCover' : 'bookCover'}` : undefined,
  coverShapeOf: shapeOf,
  coverSizeOf: sizeOf,
})
const { fields, cover, genreWriteMode, fillEmptyCount, takeAllCount, stagedByCandidate } = diff

const secondLocked = computed(() => !!props.secondCover && (props.lockedFields ?? []).includes(coverLockField(props.secondCover.medium)))
const second = useSecondCoverRow(
  () =>
    props.secondCover
      ? {
          medium: props.secondCover.medium,
          candidates: props.secondCover.candidates,
          priority: props.secondCover.priority,
          currentUrl: props.secondCover.currentUrl,
          locked: secondLocked.value,
        }
      : null,
  shapeOf,
)

function secondChoice(candidate: MetadataCandidate | null, medium: CoverMedium): CoverChoice | null {
  if (!candidate) return null
  const size = sizeOf(candidate)
  return { candidate, url: toDisplayCoverUrl(candidate.coverUrl), fit: coverFit(shapeOf(candidate), medium), size, broken: coverLooksBroken(size) }
}

const secondLabelKey = computed(() => `book.detail.editMetadata.diff.fields.${props.secondCover?.medium === 'audio' ? 'audioCover' : 'bookCover'}`)

const covers = computed<CoverCardModel[]>(() => {
  const main = cover.value
  const models: CoverCardModel[] = [
    {
      id: 'main',
      label: t(
        props.secondCover
          ? `book.detail.editMetadata.diff.fields.${props.coverMedium === 'audio' ? 'audioCover' : 'bookCover'}`
          : 'book.detail.editMetadata.diff.fields.coverUrl',
      ),
      medium: main.medium,
      currentUrl: main.currentUrl,
      active: main.active,
      picked: main.picked,
      choices: main.choices,
      locked: main.locked,
    },
  ]
  const other = props.secondCover
  if (other) {
    const audio = other.medium === 'audio'
    models.push({
      id: 'second',
      label: t(secondLabelKey.value),
      medium: other.medium,
      currentUrl: other.currentUrl,
      active: secondChoice(second.active.value, other.medium),
      picked: secondChoice(second.picked.value, other.medium),
      choices: second.choices.value
        .map((candidate) => secondChoice(candidate, other.medium))
        .filter((choice): choice is CoverChoice => choice !== null),
      locked: secondLocked.value,
      searching: other.searching,
      searchingText: t(`book.detail.editMetadata.diffPanel.secondCover.${audio ? 'searchingAudio' : 'searchingBook'}`),
      emptyText: t(`book.detail.editMetadata.diffPanel.secondCover.${audio ? 'noAudio' : 'noBook'}`),
    })
  }
  return models
})

const staged = computed<StagedChange[]>(() => {
  const list = [...diff.staged.value]
  const picked = second.picked.value
  if (props.secondCover && picked) {
    list.push({
      key: 'secondCover',
      field: 'coverUrl',
      labelKey: secondLabelKey.value,
      candidate: picked,
      before: props.secondCover.currentUrl,
      after: toDisplayCoverUrl(picked.coverUrl),
      merged: false,
      isCover: true,
    })
  }
  return list
})

const position = computed(() => navList.value.findIndex((candidate) => candidateKey(candidate) === selectedKey.value) + 1)
const waitingOn = computed(() =>
  props.isStreaming && selected.value
    ? props.providers
        .filter((provider) => props.selectedProviders.includes(provider.key) && !props.providerCounts[provider.key])
        .map((provider) => provider.label)
    : [],
)
const searchFoundNothing = computed(() => props.hasSearched && !props.isStreaming && pool.value.length === 0)

function select(candidate: MetadataCandidate) {
  settled.value = true
  selectedKey.value = candidateKey(candidate)
  screen.value = 'compare'
}

function step(delta: number) {
  const list = navList.value
  if (!list.length) return
  const index = list.findIndex((candidate) => candidateKey(candidate) === selectedKey.value)
  const next = list[Math.max(0, Math.min(list.length - 1, index + delta))]
  if (!next) return
  settled.value = true
  selectedKey.value = candidateKey(next)
}

function decide(key: DiffFieldKey, decision: FieldDecision, from?: MetadataCandidate) {
  settled.value = true
  diff.setField(key, decision, from ?? selected.value)
}

function coverKeep(id: CoverCardModel['id']) {
  settled.value = true
  if (id === 'main') diff.pickCover(null)
  else if (second.picked.value) second.pick(null)
}

function coverUse(id: CoverCardModel['id']) {
  settled.value = true
  if (id === 'main') {
    if (selected.value) diff.pickCover(selected.value)
    return
  }
  const active = second.active.value
  if (active && second.picked.value !== active) second.pick(active)
}

function coverPick(id: CoverCardModel['id'], candidate: MetadataCandidate | null) {
  settled.value = true
  if (id === 'main') diff.pickCover(candidate)
  else second.pick(candidate)
}

function unstage(key: string) {
  if (key === 'secondCover') second.pick(null)
  else diff.unstage(key)
}

function clearAll() {
  diff.clearAll()
  if (second.picked.value) second.pick(null)
}

function apply() {
  const { formPatch, coverUrl } = diff.buildPatch()
  const slots: Partial<Record<CoverMedium, string>> = {}
  if (coverUrl) slots[props.coverMedium] = coverUrl
  const secondUrl = second.pickedCoverUrl.value
  if (props.secondCover && secondUrl && !secondLocked.value) slots[props.secondCover.medium] = secondUrl
  emit('apply', {
    formPatch,
    ...(slots.ebook ? { coverUrl: slots.ebook } : {}),
    ...(slots.audio ? { audioCoverUrl: slots.audio } : {}),
  })
}

function handleSearch(query: MetadataQuery) {
  emit('search', query)
}

function handleToggleProvider(key: MetadataProviderKey) {
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

function handleCancel() {
  emit('cancel')
}

function showMatches() {
  screen.value = 'matches'
}

function setFilter(value: RowFilter) {
  filter.value = value
}

function fillEmpty() {
  settled.value = true
  diff.fillEmpty()
}

function takeAll() {
  settled.value = true
  diff.takeAll()
}

function focusFieldRow(delta: number) {
  const rows = [...(root.value?.querySelectorAll<HTMLElement>('[data-field-row]') ?? [])]
  if (!rows.length) return
  const current = rows.findIndex((row) => row === document.activeElement || row.contains(document.activeElement))
  const next = rows[current < 0 ? (delta > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, current + delta))]
  next?.focus()
  next?.scrollIntoView({ block: 'nearest' })
}

/**
 * Arrow keys step through results from the results list, J and K move between fields anywhere
 * outside a text box, and Space on a focused field keeps or uses it. A slash jumps to the search.
 */
function handleKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) return
  const target = event.target as HTMLElement
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return

  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && target.closest('[data-match-results]')) {
    event.preventDefault()
    step(event.key === 'ArrowDown' ? 1 : -1)
    nextTick(() => root.value?.querySelector<HTMLElement>('[data-match-results] [aria-current="true"]')?.focus())
    return
  }
  if (event.key === 'j' || event.key === 'k') {
    event.preventDefault()
    focusFieldRow(event.key === 'j' ? 1 : -1)
    return
  }
  if ((event.key === ' ' || event.key === 'Enter') && target.dataset.fieldKey) {
    event.preventDefault()
    const key = target.dataset.fieldKey as DiffFieldKey
    const field = fields.value.find((entry) => entry.key === key)
    if (field && !field.isLocked && (field.hasDiff || field.isPicked)) diff.toggleField(key)
    return
  }
  if (event.key === '/' && rail.value) {
    event.preventDefault()
    screen.value = 'matches'
    nextTick(() => rail.value?.focusQuery())
  }
}

defineExpose({ focusQuery: () => rail.value?.focusQuery() })
</script>

<template>
  <div ref="root" class="@container/match flex min-h-0 flex-col" @keydown="handleKeydown">
    <div
      class="grid min-h-0 flex-1"
      :class="fixedCandidate ? 'grid-cols-1' : 'grid-cols-1 @5xl/match:grid-cols-[21rem_minmax(0,1fr)] @7xl/match:grid-cols-[24rem_minmax(0,1fr)]'"
    >
      <div
        v-if="!fixedCandidate"
        class="min-h-0 flex-col border-border @5xl/match:flex @5xl/match:border-e"
        :class="screen === 'compare' ? 'hidden' : 'flex'"
      >
        <MetadataMatchRail
          ref="rail"
          v-model:other-books-open="otherBooksOpen"
          class="flex-1"
          :search-defaults="searchDefaults"
          :providers="providers"
          :selected-providers="selectedProviders"
          :provider-counts="providerCounts"
          :interrupted-providers="interruptedProviders"
          :retrying-providers="retryingProviders ?? []"
          :is-streaming="isStreaming"
          :has-searched="hasSearched"
          :groups="groups"
          :summaries="summaries"
          :selected-key="selectedKey"
          :staged-by-candidate="stagedByCandidate"
          :cover-ratio="coverRatio"
          @search="handleSearch"
          @toggle-provider="handleToggleProvider"
          @select-all="handleSelectAll"
          @select-field-rules="handleSelectFieldRules"
          @retry-provider="handleRetry"
          @select="select"
        />
      </div>
      <div class="min-h-0 flex-col @5xl/match:flex" :class="screen === 'matches' && !fixedCandidate ? 'hidden' : 'flex'">
        <MetadataMatchCompare
          class="flex-1"
          :candidate="selected"
          :assessment="selectedAssessment"
          :fields="fields"
          :filter="filter"
          :genre-mode="genreWriteMode"
          :providers="knownProviders"
          :covers="covers"
          :position="position"
          :total="navList.length"
          :waiting-on="waitingOn"
          :has-rail="!fixedCandidate"
          :book-title="current.title ?? ''"
          :search-found-nothing="searchFoundNothing"
          :fill-count="fillEmptyCount"
          :take-count="takeAllCount"
          :cover-ratio="coverRatio"
          @back="showMatches"
          @step="step"
          @update:filter="setFilter"
          @fill-empty="fillEmpty"
          @take-all="takeAll"
          @clear-all="clearAll"
          @decide="decide"
          @cover-keep="coverKeep"
          @cover-use="coverUse"
          @cover-pick="coverPick"
        />
      </div>
    </div>
    <MetadataMatchFooter
      :staged="staged"
      :providers="knownProviders"
      :hint="applyHint"
      @apply="apply"
      @cancel="handleCancel"
      @unstage="unstage"
      @clear-all="clearAll"
    />
  </div>
</template>
