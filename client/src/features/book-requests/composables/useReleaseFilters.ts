import { computed, ref, watch, type Ref } from 'vue'
import { classifyFileLayout, compareByTier } from '@bookorbit/types'
import type { ReleaseCandidateItem, ReleaseFileLayout } from '@bookorbit/types'

import { facetsOf, formatKeys, languageKey } from '../releaseFacets'

export const RELEASE_SORT_KEYS = ['score', 'seeders', 'size', 'bitrate', 'added'] as const
export type ReleaseSortKey = (typeof RELEASE_SORT_KEYS)[number]

/** Which filter a facet count must ignore so a chip never hides its own options. */
export type ReleaseFilterKey = 'language' | 'format' | 'audio' | 'files' | 'flags' | 'source'

/** The rungs an audiobook encode actually lands on; anything between them separates nothing. */
const BITRATE_STEPS = [64, 96, 128] as const

/**
 * Which releases the picker shows, in what order, and what its filter chips may offer.
 *
 * Sorting and filtering stay client-side. The list is already capped and in hand, and a round
 * trip would re-run the search against every tracker, spending rate limit to reorder rows.
 */
export function useReleaseFilters(releases: Ref<ReleaseCandidateItem[]>) {
  const sortKey = ref<ReleaseSortKey>('score')
  const language = ref<string | null>(null)
  const format = ref<string | null>(null)
  const channels = ref<number | null>(null)
  const fileLayout = ref<ReleaseFileLayout | null>(null)
  /** A floor rather than a band: an approver wants "this good or better", never "exactly this". */
  const minBitrate = ref(0)
  const freeleechOnly = ref(false)
  const hideVipOnly = ref(false)
  const source = ref<number | null>(null)

  function passesLanguage(release: ReleaseCandidateItem): boolean {
    return language.value === null || languageKey(release.language) === language.value
  }

  function passesFormat(release: ReleaseCandidateItem): boolean {
    return format.value === null || formatKeys(release).includes(format.value)
  }

  function passesChannels(release: ReleaseCandidateItem): boolean {
    return channels.value === null || release.audio?.channels === channels.value
  }

  /** A release whose source states no count is neither layout, so it fails either choice. */
  function passesFiles(release: ReleaseCandidateItem): boolean {
    return fileLayout.value === null || classifyFileLayout(release.fileCount) === fileLayout.value
  }

  function passesBitrate(release: ReleaseCandidateItem): boolean {
    if (minBitrate.value === 0) return true
    return (release.audio?.bitrateKbps ?? -1) >= minBitrate.value
  }

  function passesFlags(release: ReleaseCandidateItem): boolean {
    if (freeleechOnly.value && !release.freeleech) return false
    return !(hideVipOnly.value && release.vipOnly)
  }

  function passesSource(release: ReleaseCandidateItem): boolean {
    return source.value === null || release.indexerId === source.value
  }

  /**
   * Every filter except the one being counted, so a chip never offers a combination with no rows and
   * counting a facet never hides its own options. One predicate rather than the seven near-identical
   * filter chains the four-facet version had already grown to.
   */
  function passesAllExcept(release: ReleaseCandidateItem, except?: ReleaseFilterKey): boolean {
    if (except !== 'language' && !passesLanguage(release)) return false
    if (except !== 'format' && !passesFormat(release)) return false
    if (except !== 'audio' && !passesChannels(release)) return false
    if (except !== 'audio' && !passesBitrate(release)) return false
    if (except !== 'files' && !passesFiles(release)) return false
    if (except !== 'flags' && !passesFlags(release)) return false
    if (except !== 'source' && !passesSource(release)) return false
    return true
  }

  /** A release that states nothing on the sorted axis sorts last rather than as a zero. */
  function orderOf(release: ReleaseCandidateItem): number {
    switch (sortKey.value) {
      case 'seeders':
        return release.seeders ?? -1
      case 'size':
        return release.sizeBytes ?? -1
      case 'bitrate':
        return release.audio?.bitrateKbps ?? -1
      case 'added':
        return release.publishedAt ? Date.parse(release.publishedAt) : -1
      default:
        return release.score
    }
  }

  const visibleReleases = computed(() =>
    releases.value
      .filter((release) => passesAllExcept(release))
      // Safe to sort in place: filter already returned a fresh array. Tier leads every ordering,
      // including the explicit ones: an approver who sorts by size is asking to reorder within what
      // they said they wanted, not to be shown a release the profile ranked below it. Score keeps
      // the server's tie-break on seeders, and the others fall back to score so equal sizes or dates
      // do not reorder themselves between renders.
      .sort((a, b) => compareByTier(a.tier, b.tier) || orderOf(b) - orderOf(a) || b.score - a.score || (b.seeders ?? -1) - (a.seeders ?? -1)),
  )

  const hasFilter = computed(
    () =>
      language.value !== null ||
      format.value !== null ||
      channels.value !== null ||
      fileLayout.value !== null ||
      minBitrate.value > 0 ||
      freeleechOnly.value ||
      hideVipOnly.value ||
      source.value !== null,
  )
  const showFacets = computed(() => releases.value.length > 1)

  /**
   * The first row is only the best match while the list is still in score order and unfiltered.
   * Sorted by size or filtered down, row one is whatever that ordering put there, and calling it
   * the best match would be a claim the score never made.
   */
  const marksBest = computed(() => sortKey.value === 'score' && !hasFilter.value && visibleReleases.value.length > 0)

  /**
   * Hoisting one release out of a tie picks a winner the score did not. Saying how many others
   * matched it keeps that honest, because the scorer weighs neither size nor edition.
   */
  const tiedWithBest = computed(() => {
    const best = visibleReleases.value[0]
    if (!best) return 0
    return visibleReleases.value.filter((release) => release.score === best.score).length - 1
  })

  /** Stated by at least one release, so a row that omits it is saying something by omitting it. */
  const anySeeders = computed(() => releases.value.some((release) => release.seeders !== null))

  /**
   * An axis nothing varies on sorts nothing. Project Gutenberg publishes no swarm and no audio, so
   * offering "seeders" and "bitrate" there is three controls that cannot change the order.
   */
  const availableSortKeys = computed<ReleaseSortKey[]>(() =>
    RELEASE_SORT_KEYS.filter((key) => {
      switch (key) {
        case 'seeders':
          return anySeeders.value
        case 'size':
          return releases.value.some((release) => release.sizeBytes !== null)
        case 'bitrate':
          return releases.value.some((release) => release.audio?.bitrateKbps != null)
        case 'added':
          return releases.value.some((release) => release.publishedAt !== null)
        default:
          return true
      }
    }),
  )

  /** A refetch can drop the axis being sorted on; leaving it selected shows no active control. */
  watch(availableSortKeys, (keys) => {
    if (keys.length > 0 && !keys.includes(sortKey.value)) sortKey.value = 'score'
  })

  function candidatesFor(except: ReleaseFilterKey): ReleaseCandidateItem[] {
    return releases.value.filter((release) => passesAllExcept(release, except))
  }

  const languageFacets = computed(() => facetsOf(candidatesFor('language'), (release) => languageKey(release.language)))
  const formatFacets = computed(() => facetsOf(candidatesFor('format'), formatKeys))
  const channelFacets = computed(() =>
    facetsOf(candidatesFor('audio'), (release) => (release.audio?.channels ? String(release.audio.channels) : null)).map((facet) => ({
      ...facet,
      channels: Number(facet.value),
    })),
  )
  const fileFacets = computed(() =>
    facetsOf(candidatesFor('files'), (release) => classifyFileLayout(release.fileCount)).map((facet) => ({
      ...facet,
      layout: facet.value as ReleaseFileLayout,
    })),
  )
  /**
   * Only the steps some release could actually satisfy. A fixed ladder would offer "128k or better"
   * on a list whose best encode is 64k, which is a control that can only ever empty the list.
   */
  const bitrateFacets = computed(() => {
    const candidates = candidatesFor('audio')
    return BITRATE_STEPS.map((step) => ({
      step,
      count: candidates.filter((release) => (release.audio?.bitrateKbps ?? -1) >= step).length,
    })).filter((facet) => facet.count > 0 && facet.count < candidates.length)
  })
  const freeleechCount = computed(() => candidatesFor('flags').filter((release) => release.freeleech).length)
  const vipOnlyCount = computed(() => candidatesFor('flags').filter((release) => release.vipOnly).length)
  const sourceFacets = computed(() =>
    facetsOf(candidatesFor('source'), (release) => String(release.indexerId)).map((facet) => ({
      ...facet,
      indexerId: Number(facet.value),
      name: releases.value.find((release) => release.indexerId === Number(facet.value))?.indexerName ?? facet.value,
    })),
  )

  function selectSort(key: ReleaseSortKey) {
    sortKey.value = key
  }

  function selectLanguage(value: string) {
    language.value = language.value === value ? null : value
  }

  function selectFormat(value: string) {
    format.value = format.value === value ? null : value
  }

  function selectChannels(value: number) {
    channels.value = channels.value === value ? null : value
  }

  function selectFileLayout(value: ReleaseFileLayout) {
    fileLayout.value = fileLayout.value === value ? null : value
  }

  function selectMinBitrate(value: number) {
    minBitrate.value = minBitrate.value === value ? 0 : value
  }

  function selectSource(value: number) {
    source.value = source.value === value ? null : value
  }

  function toggleFreeleech() {
    freeleechOnly.value = !freeleechOnly.value
  }

  function toggleHideVipOnly() {
    hideVipOnly.value = !hideVipOnly.value
  }

  function clearFilters() {
    language.value = null
    format.value = null
    channels.value = null
    fileLayout.value = null
    minBitrate.value = 0
    freeleechOnly.value = false
    hideVipOnly.value = false
    source.value = null
  }

  /** Everything a new request resets, which is the ordering as well as the chips. */
  function resetFilters() {
    sortKey.value = 'score'
    clearFilters()
  }

  return {
    sortKey,
    language,
    format,
    channels,
    fileLayout,
    minBitrate,
    freeleechOnly,
    hideVipOnly,
    source,
    visibleReleases,
    hasFilter,
    showFacets,
    marksBest,
    tiedWithBest,
    anySeeders,
    availableSortKeys,
    languageFacets,
    formatFacets,
    channelFacets,
    fileFacets,
    bitrateFacets,
    freeleechCount,
    vipOnlyCount,
    sourceFacets,
    selectSort,
    selectLanguage,
    selectFormat,
    selectChannels,
    selectFileLayout,
    selectMinBitrate,
    selectSource,
    toggleFreeleech,
    toggleHideVipOnly,
    clearFilters,
    resetFilters,
  }
}

export type ReleaseFilters = ReturnType<typeof useReleaseFilters>
