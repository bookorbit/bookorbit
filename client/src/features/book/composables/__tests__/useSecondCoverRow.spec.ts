// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types'
import { useSecondCoverRow, type SecondCoverRowSource } from '../useSecondCoverRow'

function candidate(provider: MetadataProviderKey, id: string, data: Partial<MetadataCandidate> = {}): MetadataCandidate {
  return { provider, providerId: id, title: 'Dune', coverUrl: `/covers/${id}.jpg`, ...data }
}

function source(overrides: Partial<SecondCoverRowSource> = {}): SecondCoverRowSource {
  return {
    medium: 'audio',
    candidates: [],
    priority: ['audible', 'itunes', 'amazon'],
    currentUrl: '',
    locked: false,
    ...overrides,
  }
}

describe('useSecondCoverRow', () => {
  it('offers the slot-shaped art of the highest-ranked provider first', () => {
    const amazon = candidate('amazon', 'amazon-1', { coverShape: 'portrait' })
    const itunes = candidate('itunes', 'itunes-1', { coverShape: 'square' })
    const audible = candidate('audible', 'audible-1', { coverShape: 'square' })
    const unknown = candidate('goodreads', 'goodreads-1')
    const noCover = candidate('google', 'google-1', { coverUrl: undefined })
    const { choices, active } = useSecondCoverRow(source({ candidates: [amazon, unknown, itunes, noCover, audible] }))

    expect(choices.value).toEqual([audible, itunes, unknown, amazon])
    expect(active.value).toBe(audible)
  })

  it('ranks art measured as the other shape last, and names its fit', () => {
    const hardcover = candidate('hardcover', 'hardcover-1')
    const goodreads = candidate('goodreads', 'goodreads-1')
    const measured = (entry: MetadataCandidate) => (entry === hardcover ? 'portrait' : (entry.coverShape ?? 'unknown'))
    const { choices, active, row, select } = useSecondCoverRow(
      source({ priority: ['hardcover', 'goodreads'], candidates: [hardcover, goodreads] }),
      measured,
    )

    expect(choices.value).toEqual([goodreads, hardcover])
    expect(active.value).toBe(goodreads)
    expect(row.value?.candidateCoverFit).toBe('unknown')

    select(hardcover)
    expect(row.value?.candidateCoverFit).toBe('mismatch')
  })

  it('keeps its pick apart from the selection, and a locked slot cannot be picked', () => {
    const audible = candidate('audible', 'audible-1', { coverShape: 'square' })
    const itunes = candidate('itunes', 'itunes-1', { coverShape: 'square' })
    const locked = ref(false)
    const row = useSecondCoverRow(() =>
      source({ candidates: [audible, itunes], currentUrl: '/api/v1/books/1/cover?medium=audio', locked: locked.value }),
    )

    row.togglePick()
    row.select(itunes)

    expect(row.pickedCoverUrl.value).toBe('/covers/audible-1.jpg')
    expect(row.row.value).toMatchObject({
      key: 'secondCoverUrl',
      labelKey: 'book.detail.editMetadata.diff.fields.audioCover',
      coverMedium: 'audio',
      isPicked: true,
      pickedFromActive: false,
      pickedProvider: 'audible',
      bookValue: '/api/v1/books/1/cover?medium=audio',
    })

    row.togglePick()
    expect(row.picked.value).toBe(itunes)

    locked.value = true
    row.togglePick()
    expect(row.picked.value).toBe(itunes)
    expect(row.row.value?.isLocked).toBe(true)
  })

  it('has no row without a second medium', () => {
    const { row, choices } = useSecondCoverRow(null)

    expect(row.value).toBeNull()
    expect(choices.value).toEqual([])
  })
})
