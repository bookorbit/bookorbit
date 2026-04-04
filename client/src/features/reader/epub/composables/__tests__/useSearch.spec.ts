import { describe, expect, it, vi } from 'vitest'
import { useSearch, type FoliateView } from '../useSearch'

describe('useSearch', () => {
  it('returns early for empty query and does not call foliate search', async () => {
    const view: FoliateView = {
      search: vi.fn<(opts: { query: string }) => AsyncGenerator<Record<string, unknown>, void, unknown>>(async function* () {
        yield {}
      }),
      clearSearch: vi.fn<() => void>(),
    }

    const store = useSearch()
    store.results.value = [{ cfi: 'x', excerpt: { pre: '', match: 'x', post: '' } }]

    await store.search(view, '   ')

    expect(view.search).not.toHaveBeenCalled()
    expect(store.results.value).toEqual([])
    expect(store.isSearching.value).toBe(false)
  })

  it('maps yielded sections into flattened search results', async () => {
    const view: FoliateView = {
      search: async function* () {
        yield { progress: 0.3 }
        yield {
          label: 'Chapter 2',
          subitems: [{ cfi: 'epubcfi(/6/2)', excerpt: { pre: 'one ', match: 'two', post: ' three' } }, { cfi: 'epubcfi(/6/4)' }],
        }
        yield {
          label: 'Chapter 3',
          subitems: [{ cfi: 'epubcfi(/6/8)', excerpt: { pre: '', match: 'hit', post: '' } }],
        }
      },
      clearSearch: vi.fn<() => void>(),
    }

    const store = useSearch()

    await store.search(view, 'two')

    expect(store.query.value).toBe('two')
    expect(store.isSearching.value).toBe(false)
    expect(store.results.value).toEqual([
      {
        cfi: 'epubcfi(/6/2)',
        sectionTitle: 'Chapter 2',
        excerpt: { pre: 'one ', match: 'two', post: ' three' },
      },
      {
        cfi: 'epubcfi(/6/4)',
        sectionTitle: 'Chapter 2',
        excerpt: { pre: '', match: '', post: '' },
      },
      {
        cfi: 'epubcfi(/6/8)',
        sectionTitle: 'Chapter 3',
        excerpt: { pre: '', match: 'hit', post: '' },
      },
    ])
  })

  it('clear resets local search state and clears foliate highlights', () => {
    const clearSearch = vi.fn<() => void>()
    const view: FoliateView = {
      search: async function* () {
        yield {}
      },
      clearSearch,
    }

    const store = useSearch()
    store.query.value = 'needle'
    store.results.value = [{ cfi: 'epubcfi(/6/2)', excerpt: { pre: '', match: 'needle', post: '' } }]
    store.isSearching.value = true

    store.clear(view)

    expect(clearSearch).toHaveBeenCalledTimes(1)
    expect(store.query.value).toBe('')
    expect(store.results.value).toEqual([])
    expect(store.isSearching.value).toBe(false)
  })
})
