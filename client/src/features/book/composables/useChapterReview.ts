import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import type { AudiobookChapter, ChapterLookupResult } from '@bookorbit/types'
import { fromDraft, type DraftChapter } from '../lib/chapter-edit'
import {
  alignByPosition,
  alignByTime,
  applyIncoming,
  flattenLookup,
  hasParts,
  stretchScale,
  suggestOffsets,
  transformTimes,
  type ApplyMode,
  type MatchMode,
  type PartsMode,
} from '../lib/chapter-align'

export type ReviewSourceKind = 'files' | 'tracks' | 'import' | 'version' | 'lookup' | 'toc' | 'read_along'

/** Chapters offered to the editor, before any adjustment. A lookup keeps its tree so parts can be handled. */
export interface ReviewSource {
  kind: ReviewSourceKind
  chapters: AudiobookChapter[]
  lookup?: ChapterLookupResult
  titlesOnly?: boolean
  runtimeMs?: number | null
}

/**
 * The review step between a chapter source and the editor: shift, stretch and part handling are
 * applied to the incoming list, which is then matched against the editor's rows, by time when the
 * source is timed and by position otherwise.
 */
export function useChapterReview(current: Ref<DraftChapter[]>, totalDurationMs: Ref<number | null>) {
  const source = shallowRef<ReviewSource | null>(null)
  const offsetMs = ref(0)
  const stretch = ref(false)
  const partsMode = ref<PartsMode>('own')
  const matchMode = ref<MatchMode>('time')
  const applyMode = ref<ApplyMode>('replace')
  const excluded = ref<Set<number>>(new Set())

  watch(
    partsMode,
    () => {
      excluded.value = new Set()
    },
    { flush: 'sync' },
  )

  const lookup = computed(() => source.value?.lookup ?? null)
  const titlesOnly = computed(() => source.value?.titlesOnly ?? false)
  const showsParts = computed(() => (lookup.value ? hasParts(lookup.value.chapters) : false))
  const base = computed<AudiobookChapter[]>(() => {
    if (!source.value) return []
    return lookup.value ? flattenLookup(lookup.value.chapters, partsMode.value) : source.value.chapters
  })
  const runtimeMs = computed(() => lookup.value?.runtimeMs ?? source.value?.runtimeMs ?? null)
  const currentChapters = computed(() => fromDraft(current.value))
  const availableScale = computed(() =>
    titlesOnly.value
      ? null
      : stretchScale({
          current: currentChapters.value,
          incoming: base.value,
          offsetMs: offsetMs.value,
          totalDurationMs: totalDurationMs.value,
          runtimeMs: runtimeMs.value,
          brandIntroMs: lookup.value?.brandIntroMs,
          brandOutroMs: lookup.value?.brandOutroMs,
        }),
  )
  /** How far the stretch moves the last incoming chapter. */
  const stretchShiftMs = computed(() => {
    const last = base.value.at(-1)
    if (availableScale.value === null || !last) return 0
    return Math.max(0, last.startMs + offsetMs.value) * (availableScale.value - 1)
  })
  const scale = computed(() => (stretch.value && availableScale.value !== null ? availableScale.value : 1))
  const incoming = computed(() => (titlesOnly.value ? base.value : transformTimes(base.value, offsetMs.value, scale.value)))

  const pastEnd = computed(() => {
    const total = totalDurationMs.value
    if (total === null || titlesOnly.value) return new Set<number>()
    return new Set(incoming.value.flatMap((chapter, index) => (chapter.startMs >= total ? [index] : [])))
  })

  const skipped = computed(() => new Set([...excluded.value, ...pastEnd.value]))
  const included = computed(() => new Set(incoming.value.flatMap((_, index) => (skipped.value.has(index) ? [] : [index]))))

  const rows = computed(() =>
    titlesOnly.value || matchMode.value === 'position'
      ? alignByPosition(currentChapters.value, incoming.value, titlesOnly.value, skipped.value)
      : alignByTime(currentChapters.value, incoming.value),
  )

  const matchedCount = computed(() => rows.value.filter((row) => row.currentIndex !== null && row.incomingIndex !== null).length)

  const suggestions = computed(() => (titlesOnly.value ? [] : suggestOffsets(currentChapters.value, base.value, lookup.value?.brandIntroMs ?? 0)))

  function open(next: ReviewSource | null) {
    source.value = next
    offsetMs.value = 0
    stretch.value = false
    partsMode.value = 'own'
    matchMode.value = 'time'
    applyMode.value = next?.titlesOnly ? 'titles' : 'replace'
    excluded.value = new Set()
  }

  function toggleRow(index: number) {
    const next = new Set(excluded.value)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    excluded.value = next
  }

  function apply() {
    return applyIncoming(current.value, incoming.value, rows.value, applyMode.value, included.value)
  }

  return {
    source,
    offsetMs,
    stretch,
    partsMode,
    matchMode,
    applyMode,
    lookup,
    base,
    titlesOnly,
    showsParts,
    runtimeMs,
    availableScale,
    stretchShiftMs,
    incoming,
    currentChapters,
    rows,
    pastEnd,
    included,
    matchedCount,
    suggestions,
    open,
    toggleRow,
    apply,
  }
}
