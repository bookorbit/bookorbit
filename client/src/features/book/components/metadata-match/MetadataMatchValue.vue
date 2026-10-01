<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronUp } from '@lucide/vue'
import { formatLanguageName } from '@/i18n/formatters'
import type { DiffField, FieldDecision } from '../../composables/useMetadataDiff'
import { normalizeForMatch, type DiffFieldKey } from '../../lib/metadata-diff-fields'
import { formatPublishedDate } from '../../lib/published-date'
import { wordDiff, type WordDiffPart } from '../../lib/word-diff'

const props = defineProps<{
  field: DiffField
  side: 'current' | 'incoming'
  decision: FieldDecision
}>()

const { t } = useI18n()

/** Text fields worth a word-level diff; identifiers and numbers read better whole. */
const WORD_DIFF_KEYS = new Set<DiffFieldKey>(['title', 'subtitle', 'publisher', 'seriesName', 'description', 'comicVolumeName'])
/** Below this share of common words the texts are different, and highlighting every word helps no one. */
const MIN_SIMILARITY = 0.34
const CLAMP_AFTER_CHARACTERS = 240

const expanded = ref(false)
watch(
  () => [props.field.key, props.field.candidateDisplay],
  () => {
    expanded.value = false
  },
)

function formatValue(key: DiffFieldKey, raw: string): string {
  if (!raw) return ''
  switch (key) {
    case 'publishedDate':
      return formatPublishedDate(raw) ?? raw
    case 'language':
      return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(raw) ? formatLanguageName(raw) : raw
    case 'durationSeconds': {
      const seconds = Number(raw)
      if (!Number.isFinite(seconds)) return raw
      const hours = Math.floor(seconds / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      return hours > 0 ? t('book.detail.details.durationHm', { hours, minutes }) : t('book.detail.details.durationM', { minutes })
    }
    case 'abridged':
      return raw === 'true' ? t('common.yes') : t('common.no')
    default:
      return raw
  }
}

const own = computed(() => (props.side === 'current' ? props.field.bookValue : props.field.candidateDisplay))
const other = computed(() => (props.side === 'current' ? props.field.candidateDisplay : props.field.bookValue))
const text = computed(() => formatValue(props.field.key, own.value))
const isMono = computed(() => props.field.key.endsWith('Id') || props.field.key === 'isbn13' || props.field.key === 'isbn10')

const chips = computed(() => {
  const mine = props.side === 'current' ? props.field.bookList : props.field.candidateList
  if (!mine || !mine.length) return null
  const theirs = props.side === 'current' ? props.field.candidateList : props.field.bookList
  const showDifference = props.field.kind === 'change' && !!theirs?.length
  const theirSet = new Set((theirs ?? []).map(normalizeForMatch))
  const replaced = props.decision === 'use' || props.decision === 'replace'
  return mine.map((value) => {
    const shared = theirSet.has(normalizeForMatch(value))
    const state = !showDifference || shared ? 'same' : props.side === 'incoming' ? 'added' : replaced ? 'removed' : 'same'
    return { value, state }
  })
})

const parts = computed<WordDiffPart[] | null>(() => {
  if (props.field.kind !== 'change' || !WORD_DIFF_KEYS.has(props.field.key) || !own.value || !other.value) return null
  const before = props.side === 'current' ? own.value : other.value
  const after = props.side === 'current' ? other.value : own.value
  const diff = wordDiff(before, after)
  if (!diff || diff.similarity < MIN_SIMILARITY) return null
  return props.side === 'current' ? diff.before : diff.after
})

const clampable = computed(() => props.field.key === 'description' && text.value.length > CLAMP_AFTER_CHARACTERS)
const wordCount = computed(() => text.value.split(/\s+/).filter(Boolean).length)

function chipClass(state: string): string {
  if (state === 'added') return 'bg-success/15 ring-1 ring-success/40 ring-inset'
  if (state === 'removed') return 'bg-transparent ring-1 ring-border ring-inset text-muted-foreground line-through'
  return 'bg-muted'
}

function toggleExpanded() {
  expanded.value = !expanded.value
}
</script>

<template>
  <span v-if="!text" class="text-muted-foreground italic">
    {{ side === 'current' ? t('book.detail.editMetadata.match.value.empty') : t('book.detail.editMetadata.match.value.notProvided') }}
  </span>
  <span v-else-if="chips" class="flex flex-wrap gap-1">
    <span
      v-for="chip in chips"
      :key="chip.value"
      class="inline-flex min-h-[22px] items-center rounded-md px-[7px] py-0.5 text-xs leading-tight"
      :class="chipClass(chip.state)"
    >
      <span v-if="chip.state === 'added'" class="me-0.5 font-bold text-success">+</span>
      {{ chip.value }}
    </span>
  </span>
  <span v-else class="block">
    <span
      class="[overflow-wrap:anywhere]"
      :class="[isMono ? 'font-mono text-xs' : '', clampable && !expanded ? 'line-clamp-4' : 'block whitespace-pre-line']"
    >
      <template v-if="parts">
        <template v-for="(part, index) in parts" :key="index">
          <del
            v-if="part.kind === 'removed'"
            class="rounded-[3px] bg-destructive/20 decoration-destructive/70 [box-decoration-break:clone] [-webkit-box-decoration-break:clone]"
            >{{ part.text }}</del
          ><ins
            v-else-if="part.kind === 'added'"
            class="rounded-[3px] bg-success/25 no-underline [box-decoration-break:clone] [-webkit-box-decoration-break:clone]"
            >{{ part.text }}</ins
          ><template v-else>{{ part.text }}</template>
        </template>
      </template>
      <template v-else>{{ text }}</template>
    </span>
    <button
      v-if="clampable"
      type="button"
      class="-mx-1 mt-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[11.5px] font-medium text-foreground hover:bg-muted"
      :aria-expanded="expanded"
      @click.stop="toggleExpanded"
    >
      {{ expanded ? t('book.detail.editMetadata.diff.showLess') : t('book.detail.editMetadata.match.value.showAll', { count: wordCount }) }}
      <ChevronUp v-if="expanded" class="size-3" aria-hidden="true" />
      <ChevronDown v-else class="size-3" aria-hidden="true" />
    </button>
  </span>
</template>
