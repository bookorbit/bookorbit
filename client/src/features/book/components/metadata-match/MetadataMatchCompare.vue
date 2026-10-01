<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Barcode, CheckCheck, ChevronLeft, ChevronRight, Ellipsis, ExternalLink, Link, Loader2, Plus, Undo2 } from '@lucide/vue'
import type { CoverMedium, MetadataCandidate, MetadataProviderInfo } from '@bookorbit/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { CoverChoice, DiffField, FieldDecision, GenreWriteMode } from '../../composables/useMetadataDiff'
import { isActionable, isComicDiffFieldKey, isProviderIdPatchField, type DiffFieldKey } from '../../lib/metadata-diff-fields'
import type { MatchAssessment } from '../../lib/metadata-match'
import { displayPublishedDate } from '../../lib/published-date'
import {
  getProviderColor,
  getProviderLabel,
  hideOnError,
  providerBadgeStyle,
  resolveCandidateDisplayTitle,
  toDisplayCoverUrl,
} from '../../lib/metadata-fetch'
import MetadataMatchTier from './MetadataMatchTier.vue'
import MetadataMatchFieldRow from './MetadataMatchFieldRow.vue'
import MetadataMatchCoverCard from './MetadataMatchCoverCard.vue'

export interface CoverCardModel {
  id: 'main' | 'second'
  label: string
  medium: CoverMedium
  currentUrl: string
  active: CoverChoice | null
  picked: CoverChoice | null
  choices: CoverChoice[]
  locked: boolean
  searching?: boolean
  searchingText?: string
  emptyText?: string
}

export type RowFilter = 'diff' | 'all'

type SectionId = 'identity' | 'description' | 'publication' | 'series' | 'genres' | 'comics' | 'identifiers' | 'ratings'

const SECTION_ORDER: SectionId[] = ['identity', 'description', 'publication', 'series', 'genres', 'comics', 'identifiers', 'ratings']
const SECTION_OF: Partial<Record<DiffFieldKey, SectionId>> = {
  title: 'identity',
  subtitle: 'identity',
  authors: 'identity',
  narrators: 'identity',
  description: 'description',
  publisher: 'publication',
  publishedDate: 'publication',
  language: 'publication',
  pageCount: 'publication',
  durationSeconds: 'publication',
  abridged: 'publication',
  seriesName: 'series',
  seriesIndex: 'series',
  genres: 'genres',
  isbn13: 'identifiers',
  isbn10: 'identifiers',
  hardcoverEditionId: 'identifiers',
  communityRating: 'ratings',
}

function sectionOf(key: DiffFieldKey): SectionId {
  if (isComicDiffFieldKey(key)) return 'comics'
  if (isProviderIdPatchField(key)) return 'identifiers'
  return SECTION_OF[key] ?? 'identity'
}

const props = defineProps<{
  candidate: MetadataCandidate | null
  assessment: MatchAssessment | null
  fields: DiffField[]
  filter: RowFilter
  genreMode: GenreWriteMode
  providers: MetadataProviderInfo[]
  covers: CoverCardModel[]
  position: number
  total: number
  /** Providers still answering while the best match so far is shown. */
  waitingOn: string[]
  hasRail: boolean
  bookTitle: string
  searchFoundNothing: boolean
  fillCount: number
  takeCount: number
  coverRatio: string
}>()

const emit = defineEmits<{
  back: []
  step: [delta: number]
  'update:filter': [RowFilter]
  fillEmpty: []
  takeAll: []
  clearAll: []
  decide: [key: DiffFieldKey, decision: FieldDecision, from?: MetadataCandidate]
  coverKeep: [id: CoverCardModel['id']]
  coverUse: [id: CoverCardModel['id']]
  coverPick: [id: CoverCardModel['id'], candidate: MetadataCandidate | null]
}>()

const { t } = useI18n()

const title = computed(() =>
  props.candidate ? (resolveCandidateDisplayTitle(props.candidate) ?? t('book.detail.editMetadata.diffPanel.untitled')) : '',
)
const providerLabel = computed(() => (props.candidate ? getProviderLabel(props.candidate.provider, props.providers) : ''))
const coverUrl = computed(() => toDisplayCoverUrl(props.candidate?.coverUrl))
const meta = computed(() => {
  const c = props.candidate
  if (!c) return ''
  const parts: string[] = []
  if (c.authors?.length) parts.push(c.authors.join(', '))
  const published = displayPublishedDate(c.publishedDate, c.publishedYear)
  if (published) parts.push(published)
  if (c.pageCount) parts.push(t('book.detail.editMetadata.match.results.pages', { count: c.pageCount }))
  if (c.publisher) parts.push(c.publisher)
  return parts.join(' · ')
})

