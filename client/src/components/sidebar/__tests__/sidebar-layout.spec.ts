import { describe, expect, it } from 'vitest'
import { arrangeIds, groupRuns, mergeSubsetOrder } from '../sidebar-layout'

describe('arrangeIds', () => {
  const defaults = ['dashboard', 'book-dock', 'book-requests', 'tools']

  it('keeps the default order when nothing is stored', () => {
    expect(arrangeIds(defaults)).toEqual(defaults)
    expect(arrangeIds(defaults, [])).toEqual(defaults)
  })

  it('follows the stored order', () => {
    expect(arrangeIds(defaults, ['tools', 'dashboard', 'book-requests', 'book-dock'])).toEqual(['tools', 'dashboard', 'book-requests', 'book-dock'])
  })

  it('drops ids that no longer exist and duplicates', () => {
    expect(arrangeIds(defaults, ['tools', 'retired-row', 'tools', 'dashboard', 'book-dock', 'book-requests'])).toEqual([
      'tools',
      'dashboard',
      'book-dock',
      'book-requests',
    ])
  })

  it('places an id the stored order predates after its nearest default predecessor', () => {
    // A release adds `book-requests` after `book-dock`; the user had moved Tools to the top.
    expect(arrangeIds(defaults, ['tools', 'dashboard', 'book-dock'])).toEqual(['tools', 'dashboard', 'book-dock', 'book-requests'])
  })

  it('puts a new first default at the top', () => {
    expect(arrangeIds(['search', ...defaults], ['tools', 'dashboard', 'book-dock', 'book-requests'])).toEqual([
      'search',
      'tools',
      'dashboard',
      'book-dock',
      'book-requests',
    ])
  })
})

describe('mergeSubsetOrder', () => {
  it('writes the subset into its own slots and leaves the rest where they were', () => {
    // Podcast-only rows (podcast-queue) are off screen in books mode and must not move.
    const full = ['dashboard', 'book-dock', 'podcast-queue', 'tools']
    expect(mergeSubsetOrder(full, ['dashboard', 'tools', 'book-dock'])).toEqual(['dashboard', 'tools', 'podcast-queue', 'book-dock'])
  })

  it('returns the full order unchanged for an unchanged subset', () => {
    expect(mergeSubsetOrder(['a', 'b', 'c'], ['a', 'c'])).toEqual(['a', 'b', 'c'])
  })
})

describe('groupRuns', () => {
  it('splits groups into runs of one kind', () => {
    const blocks = [
      { id: 'browse', kind: 'nav' as const },
      { id: 'libraries', kind: 'list' as const },
      { id: 'collections', kind: 'list' as const },
      { id: 'reading', kind: 'nav' as const },
    ]

    expect(groupRuns(blocks).map((run) => [run.kind, run.blocks.map((block) => block.id)])).toEqual([
      ['nav', ['browse']],
      ['list', ['libraries', 'collections']],
      ['nav', ['reading']],
    ])
  })

  it('merges adjacent nav groups once a list section is moved out from between them', () => {
    const blocks = [
      { id: 'reading', kind: 'nav' as const },
      { id: 'browse', kind: 'nav' as const },
      { id: 'libraries', kind: 'list' as const },
    ]

    expect(groupRuns(blocks).map((run) => run.blocks.length)).toEqual([2, 1])
  })
})
