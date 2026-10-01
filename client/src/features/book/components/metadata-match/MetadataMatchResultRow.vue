<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Barcode, Link } from '@lucide/vue'
import type { MetadataCandidate, MetadataProviderInfo } from '@bookorbit/types'
import BookCoverPlaceholder from '@/features/book/components/BookCoverPlaceholder.vue'
import { getProviderLabel, hideOnError, providerBadgeStyle, resolveCandidateDisplayTitle, toDisplayCoverUrl } from '../../lib/metadata-fetch'
import type { MatchAssessment } from '../../lib/metadata-match'
import type { DifferenceSummary } from '../../lib/metadata-diff-fields'
import MetadataMatchTier from './MetadataMatchTier.vue'

const props = defineProps<{
  candidate: MetadataCandidate
  assessment: MatchAssessment
  summary: DifferenceSummary
  providers: MetadataProviderInfo[]
  selected: boolean
  stagedCount: number
  coverRatio: string
}>()

const emit = defineEmits<{ select: [MetadataCandidate] }>()

const { t } = useI18n()

const title = computed(() => resolveCandidateDisplayTitle(props.candidate) ?? t('book.detail.editMetadata.diffPanel.untitled'))
const coverUrl = computed(() => toDisplayCoverUrl(props.candidate.coverUrl))
const authorLine = computed(() => props.candidate.authors?.join(', ') || null)
const meta = computed(() => {
  const c = props.candidate
  const parts: string[] = []
  if (authorLine.value) parts.push(authorLine.value)
  const year = c.publishedDate?.slice(0, 4) || (c.publishedYear != null ? String(c.publishedYear) : '')
  if (year) parts.push(year)
  if (c.pageCount) parts.push(t('book.detail.editMetadata.match.results.pages', { count: c.pageCount }))
  if (c.publisher) parts.push(c.publisher)
  return parts.join(' · ')
})
const providerLabel = computed(() => getProviderLabel(props.candidate.provider, props.providers))
const showDifferentAuthor = computed(() => props.assessment.tier === 'weak' && !props.assessment.authorMatch)
const showTitleDiffers = computed(() => props.assessment.tier === 'weak' && props.assessment.authorMatch && props.assessment.titleMatch !== 'same')
const inSync = computed(() => props.assessment.tier !== 'weak' && props.summary.fills === 0 && props.summary.changes === 0)

function handleSelect() {
  emit('select', props.candidate)
}
</script>

<template>
  <button
    type="button"
    class="relative grid w-full grid-cols-[2.875rem_minmax(0,1fr)_auto] gap-x-2.5 rounded-lg border p-2 text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
    :class="selected ? 'border-primary/45 bg-primary/10' : 'border-transparent hover:bg-muted/70'"
    :aria-current="selected ? 'true' : undefined"
    @click="handleSelect"
  >
    <span class="relative block w-full self-start overflow-hidden rounded-[5px] bg-muted ring-1 ring-border" :style="{ aspectRatio: coverRatio }">
      <img v-if="coverUrl" :src="coverUrl" alt="" class="size-full object-contain" loading="lazy" @error="hideOnError" />
      <BookCoverPlaceholder v-else :title="title" :author-line="authorLine" :is-audio="coverRatio === '1/1'" :seed="title" />
    </span>

    <span class="min-w-0">
      <span class="block text-[13px] leading-snug font-semibold [overflow-wrap:anywhere] text-foreground">{{ title }}</span>
      <span v-if="meta" class="mt-0.5 block text-[11.5px] leading-snug [overflow-wrap:anywhere] text-muted-foreground">{{ meta }}</span>
      <span class="mt-1.5 flex flex-wrap gap-1">
        <span class="inline-flex h-[18px] items-center rounded-md px-1.5 text-[10.5px] font-bold" :style="providerBadgeStyle(candidate.provider)">
          {{ providerLabel }}
        </span>
        <span
          v-if="assessment.linked"
          class="inline-flex h-[18px] items-center gap-1 rounded-md bg-primary/15 px-1.5 text-[10.5px] font-semibold text-primary"
          :title="t('book.detail.editMetadata.match.results.linkedHint')"
        >
          <Link class="size-2.5" aria-hidden="true" />{{ t('book.detail.editMetadata.match.results.linked') }}
        </span>
        <span
          v-if="assessment.isbnMatch"
          class="inline-flex h-[18px] items-center gap-1 rounded-md bg-primary/15 px-1.5 text-[10.5px] font-semibold text-primary"
        >
          <Barcode class="size-2.5" aria-hidden="true" />{{ t('book.detail.editMetadata.match.results.isbn') }}
        </span>
        <span
          v-if="summary.fills"
          class="inline-flex h-[18px] items-center rounded-md bg-success/15 px-1.5 text-[10.5px] font-semibold text-success tabular-nums"
          :title="t('book.detail.editMetadata.match.results.fillsHint', { count: summary.fills })"
        >
          {{ t('book.detail.editMetadata.match.results.fills', { count: summary.fills }) }}
        </span>
        <span
          v-if="summary.changes"
          class="inline-flex h-[18px] items-center rounded-md bg-muted px-1.5 text-[10.5px] font-semibold text-muted-foreground tabular-nums"
          :title="t('book.detail.editMetadata.match.results.differHint', { count: summary.changes })"
        >
          {{ t('book.detail.editMetadata.match.results.differ', { count: summary.changes }) }}
        </span>
        <span
          v-if="inSync"
          class="inline-flex h-[18px] items-center rounded-md bg-muted px-1.5 text-[10.5px] font-semibold text-muted-foreground"
          :title="t('book.detail.editMetadata.match.results.inSyncHint')"
        >
          {{ t('book.detail.editMetadata.match.results.inSync') }}
        </span>
        <span
          v-if="showDifferentAuthor"
          class="inline-flex h-[18px] items-center rounded-md bg-warning/15 px-1.5 text-[10.5px] font-semibold text-warning"
        >
          {{ t('book.detail.editMetadata.match.results.differentAuthor') }}
        </span>
        <span
          v-else-if="showTitleDiffers"
          class="inline-flex h-[18px] items-center rounded-md bg-warning/15 px-1.5 text-[10.5px] font-semibold text-warning"
        >
          {{ t('book.detail.editMetadata.match.results.titleDiffers') }}
        </span>
        <span
          v-if="assessment.sparse"
          class="inline-flex h-[18px] items-center rounded-md bg-muted px-1.5 text-[10.5px] font-semibold text-muted-foreground"
          :title="t('book.detail.editMetadata.match.results.sparseHint', { count: assessment.filledFields })"
        >
          {{ t('book.detail.editMetadata.match.results.sparse') }}
        </span>
      </span>
    </span>

    <span class="flex flex-col items-end justify-between gap-1.5">
      <MetadataMatchTier :tier="assessment.tier" />
      <span
        v-if="stagedCount"
        class="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[10.5px] font-bold text-primary-foreground tabular-nums"
        :title="t('book.detail.editMetadata.match.results.staged', { count: stagedCount })"
      >
        {{ stagedCount }}
        <span class="sr-only">{{ t('book.detail.editMetadata.match.results.staged', { count: stagedCount }) }}</span>
      </span>
    </span>
  </button>
</template>