const reviewCount = computed(() => props.fields.filter((field) => isActionable(field.kind)).length)
const visibleFields = computed(() => props.fields.filter((field) => props.filter === 'all' || isActionable(field.kind) || field.isPicked))
const sections = computed(() =>
  SECTION_ORDER.map((id) => ({ id, fields: visibleFields.value.filter((field) => sectionOf(field.key) === id) })).filter(
    (section) => section.fields.length,
  ),
)
const rowIndex = computed(() => new Map(visibleFields.value.map((field, index) => [field.key, index])))

function decisionOf(field: DiffField): FieldDecision {
  if (!field.pickedFromActive) return 'keep'
  return field.key === 'genres' ? props.genreMode : 'use'
}

function sectionSummary(fields: DiffField[]): string {
  const review = fields.filter((field) => isActionable(field.kind)).length
  const staged = fields.filter((field) => field.isPicked).length
  const base = t('book.detail.editMetadata.match.compare.toReview', { count: review })
  return staged ? `${base} · ${t('book.detail.editMetadata.match.compare.stagedInSection', { count: staged })}` : base
}

function handleBack() {
  emit('back')
}

function handlePrevious() {
  emit('step', -1)
}

function handleNext() {
  emit('step', 1)
}

function showDifferences() {
  emit('update:filter', 'diff')
}

function showAll() {
  emit('update:filter', 'all')
}

function handleFillEmpty() {
  emit('fillEmpty')
}

function handleTakeAll() {
  emit('takeAll')
}

function handleClearAll() {
  emit('clearAll')
}

function handleDecide(key: DiffFieldKey, decision: FieldDecision, from?: MetadataCandidate) {
  emit('decide', key, decision, from)
}

function handleCoverKeep(id: CoverCardModel['id']) {
  emit('coverKeep', id)
}

function handleCoverUse(id: CoverCardModel['id']) {
  emit('coverUse', id)
}

function handleCoverPick(id: CoverCardModel['id'], candidate: MetadataCandidate | null) {
  emit('coverPick', id, candidate)
}
</script>

