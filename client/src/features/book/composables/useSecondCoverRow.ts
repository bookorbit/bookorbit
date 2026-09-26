import { computed, shallowRef, toValue, type MaybeRefOrGetter } from 'vue'
import type { CoverMedium, MetadataCandidate, MetadataCoverShape, MetadataProviderKey } from '@bookorbit/types'
import { toDisplayCoverUrl } from '../lib/metadata-fetch'
import { COVER_FIT_RANK, coverFit, statedCoverShape } from '../lib/cover-slots'
import type { DiffField } from './useMetadataDiff'

/** What the diff panel is given for the other medium's cover row. */
export interface SecondCoverInput {
  medium: CoverMedium
  candidates: MetadataCandidate[]
  priority: MetadataProviderKey[]
  currentUrl: string
  searching: boolean
}

export interface SecondCoverRowSource {
  medium: CoverMedium
  /** Results of the search run as this medium, in arrival order. */
  candidates: MetadataCandidate[]
  /** Providers in the order the slot's field rule ranks them for covers. */
  priority: MetadataProviderKey[]
  /** The slot's current cover, or '' when the slot is empty. */
  currentUrl: string
  locked: boolean
}

/**
 * The cover row for a book's other medium, fed by a search of its own. It keeps its own candidates,
 * selection and pick apart from the main rows: iTunes, Hardcover and Amazon answer both searches,
 * and a pick keyed by provider would let one list overwrite the other's.
 */
export function useSecondCoverRow(
  source: MaybeRefOrGetter<SecondCoverRowSource | null>,
  shapeOf: (candidate: MetadataCandidate) => MetadataCoverShape = statedCoverShape,
) {
  // Shallow, so a candidate is compared by identity with the list it came from, not with a proxy of it.
  const chosen = shallowRef<MetadataCandidate | null>(null)
  const picked = shallowRef<MetadataCandidate | null>(null)

  /** Art of the slot's shape first, each group in the field rule's order, so the default is the rule's best fit. */
  const choices = computed<MetadataCandidate[]>(() => {
    const current = toValue(source)
    if (!current) return []
    const rank = new Map(current.priority.map((provider, index) => [provider, index]))
    const fitRank = (candidate: MetadataCandidate) => COVER_FIT_RANK[coverFit(shapeOf(candidate), current.medium)]
    return current.candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => toDisplayCoverUrl(candidate.coverUrl))
      .sort(
        (a, b) =>
          fitRank(a.candidate) - fitRank(b.candidate) ||
          (rank.get(a.candidate.provider) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.candidate.provider) ?? Number.MAX_SAFE_INTEGER) ||
          a.index - b.index,
      )
      .map(({ candidate }) => candidate)
  })

  const active = computed<MetadataCandidate | null>(() => {
    const selected = chosen.value
    if (selected && choices.value.includes(selected)) return selected
    return choices.value[0] ?? null
  })

  const row = computed<DiffField | null>(() => {
    const current = toValue(source)
    if (!current) return null
    const candidateDisplay = toDisplayCoverUrl(active.value?.coverUrl)
    const pickedDisplay = toDisplayCoverUrl(picked.value?.coverUrl)
    const isPicked = picked.value !== null
    return {
      key: 'secondCoverUrl',
      labelKey: `book.detail.editMetadata.diff.fields.${current.medium === 'audio' ? 'audioCover' : 'bookCover'}`,
      bookValue: current.currentUrl,
      currentDisplay: isPicked ? pickedDisplay : current.currentUrl,
      candidateDisplay,
      hasDiff: current.currentUrl !== candidateDisplay,
      isPicked,
      pickedFromActive: isPicked && picked.value === active.value,
      pickedProvider: picked.value?.provider ?? null,
      pickedDisplay,
      isCover: true,
      coverMedium: current.medium,
      ...(active.value && candidateDisplay ? { candidateCoverFit: coverFit(shapeOf(active.value), current.medium) } : {}),
      isLocked: current.locked,
      isCopyable: true,
      providerValues: [],
    }
  })

  function select(candidate: MetadataCandidate) {
    chosen.value = candidate
  }

  function togglePick() {
    if (toValue(source)?.locked || !active.value) return
    picked.value = picked.value === active.value ? null : active.value
  }

  const pickedCoverUrl = computed(() => picked.value?.coverUrl)

  return { choices, active, row, picked, pickedCoverUrl, select, togglePick }
}
