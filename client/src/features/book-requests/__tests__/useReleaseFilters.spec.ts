// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { ReleaseCandidateItem } from '@bookorbit/types'

import { useReleaseFilters } from '../composables/useReleaseFilters'

function release(overrides: Partial<ReleaseCandidateItem> = {}): ReleaseCandidateItem {
  return {
    indexerId: 1,
    indexerName: 'jackett',
    guid: 'g1',
    title: 'Dune',
    sizeBytes: null,
    seeders: null,
    leechers: null,
    format: null,
    formats: [],
    language: null,
    fileCount: null,
    freeleech: false,
    vipOnly: false,
    alreadyGrabbed: false,
    publishedAt: null,
    audio: null,
    score: 50,
    tier: null,
    tierName: null,
    reasons: [],
    ...overrides,
  }
}

function guids(list: readonly ReleaseCandidateItem[]): string[] {
  return list.map((entry) => entry.guid)
}

describe('useReleaseFilters', () => {
  it('shows everything until a filter is chosen', () => {
    const filters = useReleaseFilters(ref([release({ guid: 'a' }), release({ guid: 'b' })]))

    expect(filters.hasFilter.value).toBe(false)
    expect(guids(filters.visibleReleases.value)).toEqual(['a', 'b'])
  })

  /** A profile ranks releases before any explicit ordering does; sorting reorders within a tier. */
  it('keeps tier ahead of the sorted axis', () => {
    const filters = useReleaseFilters(
      ref([release({ guid: 'untiered-huge', tier: null, sizeBytes: 900 }), release({ guid: 'tiered-small', tier: 1, sizeBytes: 100 })]),
    )

    filters.selectSort('size')

    expect(guids(filters.visibleReleases.value)).toEqual(['tiered-small', 'untiered-huge'])
  })

  it('sorts an axis a release states nothing on to the bottom', () => {
    const filters = useReleaseFilters(ref([release({ guid: 'silent', seeders: null }), release({ guid: 'seeded', seeders: 3 })]))

    filters.selectSort('seeders')

    expect(guids(filters.visibleReleases.value)).toEqual(['seeded', 'silent'])
  })

  it('offers no sort axis that nothing in the list varies on', () => {
    const filters = useReleaseFilters(ref([release({ seeders: null, sizeBytes: null, publishedAt: null, audio: null })]))

    expect(filters.availableSortKeys.value).toEqual(['score'])
  })

  /** A second click on the active chip is how the filter is taken off again. */
  it('toggles a chip off when it is picked twice', () => {
    const filters = useReleaseFilters(ref([release({ guid: 'a', formats: ['epub'] }), release({ guid: 'b', formats: ['mobi'] })]))

    filters.selectFormat('EPUB')
    expect(guids(filters.visibleReleases.value)).toEqual(['a'])

    filters.selectFormat('EPUB')
    expect(filters.hasFilter.value).toBe(false)
    expect(guids(filters.visibleReleases.value)).toEqual(['a', 'b'])
  })

  /**
   * The reason facets are counted against every filter but their own: a chip that counted itself
   * would drop to one option the moment it was used, and there would be no way back to the others.
   */
  it('counts a facet against the other filters but not against itself', () => {
    const filters = useReleaseFilters(
      ref([
        release({ guid: 'a', formats: ['epub'], language: 'en' }),
        release({ guid: 'b', formats: ['mobi'], language: 'en' }),
        release({ guid: 'c', formats: ['epub'], language: 'fr' }),
      ]),
    )

    filters.selectFormat('EPUB')

    expect(filters.formatFacets.value.map((facet) => facet.value).sort()).toEqual(['EPUB', 'MOBI'])
    expect(filters.languageFacets.value.map((facet) => facet.count)).toEqual([1, 1])
  })

  it('offers a bitrate floor only where it would separate the list', () => {
    const filters = useReleaseFilters(
      ref([
        release({
          guid: 'low',
          audio: { bitrateKbps: 64, bitrateMode: null, channels: null, samplingRateHz: null, durationSeconds: null, chapterCount: null },
        }),
        release({
          guid: 'high',
          audio: { bitrateKbps: 128, bitrateMode: null, channels: null, samplingRateHz: null, durationSeconds: null, chapterCount: null },
        }),
      ]),
    )

    // 64 would keep both rows and 128 keeps one, so only the step that narrows anything is offered.
    expect(filters.bitrateFacets.value.map((facet) => facet.step)).toEqual([96, 128])
  })

  it('marks a best match only in unfiltered score order', () => {
    const filters = useReleaseFilters(ref([release({ guid: 'a', formats: ['epub'] }), release({ guid: 'b', formats: ['epub'] })]))

    expect(filters.marksBest.value).toBe(true)

    filters.selectFormat('EPUB')
    expect(filters.marksBest.value).toBe(false)
  })

  it('counts how many others tied with the release it hoisted', () => {
    const filters = useReleaseFilters(ref([release({ guid: 'a', score: 70 }), release({ guid: 'b', score: 70 }), release({ guid: 'c', score: 40 })]))

    expect(filters.tiedWithBest.value).toBe(1)
  })

  it('puts every chip back and returns to score order on reset', () => {
    const filters = useReleaseFilters(ref([release({ guid: 'a', formats: ['epub'], sizeBytes: 10 })]))

    filters.selectFormat('EPUB')
    filters.selectSort('size')
    filters.resetFilters()

    expect(filters.hasFilter.value).toBe(false)
    expect(filters.sortKey.value).toBe('score')
  })
})