<template>
  <section class="@container/compare flex min-h-0 min-w-0 flex-col" :aria-label="t('book.detail.editMetadata.match.compare.label')">
    <div v-if="!candidate" class="m-auto grid max-w-md justify-items-center gap-3 p-10 text-center">
      <p class="text-[15px] font-semibold">
        {{ searchFoundNothing ? t('book.detail.editMetadata.match.compare.noneTitle') : t('book.detail.editMetadata.match.compare.pickTitle') }}
      </p>
      <p class="text-[12.5px] text-muted-foreground">
        {{
          searchFoundNothing
            ? t('book.detail.editMetadata.match.compare.noneHint', { title: bookTitle })
            : t('book.detail.editMetadata.match.compare.pickHint')
        }}
      </p>
    </div>

    <template v-else>
      <header class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 border-b border-border px-4 py-3 @3xl/compare:px-6">
        <button
          v-if="hasRail"
          type="button"
          class="grid size-8 place-items-center rounded-lg text-foreground hover:bg-muted @5xl/match:hidden"
          :aria-label="t('book.detail.editMetadata.match.compare.backToMatches')"
          @click="handleBack"
        >
          <ArrowLeft class="size-4 rtl:rotate-180" aria-hidden="true" />
        </button>
        <span
          class="relative w-[2.625rem] overflow-hidden rounded-[5px] bg-muted ring-1 ring-border"
          :class="hasRail ? 'hidden @5xl/match:block' : 'block'"
          :style="{ aspectRatio: coverRatio }"
        >
          <img v-if="coverUrl" :src="coverUrl" alt="" class="size-full object-contain" @error="hideOnError" />
        </span>
        <div class="min-w-0">
          <h3 class="text-[15px] leading-snug font-semibold [overflow-wrap:anywhere]">
            {{ title }}
            <MetadataMatchTier v-if="assessment" :tier="assessment.tier" class="ms-1.5 align-baseline" />
          </h3>
          <p v-if="meta" class="mt-0.5 text-xs leading-snug [overflow-wrap:anywhere] text-muted-foreground">{{ meta }}</p>
          <div class="mt-1.5 flex flex-wrap gap-1.5">
            <span
              class="inline-flex h-[18px] items-center rounded-md px-1.5 text-[10.5px] font-bold"
              :style="providerBadgeStyle(candidate.provider)"
              >{{ providerLabel }}</span
            >
            <span
              v-if="assessment?.linked"
              class="inline-flex h-[18px] items-center gap-1 rounded-md bg-primary/15 px-1.5 text-[10.5px] font-semibold text-primary"
            >
              <Link class="size-2.5" aria-hidden="true" />{{ t('book.detail.editMetadata.match.compare.linkedToBook') }}
            </span>
            <span
              v-if="assessment?.isbnMatch"
              class="inline-flex h-[18px] items-center gap-1 rounded-md bg-primary/15 px-1.5 text-[10.5px] font-semibold text-primary"
            >
              <Barcode class="size-2.5" aria-hidden="true" />{{ t('book.detail.editMetadata.match.results.isbn') }}
            </span>
            <span
              v-if="assessment && assessment.tier !== 'strong' && assessment.titleMatch === 'same' && assessment.authorMatch"
              class="inline-flex h-[18px] items-center rounded-md bg-muted px-1.5 text-[10.5px] font-semibold text-muted-foreground"
            >
              {{ t('book.detail.editMetadata.match.compare.sameTitleAuthor') }}
            </span>
            <span
              v-if="assessment && assessment.tier === 'weak' && !assessment.authorMatch"
              class="inline-flex h-[18px] items-center rounded-md bg-warning/15 px-1.5 text-[10.5px] font-semibold text-warning"
            >
              {{ t('book.detail.editMetadata.match.results.differentAuthor') }}
            </span>
            <span
              v-if="assessment && assessment.titleMatch !== 'same'"
              class="inline-flex h-[18px] items-center rounded-md bg-warning/15 px-1.5 text-[10.5px] font-semibold text-warning"
            >
              {{ t('book.detail.editMetadata.match.results.titleDiffers') }}
            </span>
          </div>
        </div>
        <div class="grid justify-items-end gap-1.5">
          <div v-if="total > 1" class="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
            <button
              type="button"
              class="grid size-7 place-items-center rounded-lg border border-border text-foreground hover:enabled:bg-muted disabled:text-muted-foreground"
              :aria-label="t('book.detail.editMetadata.match.compare.previous')"
              :disabled="position <= 1"
              @click="handlePrevious"
            >
              <ChevronLeft class="size-4 rtl:rotate-180" aria-hidden="true" />
            </button>
            <span class="hidden @xl/compare:inline">{{ t('book.detail.editMetadata.match.compare.position', { index: position, total }) }}</span>
            <button
              type="button"
              class="grid size-7 place-items-center rounded-lg border border-border text-foreground hover:enabled:bg-muted disabled:text-muted-foreground"
              :aria-label="t('book.detail.editMetadata.match.compare.next')"
              :disabled="position >= total"
              @click="handleNext"
            >
              <ChevronRight class="size-4 rtl:rotate-180" aria-hidden="true" />
            </button>
          </div>
          <a
            v-if="candidate.sourceUrl"
            :href="candidate.sourceUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="hidden items-center gap-1 text-xs font-medium text-primary hover:underline @xl/compare:inline-flex"
          >
            {{ t('book.detail.editMetadata.match.compare.viewOn', { provider: providerLabel }) }}<ExternalLink class="size-3" aria-hidden="true" />
          </a>
        </div>
      </header>

      <p
        v-if="waitingOn.length"
        role="status"
        class="flex items-center gap-2 border-b border-border/60 bg-primary/5 px-4 py-2 text-xs text-muted-foreground @3xl/compare:px-6"
      >
        <Loader2 class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {{ t('book.detail.editMetadata.match.compare.streaming', { providers: waitingOn.join(', ') }) }}
      </p>

      <div class="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 @3xl/compare:px-6">
        <div
          class="inline-flex shrink-0 gap-0.5 rounded-lg border border-border/60 bg-muted p-0.5"
          role="radiogroup"
          :aria-label="t('book.detail.editMetadata.match.compare.rows')"
        >
          <button
            type="button"
            role="radio"
            :aria-checked="filter === 'diff'"
            class="inline-flex h-6 items-center gap-1.5 rounded-md px-2.5 text-[11.5px] font-medium whitespace-nowrap"
            :class="filter === 'diff' ? 'bg-background shadow-xs ring-1 ring-border' : 'hover:bg-background/60'"
            @click="showDifferences"
          >
            {{ t('book.detail.editMetadata.match.compare.differences')
            }}<span class="text-[10.5px] font-bold text-muted-foreground tabular-nums">{{ reviewCount }}</span>
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="filter === 'all'"
            class="inline-flex h-6 items-center gap-1.5 rounded-md px-2.5 text-[11.5px] font-medium whitespace-nowrap"
            :class="filter === 'all' ? 'bg-background shadow-xs ring-1 ring-border' : 'hover:bg-background/60'"
            @click="showAll"
          >
            {{ t('book.detail.editMetadata.match.compare.allFields')
            }}<span class="text-[10.5px] font-bold text-muted-foreground tabular-nums">{{ fields.length }}</span>
          </button>
        </div>
        <span class="flex-1" />
        <button
          type="button"
          class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium whitespace-nowrap hover:enabled:bg-muted disabled:text-muted-foreground"
          :disabled="!fillCount"
          @click="handleFillEmpty"
        >
          <Plus class="size-3.5" aria-hidden="true" />{{ t('book.detail.editMetadata.match.compare.fillEmpty', { count: fillCount }) }}
        </button>
        <button
          type="button"
          class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium whitespace-nowrap hover:enabled:bg-muted disabled:text-muted-foreground"
          :disabled="!takeCount"
          @click="handleTakeAll"
        >
          <CheckCheck class="size-3.5" aria-hidden="true" />{{ t('book.detail.editMetadata.match.compare.takeAll', { count: takeCount }) }}
        </button>
        <Popover>
          <PopoverTrigger as-child>
            <button
              type="button"
              class="grid size-7 shrink-0 place-items-center rounded-lg text-foreground hover:bg-muted"
              :aria-label="t('book.detail.editMetadata.match.compare.more')"
            >
              <Ellipsis class="size-4" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" class="w-64 p-1.5">
            <button
              type="button"
              class="grid w-full grid-cols-[1rem_minmax(0,1fr)] gap-2 rounded-md px-2 py-1.5 text-start text-[12.5px] hover:bg-muted"
              @click="handleClearAll"
            >
              <Undo2 class="mt-0.5 size-3.5" aria-hidden="true" />
              <span>
                {{ t('book.detail.editMetadata.match.compare.clearAll') }}
                <span class="block text-[11.5px] text-muted-foreground">{{ t('book.detail.editMetadata.match.compare.clearAllHint') }}</span>
              </span>
            </button>
            <a
              v-if="candidate.sourceUrl"
              :href="candidate.sourceUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="grid grid-cols-[1rem_minmax(0,1fr)] gap-2 rounded-md px-2 py-1.5 text-[12.5px] hover:bg-muted"
            >
              <ExternalLink class="mt-0.5 size-3.5" aria-hidden="true" />
              {{ t('book.detail.editMetadata.match.compare.viewOn', { provider: providerLabel }) }}
            </a>
          </PopoverContent>
        </Popover>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-7 @3xl/compare:px-6" data-match-ledger>
        <div
          class="sticky top-0 z-10 hidden grid-cols-2 gap-3 border-b border-border bg-background pt-2.5 pb-2 text-[10.5px] font-bold tracking-[0.12em] text-muted-foreground uppercase @2xl/compare:grid"
          aria-hidden="true"
        >
          <span>{{ t('book.detail.editMetadata.diffPanel.current') }}</span>
          <span class="flex items-center gap-1.5"
            ><span class="size-[7px] rounded-full" :style="{ backgroundColor: getProviderColor(candidate.provider) }" />{{ providerLabel }}</span
          >
        </div>

        <div class="grid gap-3 pt-4">
          <MetadataMatchCoverCard
            v-for="cover in covers"
            :key="cover.id"
            :label="cover.label"
            :medium="cover.medium"
            :current-url="cover.currentUrl"
            :active="cover.active"
            :picked="cover.picked"
            :choices="cover.choices"
            :locked="cover.locked"
            :providers="providers"
            :searching="cover.searching"
            :searching-text="cover.searchingText"
            :empty-text="cover.emptyText"
            @keep="handleCoverKeep(cover.id)"
            @use="handleCoverUse(cover.id)"
            @pick="handleCoverPick(cover.id, $event)"
          />
        </div>

        <template v-for="section in sections" :key="section.id">
          <div class="flex items-center gap-2.5 pt-5 pb-1">
            <template v-if="section.fields.length > 1">
              <h4 class="text-[10.5px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
                {{ t(`book.detail.editMetadata.match.sections.${section.id}`) }}
              </h4>
              <span class="text-[11px] font-medium text-muted-foreground">{{ sectionSummary(section.fields) }}</span>
            </template>
            <span class="h-px flex-1 bg-border/60" />
          </div>
          <MetadataMatchFieldRow
            v-for="field in section.fields"
            :key="field.key"
            :field="field"
            :candidate="candidate"
            :providers="providers"
            :decision="decisionOf(field)"
            :index="rowIndex.get(field.key) ?? 0"
            @decide="handleDecide"
          />
        </template>
        <p v-if="!sections.length" class="py-8 text-center text-sm text-muted-foreground">
          {{ t('book.detail.editMetadata.match.compare.allMatch') }}
        </p>
      </div>
    </template>
  </section>
</template>
